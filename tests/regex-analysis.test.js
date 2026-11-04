import test from "node:test";
import assert from "node:assert/strict";
import { analyzePattern } from "../src/regex/analyze.js";
import { renderRailroad, buildPatternGraph } from "../src/regex/diagram.js";
import { RegexOptions } from "../src/regex/options.js";

test("quantifiers bind to the last literal character, not to a merged literal run", () => {
  const analysis = analyzePattern("abc+");
  const [literal, repeat] = analysis.tree.body.children;
  assert.equal(literal.value, "ab");
  assert.equal(repeat.type, "quantifier");
  assert.equal(repeat.body.value, "c");
  assert.equal(repeat.min, 1);
  assert.equal(repeat.max, null);
  assert.equal(analysis.summary.captureCount, 0);
});

test("tokens preserve every source character and UTF-16 offset", () => {
  const pattern = "(?x) \\A (?<word>café|Łódź) [ ]* # comment\n \\k<word> \\z";
  const analysis = analyzePattern(pattern);
  assert.equal(analysis.tokens.map((token) => token.text).join(""), pattern);
  for (const token of analysis.tokens) {
    assert.equal(pattern.slice(token.start, token.end), token.text);
    assert.ok(token.label);
  }
  const unicode = analyzePattern("😀x");
  assert.equal(unicode.tree.body.children[0].end, 3);
  assert.equal(unicode.offsets, "utf-16");
});

test(".NET capture numbers put unnamed groups before named groups and respect inline n", () => {
  const analysis = analyzePattern("(?<first>a)(b)(?n)(c)(?<last>d)(?-n)(e)");
  assert.deepEqual(
    analysis.captureGroups.map((group) => [group.number, group.name]),
    [
      [1, "1"],
      [2, "2"],
      [3, "first"],
      [4, "last"],
    ],
  );
  assert.equal(
    analysis.nodes.find((node) => node.raw === "(c)").kind,
    "noncapturing",
  );
  assert.equal(
    analysis.nodes.find((node) => node.raw === "(e)").kind,
    "capturing",
  );
});

test("explicit numbered slots and duplicate named captures remain one capture group", () => {
  const analysis = analyzePattern("(?<7>a)(b)(?<x>c)(?<x>d)\\7\\k<x>");
  assert.deepEqual(
    analysis.captureGroups.map((group) => [group.number, group.name]),
    [
      [1, "1"],
      [2, "x"],
      [7, "7"],
    ],
  );
  assert.equal(
    analysis.captureGroups.find((group) => group.name === "x").occurrences
      .length,
    2,
  );
  assert.equal(
    analysis.nodes.filter((node) => node.type === "backreference").length,
    2,
  );
});

test("scoped options restore surrounding semantics", () => {
  const analysis = analyzePattern("a(?is:.)b.");
  const dots = analysis.nodes.filter((node) => node.type === "dot");
  assert.match(dots[0].description, /including a line feed/);
  assert.match(dots[1].description, /except a line feed/);
  const last = analysis.nodes.find(
    (node) => node.type === "literal" && node.value === "b",
  );
  assert.equal(last.options & RegexOptions.IgnoreCase, 0);
});

test("ignored trivia between an atom, quantifier, and lazy suffix keeps source labels", () => {
  const pattern = "(?x)a (?# explanation) +  ? b";
  const analysis = analyzePattern(pattern);
  const repeat = analysis.nodes.find((node) => node.type === "quantifier");
  assert.equal(repeat.lazy, true);
  assert.equal(repeat.body.value, "a");
  assert.equal(analysis.tokens.map((token) => token.text).join(""), pattern);
  assert.ok(analysis.tokens.every((token) => token.label));
  assert.ok(analysis.explanations.some((item) => item.kind === "comment"));
});

test("character classes retain .NET subtraction and class-specific backspace", () => {
  const analysis = analyzePattern(String.raw`[a-z-[aeiou]]+[\b\d]`);
  const classes = analysis.nodes.filter(
    (node) => node.type === "character-class",
  );
  assert.equal(classes[0].subtraction.raw, "[aeiou]");
  assert.deepEqual(
    classes[0].ranges.map((range) => [range.from, range.to]),
    [["a", "z"]],
  );
  assert.equal(classes[1].parts[0].value, "\b");
  assert.ok(analysis.validSyntaxEstimate);
});

test("conditional captures and assertion tests do not create accidental captures", () => {
  const captureTest = analyzePattern(String.raw`(?<open>a)?(?(open)b|c)`);
  const conditional = captureTest.nodes.find(
    (node) => node.type === "conditional",
  );
  assert.equal(conditional.condition.kind, "capture");
  assert.equal(captureTest.captureGroups.length, 1);
  const assertionTest = analyzePattern(String.raw`(?(?=(?<x>a))\k<x>|b)`);
  assert.equal(assertionTest.captureGroups.length, 1);
  assert.equal(assertionTest.captureGroups[0].name, "x");
  assert.equal(
    assertionTest.nodes.find((node) => node.type === "conditional").condition
      .kind,
    "assertion",
  );
  assert.equal(
    assertionTest.tokens.map((token) => token.text).join(""),
    assertionTest.pattern,
  );
});

test("balancing groups preserve push/pop references and optional new capture", () => {
  const analysis = analyzePattern(
    String.raw`(?<open>\()(?<between-open>\))(?<-open>\))`,
  );
  const groups = analysis.nodes.filter(
    (node) => node.type === "group" && node.kind === "balancing",
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "between");
  assert.equal(groups[0].subtractName, "open");
  assert.equal(groups[1].name, null);
  assert.deepEqual(
    analysis.captureGroups.map((group) => group.name),
    ["open", "between"],
  );
});

test("known incomplete syntax is reported without throwing or pretending to validate everything", () => {
  for (const pattern of ["(", "[abc", "a{4,2}", "\\", "a++", "\\xQ"]) {
    const analysis = analyzePattern(pattern);
    assert.equal(analysis.validSyntaxEstimate, false, pattern);
    assert.ok(
      analysis.warnings.some((warning) => warning.severity === "error"),
    );
  }
  const unknown = analyzePattern("(?R)");
  assert.equal(unknown.analysisComplete, false);
  assert.equal(
    unknown.validationAuthority,
    ".NET 10 System.Text.RegularExpressions",
  );
});

test("NonBacktracking restrictions are explanatory; the runtime remains authoritative", () => {
  const analysis = analyzePattern("(?=a)a", RegexOptions.NonBacktracking);
  assert.ok(
    analysis.warnings.some(
      (warning) => warning.code === "nonbacktracking-construct",
    ),
  );
  assert.equal(analysis.validSyntaxEstimate, true);
  const options = analyzePattern(
    "a",
    RegexOptions.NonBacktracking | RegexOptions.RightToLeft,
  );
  assert.ok(
    options.warnings.some(
      (warning) =>
        warning.code === "nonbacktracking-options" &&
        warning.severity === "error",
    ),
  );
});

test("nested repetitions are a heuristic and atomic boundaries suppress inner warnings", () => {
  assert.ok(
    analyzePattern("(a+)+").warnings.some(
      (warning) => warning.code === "nested-repetition",
    ),
  );
  assert.ok(
    !analyzePattern("(?>a+)+").warnings.some(
      (warning) => warning.code === "nested-repetition",
    ),
  );
  assert.ok(
    !analyzePattern("(a+)+", RegexOptions.NonBacktracking).warnings.some(
      (warning) => warning.code === "nested-repetition",
    ),
  );
});

test("analysis has finite depth and node budgets for adversarial patterns", () => {
  const analysis = analyzePattern("(".repeat(500) + "a" + ")".repeat(500), 0, {
    maxDepth: 20,
  });
  assert.equal(analysis.analysisComplete, false);
  assert.ok(
    analysis.warnings.some(
      (warning) => warning.code === "analysis-complexity-limit",
    ),
  );
  assert.ok(analysis.nodes.length < 100);
});

test("railroad SVG escapes text and attributes, preserving source-linked graph nodes", () => {
  const analysis = analyzePattern('<script>"&</script>|a+');
  const svg = renderRailroad(analysis, { id: "test" });
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("data-node-id="));
  assert.ok(svg.includes('role="button"'));
  assert.ok(svg.includes("optimized .NET execution steps"));
  const graph = buildPatternGraph(analysis);
  assert.equal(graph.nodes.length, analysis.nodes.length);
  assert.equal(graph.edges.length, graph.nodes.length - 1);
  const invalidXml = renderRailroad(analyzePattern("\0\ud800"));
  assert.ok(!invalidXml.includes("\0"));
  assert.ok(!invalidXml.includes("\ud800"));
  assert.ok(invalidXml.includes("\\ud800"));
});

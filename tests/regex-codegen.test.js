import test from "node:test";
import assert from "node:assert/strict";
import {
  csharpString,
  generateCSharp,
  generateCsproj,
} from "../src/regex/codegen.js";
import {
  formatRegexOptions,
  optionsFromNames,
  RegexOptions,
} from "../src/regex/options.js";
import { analyzePattern } from "../src/regex/analyze.js";
import {
  examples,
  lessons,
  buildPattern,
  escapeRegexLiteral,
  escapeReplacementLiteral,
  evaluateLesson,
} from "../src/regex/learning.js";

test("C# literals preserve quotes, backslashes, line breaks, Unicode, and unpaired surrogates", () => {
  assert.equal(csharpString('a"b\\c\n\r\t'), '"a\\"b\\\\c\\n\\r\\t"');
  assert.equal(csharpString("\ud800\udc00\udfff"), '"\\ud800\\udc00\\udfff"');
  assert.equal(csharpString("café Łódź"), '"café Łódź"');
  assert.equal(csharpString("\u2028\u0085\u200b"), '"\\u2028\\u0085\\u200b"');
});

test("code generation retains exact regex options and never maps them to JS flags", () => {
  assert.equal(formatRegexOptions(0), "RegexOptions.None");
  assert.equal(
    formatRegexOptions(1 | 64),
    "RegexOptions.IgnoreCase | RegexOptions.RightToLeft",
  );
  assert.equal(formatRegexOptions(128), "(RegexOptions)128");
  assert.equal(optionsFromNames(["IgnoreCase", "Multiline"]), 3);
  assert.throws(() => formatRegexOptions(0.5));
  assert.throws(() => optionsFromNames(["global"]));
});

test("runtime example constructs under selected culture and restores caller culture", () => {
  const code = generateCSharp({
    pattern: String.raw`(?<word>\w+)`,
    input: "İ ı",
    options: RegexOptions.IgnoreCase,
    culture: "tr-TR",
    timeoutMs: 400,
  });
  assert.ok(code.includes('CultureInfo.GetCultureInfo("tr-TR")'));
  assert.ok(code.includes("finally"));
  assert.ok(code.includes("CultureInfo.CurrentCulture = previousCulture;"));
  assert.ok(code.includes("TimeSpan.FromMilliseconds(400)"));
  assert.ok(code.includes("foreach (Capture capture in group.Captures)"));
  assert.ok(code.includes("catch (RegexMatchTimeoutException"));
});

test("source-generated example fixes the same culture, options, and timeout", () => {
  const code = generateCSharp(
    { pattern: String.raw`a\d+`, options: 1, culture: "pl-PL", timeoutMs: 125 },
    { style: "generated" },
  );
  assert.ok(
    code.includes(
      '[GeneratedRegex("a\\\\d+", RegexOptions.IgnoreCase, 125, "pl-PL")]',
    ),
  );
  assert.ok(code.includes("internal static partial class Program"));
  assert.ok(code.includes("private static partial Regex GeneratedPattern();"));
  assert.ok(
    code.includes(
      "if (generated.GetType() != typeof(Regex)) return generated;",
    ),
  );
  assert.ok(
    code.includes(
      'CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("pl-PL");',
    ),
  );
  assert.ok(
    code.includes(
      "return new Regex(pattern, options, TimeSpan.FromMilliseconds(125));",
    ),
  );
  const invariant = generateCSharp(
    { pattern: "i", options: 1 | 512, culture: "tr-TR" },
    { style: "generated" },
  );
  assert.ok(invariant.includes('250, "")]'));
  assert.ok(
    generateCsproj().includes("<TargetFramework>net10.0</TargetFramework>"),
  );
});

test("replacement and split exports use native .NET operations", () => {
  const replace = generateCSharp({
    pattern: "(?<x>a)",
    input: "a",
    replacement: "${x}$$",
    operation: "replace",
  });
  assert.ok(replace.includes('const string replacement = "${x}$$";'));
  assert.ok(replace.includes("regex.Replace(input, replacement)"));
  assert.ok(!replace.includes("foreach (Match match"));
  assert.ok(
    generateCSharp({ operation: "split" }).includes(
      "string[] parts = regex.Split(input);",
    ),
  );
});

test("invalid timeout inputs are not silently changed in generated code", () => {
  for (const timeoutMs of [0, -2, 1.5, NaN, 2_147_483_647])
    assert.throws(() => generateCSharp({ timeoutMs }));
  assert.ok(
    generateCSharp({ timeoutMs: -1 }).includes("Regex.InfiniteMatchTimeout"),
  );
});

test("literal and replacement builders keep user data literal", () => {
  assert.equal(escapeRegexLiteral("a+b (c)#\n"), String.raw`a\+b\ \(c\)\#\n`);
  assert.equal(escapeReplacementLiteral("$1 ${name} $$"), "$$1 $${name} $$$$");
  assert.equal(
    buildPattern(
      [
        { id: "literal", value: "v." },
        { id: "capture", name: "version", children: ["digits"] },
      ],
      { anchor: "input" },
    ),
    String.raw`\A(?:v\.(?<version>\d+))\z`,
  );
  assert.equal(
    buildPattern([{ id: "either", alternatives: ["a+b", "c.d"] }]),
    String.raw`(?:a\+b|c\.d)`,
  );
  assert.equal(
    buildPattern([
      {
        id: "literal",
        value: "ab",
        repeat: { kind: "range", min: 2, max: 4, lazy: true },
      },
    ]),
    "(?:ab){2,4}?",
  );
  assert.throws(() => buildPattern([{ id: "capture", name: "bad>name" }]));
  assert.throws(() => buildPattern([{ id: "between", min: 4, max: 2 }]));
});

test("all provided examples and lesson solutions are structurally understood", () => {
  for (const item of [
    ...examples,
    ...lessons.map((lesson) => ({ ...lesson, pattern: lesson.solution })),
  ]) {
    const analysis = analyzePattern(item.pattern, item.options);
    assert.equal(analysis.validSyntaxEstimate, true, item.id);
    assert.equal(analysis.analysisComplete, true, item.id);
  }
});

test("lesson checks consume actual .NET result groups and full capture histories", () => {
  const lesson = lessons.find((item) => item.id === "capture-history");
  const result = {
    matches: [
      {
        value: "red, blue, teal",
        index: 0,
        groups: [
          {
            name: "item",
            success: true,
            value: "teal",
            captures: [{ value: "red" }, { value: "blue" }, { value: "teal" }],
          },
        ],
      },
    ],
  };
  assert.equal(evaluateLesson(lesson, result).passed, true);
  result.matches[0].groups[0].captures.shift();
  assert.equal(evaluateLesson(lesson, result).passed, false);
  assert.equal(
    evaluateLesson(lesson, { error: { message: "Timed out" } }).message,
    "Timed out",
  );
  assert.equal(
    evaluateLesson(lesson, { ...result, truncated: true }).passed,
    false,
  );
});

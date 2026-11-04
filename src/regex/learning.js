import { RegexOptions } from "./options.js";

/** Purposeful samples; validation is delegated to the .NET engine. */
export const examples = Object.freeze([
  {
    id: "email",
    title: "Find email addresses",
    category: "Everyday",
    difficulty: "Start here",
    description:
      "Extract email-shaped contact addresses and keep the name and domain in separate captures. This is a practical extraction pattern, not a complete email-address validator.",
    pattern: String.raw`\b(?<name>[\w.+-]+)@(?<domain>[\w.-]+\.[A-Za-z]{2,})\b`,
    input:
      "CONTACT LIST\nMaya Chen     maya.chen@contoso.com\nLeo Nowak     leo+studio@example.org\nNina Patel    nina@northwind.io\nSupport       hello@contoso.com\nNot an email  please use the contact form",
    options: 0,
    replacement: "${name} at ${domain}",
  },
  {
    id: "orders",
    title: "Read order references",
    category: "Everyday",
    difficulty: "Beginner",
    description:
      "Break a reference into a region and a four-digit order number.",
    pattern: String.raw`\b(?<region>[A-Z]{2})-(?<number>\d{4})\b`,
    input:
      "Orders ready to ship:\nEU-1042  delivered\nUS-0837  processing\nEU-1043  delivered\nAP-1205  awaiting payment\nEU-12    incomplete reference",
    options: 0,
    replacement: "${region} / #${number}",
  },
  {
    id: "logs",
    title: "Explore application logs",
    category: "Data",
    difficulty: "Intermediate",
    description:
      "Use multiline anchors and named captures to turn log lines into fields.",
    pattern: String.raw`^(?<time>\d{2}:\d{2}:\d{2})\s+\[(?<level>INFO|WARN|ERROR)\]\s+(?<message>[^\r\n]+)`,
    input:
      "09:41:02 [INFO] Studio started\n09:41:04 [INFO] Loaded 240 records\n09:41:06 [WARN] Three rows have no email\n09:41:09 [ERROR] Data source unavailable\n09:41:12 [INFO] Working with saved data",
    options: RegexOptions.Multiline,
    replacement: "${level}: ${message}",
  },
  {
    id: "unicode",
    title: "Words in many languages",
    category: "Text",
    difficulty: "Beginner",
    description:
      "Unicode letter and mark categories recognize words without restricting them to A–Z.",
    pattern: String.raw`\p{L}[\p{L}\p{M}’'-]*`,
    input:
      "Hello, cześć, café, Καλημέρα, こんにちは.\nZoë O’Connor — Łódź — São Paulo",
    options: 0,
  },
  {
    id: "duplicate-words",
    title: "Catch repeated words",
    category: "Text",
    difficulty: "Intermediate",
    description:
      "Capture a word and require the same text again with a named backreference.",
    pattern: String.raw`\b(?<word>\w+)\s+\k<word>\b`,
    input:
      "This is is a small mistake.\nThe THE next line repeats a word.\nOne word is enough.\nA very very useful check.",
    options: RegexOptions.IgnoreCase,
    replacement: "${word}",
  },
  {
    id: "prices",
    title: "Capture amounts after USD",
    category: "Data",
    difficulty: "Intermediate",
    description:
      "A lookbehind checks the currency label while leaving it out of the match.",
    pattern: String.raw`(?<=USD\s)(?<amount>\d+(?:\.\d{2})?)\b`,
    input:
      "Notebook: USD 12.50\nPencil: USD 2\nBackpack: EUR 49.95\nDesk lamp: USD 34.00",
    options: 0,
    replacement: "${amount}",
  },
  {
    id: "lazy",
    title: "Greedy versus lazy",
    category: "Engine",
    difficulty: "Intermediate",
    description:
      "Compare this lazy pattern with <.+> on the same line and inspect the backtracking trace. This demonstrates quantifiers, not general HTML parsing.",
    pattern: String.raw`<.+?>`,
    input:
      "<title>Regex Studio</title> <strong>Explore</strong> <em>learn</em>",
    options: 0,
    comparison: {
      title: "Greedy alternative",
      pattern: String.raw`<.+>`,
      options: 0,
    },
  },
  {
    id: "capture-history",
    title: "Keep every repeated capture",
    category: ".NET features",
    difficulty: "Advanced",
    description:
      "Repeated use of the same named group accumulates a capture history in the backtracking engine.",
    pattern: String.raw`(?<item>\w+)(?:,\s*(?<item>\w+))*`,
    input: "apple, pear, plum\nblue, green, teal",
    options: 0,
  },
  {
    id: "class-subtraction",
    title: "Subtract one character set",
    category: ".NET features",
    difficulty: "Intermediate",
    description:
      "The outer A–Z set removes vowels with .NET character-class subtraction.",
    pattern: String.raw`[a-z-[aeiou]]+`,
    input: "A quiet studio for curious people.\nRegex makes patterns visible.",
    options: RegexOptions.IgnoreCase,
  },
  {
    id: "balancing",
    title: "Check balanced parentheses",
    category: ".NET features",
    difficulty: "Advanced",
    description:
      "Use the capture stack to pair opening and closing parentheses, then reject any unmatched opening captures.",
    pattern: String.raw`\A(?:(?<open>\()|(?<-open>\))|[^()])*(?(open)(?!))\z`,
    input: "order(customer(42), items(book, pen))",
    options: 0,
  },
  {
    id: "right-to-left",
    title: "Search from the right",
    category: ".NET features",
    difficulty: "Intermediate",
    description:
      "RightToLeft discovers the last reference first. Match indices still count from the beginning of the input.",
    pattern: String.raw`\b[A-Z]{2}-\d{4}\b`,
    input: "EU-1042 → US-0837 → AP-1205",
    options: RegexOptions.RightToLeft,
  },
  {
    id: "nonbacktracking",
    title: "Use the linear-time engine",
    category: "Engine",
    difficulty: "Advanced",
    description:
      "Run a compatible pattern with .NET NonBacktracking. Compare engine behavior on the same data; the instruction simulator is for the backtracking interpreter.",
    pattern: String.raw`\b(?<region>[A-Z]{2})-(?<number>\d{4})\b`,
    input: "EU-1042\nUS-0837\nnot-an-order\nAP-1205\nEU-12",
    options: RegexOptions.NonBacktracking,
  },
]);

export const builderBlocks = Object.freeze([
  {
    id: "literal",
    category: "Text",
    label: "Specific text",
    description:
      "Match the exact text you enter. Special regex characters are escaped for you.",
    pattern: "hello",
    parameter: {
      name: "value",
      label: "Text to find",
      type: "text",
      default: "hello",
    },
  },
  {
    id: "digit",
    category: "Characters",
    label: "A digit",
    description: "One Unicode decimal digit.",
    pattern: String.raw`\d`,
  },
  {
    id: "digits",
    category: "Characters",
    label: "A number",
    description: "One or more Unicode decimal digits.",
    pattern: String.raw`\d+`,
  },
  {
    id: "letter",
    category: "Characters",
    label: "A letter",
    description: "One Unicode letter from any writing system.",
    pattern: String.raw`\p{L}`,
  },
  {
    id: "word",
    category: "Characters",
    label: "A word",
    description: "One or more .NET word characters.",
    pattern: String.raw`\w+`,
  },
  {
    id: "space",
    category: "Characters",
    label: "Whitespace",
    description: "One or more spaces, tabs, or line breaks.",
    pattern: String.raw`\s+`,
  },
  {
    id: "literal-space",
    category: "Text",
    label: "A space",
    description: "One actual space, including in free-spacing mode.",
    pattern: "[ ]",
  },
  {
    id: "newline",
    category: "Characters",
    label: "A line break",
    description: "A Windows CRLF or Unix LF line break.",
    pattern: String.raw`\r?\n`,
  },
  {
    id: "any",
    category: "Characters",
    label: "Any character",
    description:
      "One character except a line feed unless Singleline is enabled.",
    pattern: ".",
  },
  {
    id: "not-newline",
    category: "Characters",
    label: "Rest of a line",
    description: "Zero or more characters other than CR or LF.",
    pattern: String.raw`[^\r\n]*`,
  },
  {
    id: "range",
    category: "Characters",
    label: "Letters A–Z",
    description: "One ASCII letter, upper or lower case.",
    pattern: "[A-Za-z]",
  },
  {
    id: "one-of",
    category: "Characters",
    label: "One of these",
    description: "One character from a set.",
    pattern: "[abc]",
    parameter: {
      name: "value",
      label: "Characters",
      type: "text",
      default: "abc",
    },
  },
  {
    id: "none-of",
    category: "Characters",
    label: "None of these",
    description: "One character outside a set.",
    pattern: "[^abc]",
    parameter: {
      name: "value",
      label: "Characters to exclude",
      type: "text",
      default: "abc",
    },
  },
  {
    id: "boundary",
    category: "Position",
    label: "Word boundary",
    description: "The boundary beside a word, without consuming text.",
    pattern: String.raw`\b`,
  },
  {
    id: "start",
    category: "Position",
    label: "Start of input",
    description: "The absolute beginning of the input.",
    pattern: String.raw`\A`,
  },
  {
    id: "end",
    category: "Position",
    label: "End of input",
    description: "The absolute end of the input.",
    pattern: String.raw`\z`,
  },
  {
    id: "line-start",
    category: "Position",
    label: "Start of line",
    description: "Beginning of input; with Multiline, also after each LF.",
    pattern: "^",
  },
  {
    id: "line-end",
    category: "Position",
    label: "End of line",
    description: "End of input or before LF; use Multiline for every line.",
    pattern: "$",
  },
  {
    id: "capture",
    category: "Structure",
    label: "Name a capture",
    description: "Keep part of a match in a named field.",
    pattern: String.raw`(?<name>\w+)`,
    parameter: {
      name: "name",
      label: "Capture name",
      type: "text",
      default: "name",
    },
  },
  {
    id: "group",
    category: "Structure",
    label: "Group together",
    description: "Group elements without adding a capture.",
    pattern: "(?:abc)",
  },
  {
    id: "either",
    category: "Structure",
    label: "Either / or",
    description: "Try one alternative, then another when needed.",
    pattern: "(?:yes|no)",
  },
  {
    id: "optional",
    category: "Repeat",
    label: "Optional",
    description: "The preceding element may appear zero or one time.",
    pattern: "?",
  },
  {
    id: "one-or-more",
    category: "Repeat",
    label: "One or more",
    description: "Repeat the preceding element at least once.",
    pattern: "+",
  },
  {
    id: "zero-or-more",
    category: "Repeat",
    label: "Zero or more",
    description: "Repeat the preceding element any number of times.",
    pattern: "*",
  },
  {
    id: "exact",
    category: "Repeat",
    label: "Exactly N times",
    description: "Repeat the preceding element a fixed number of times.",
    pattern: "{3}",
    parameter: { name: "count", label: "Count", type: "number", default: 3 },
  },
  {
    id: "between",
    category: "Repeat",
    label: "Between N and M",
    description: "Repeat the preceding element within a range.",
    pattern: "{2,4}",
  },
  {
    id: "lazy",
    category: "Repeat",
    label: "As few as possible",
    description: "Append to a quantifier to make it lazy.",
    pattern: "?",
  },
  {
    id: "lookahead",
    category: "Assertions",
    label: "Must be followed by",
    description: "Check upcoming text without including it in the match.",
    pattern: "(?=text)",
  },
  {
    id: "negative-lookahead",
    category: "Assertions",
    label: "Must not be followed by",
    description: "Reject this upcoming text without consuming it.",
    pattern: "(?!text)",
  },
  {
    id: "lookbehind",
    category: "Assertions",
    label: "Must come after",
    description: "Check text just before the current position.",
    pattern: "(?<=text)",
  },
  {
    id: "negative-lookbehind",
    category: "Assertions",
    label: "Must not come after",
    description: "Reject this text behind the current position.",
    pattern: "(?<!text)",
  },
  {
    id: "backreference",
    category: ".NET advanced",
    label: "Same captured text",
    description: "Match exactly what a named group most recently captured.",
    pattern: String.raw`\k<name>`,
  },
  {
    id: "atomic",
    category: ".NET advanced",
    label: "Commit a group",
    description: "Do not backtrack inside this group after it succeeds.",
    pattern: "(?>abc)",
  },
]);

export const lessons = Object.freeze([
  {
    id: "first-match",
    title: "1. Find a word",
    concept: "Literals",
    description:
      "Ordinary letters match themselves. The studio finds every occurrence.",
    challenge: "Find the two occurrences of cat.",
    pattern: "cat",
    input: "A cat met another cat.",
    hint: "Start with the exact word you want to find.",
    solution: "cat",
    options: 0,
    expected: [
      { value: "cat", index: 2 },
      { value: "cat", index: 18 },
    ],
  },
  {
    id: "whole-numbers",
    title: "2. Grow a match",
    concept: "Quantifiers",
    description:
      "\\d finds one digit. A quantifier decides how many times to repeat an element.",
    challenge: "Capture each entire order number, not each digit.",
    pattern: String.raw`\d`,
    input: "Orders: 104, 208, 9.",
    hint: "Put + after \\d to request one or more digits.",
    solution: String.raw`\d+`,
    options: 0,
    expected: [{ value: "104" }, { value: "208" }, { value: "9" }],
  },
  {
    id: "word-boundaries",
    title: "3. Give words boundaries",
    concept: "Zero-width assertions",
    description:
      "An assertion checks a position without adding characters to the match.",
    challenge: "Match cat as a whole word and skip the one inside concatenate.",
    pattern: "cat",
    input: "cat concatenate bobcat cat",
    hint: "Place \\b on both sides of cat.",
    solution: String.raw`\bcat\b`,
    options: 0,
    expected: [
      { value: "cat", index: 0 },
      { value: "cat", index: 23 },
    ],
  },
  {
    id: "choices",
    title: "4. Offer alternatives",
    concept: "Alternation",
    description:
      "A vertical bar introduces a choice. Groups let a choice stay together.",
    challenge: "Find red and blue, and leave green alone.",
    pattern: "red",
    input: "red, green, blue, red",
    hint: "Use red|blue. A noncapturing group becomes useful when you add shared boundaries.",
    solution: String.raw`\b(?:red|blue)\b`,
    options: 0,
    expected: [{ value: "red" }, { value: "blue" }, { value: "red" }],
  },
  {
    id: "capture-fields",
    title: "5. Turn matches into fields",
    concept: "Named captures",
    description:
      "Captures give names to useful pieces of a match, ready for C# and data export.",
    challenge: "Match EU-1042 and save region=EU and number=1042.",
    pattern: String.raw`[A-Z]{2}-\d{4}`,
    input: "Order EU-1042 is ready.",
    hint: "Wrap each field in (?<name>...).",
    solution: String.raw`(?<region>[A-Z]{2})-(?<number>\d{4})`,
    options: 0,
    expected: [{ value: "EU-1042", groups: { region: "EU", number: "1042" } }],
  },
  {
    id: "literal-punctuation",
    title: "6. Escape special characters",
    concept: "Escaping",
    description:
      "A dot normally means almost any character. A backslash gives it its literal meaning.",
    challenge: "Match version 1.2, but skip 1x2.",
    pattern: "1.2",
    input: "Versions: 1.2 and 1x2.",
    hint: "Escape the dot: \\.",
    solution: String.raw`1\.2`,
    options: 0,
    expected: [{ value: "1.2" }],
  },
  {
    id: "lazy-quantifiers",
    title: "7. Watch the engine reconsider",
    concept: "Greedy and lazy",
    description:
      "Greedy repetitions try more characters first. Lazy repetitions try fewer first. Open the simulator to inspect the difference.",
    challenge: "Find each quoted value separately.",
    pattern: '".*"',
    input: '"teal" then "violet"',
    hint: "Add ? after * to make it lazy, or use a negated character class.",
    solution: '".*?"',
    options: 0,
    expected: [{ value: '"teal"' }, { value: '"violet"' }],
  },
  {
    id: "lookbehind",
    title: "8. Keep context out of a match",
    concept: "Lookbehind",
    description:
      "An assertion can require a label without returning that label as part of the match.",
    challenge: "Find 12.50 after USD, and skip the EUR amount.",
    pattern: String.raw`\d+\.\d{2}`,
    input: "USD 12.50 / EUR 8.90",
    hint: "Require the label with (?<=USD ).",
    solution: String.raw`(?<=USD )\d+\.\d{2}`,
    options: 0,
    expected: [{ value: "12.50", index: 4 }],
  },
  {
    id: "unicode-letters",
    title: "9. Think beyond A–Z",
    concept: "Unicode categories",
    description:
      ".NET understands Unicode categories, so a letter can come from many writing systems.",
    challenge:
      "Find all three complete words, including their accented letters.",
    pattern: "[A-Za-z]+",
    input: "café Łódź hello",
    hint: "Use \\p{L}+ for one or more Unicode letters.",
    solution: String.raw`\p{L}+`,
    options: 0,
    expected: [{ value: "café" }, { value: "Łódź" }, { value: "hello" }],
  },
  {
    id: "backreferences",
    title: "10. Remember what matched",
    concept: "Backreferences",
    description:
      "A backreference matches captured text. It does not run the original group’s pattern again.",
    challenge: "Find only the repeated pair go go.",
    pattern: String.raw`\b\w+\s+\w+\b`,
    input: "go go / go now",
    hint: "Name the first word, then reference it with \\k<word>.",
    solution: String.raw`\b(?<word>\w+)\s+\k<word>\b`,
    options: 0,
    expected: [{ value: "go go" }],
  },
  {
    id: "capture-history",
    title: "11. Read the whole capture history",
    concept: ".NET captures",
    description:
      "A repeated capture group can keep every captured value, even though Group.Value returns the final one.",
    challenge:
      "Match red, blue, teal as one match and retain each color in the item group.",
    pattern: String.raw`\w+(?:,\s*\w+)*`,
    input: "red, blue, teal",
    hint: "Use the same named capture (?<item>\\w+) for the first item and each repeated item.",
    solution: String.raw`(?<item>\w+)(?:,\s*(?<item>\w+))*`,
    options: 0,
    expected: [
      { value: "red, blue, teal", captures: { item: ["red", "blue", "teal"] } },
    ],
  },
  {
    id: "absolute-anchors",
    title: "12. Validate the entire input",
    concept: "Absolute anchors",
    description:
      "\\A and \\z require the true start and end of the input. Unlike $, \\z does not accept a position before a final LF.",
    challenge: "Reject the value because it ends with an extra newline.",
    pattern: String.raw`^[A-Z]{2}-\d{4}$`,
    input: "EU-1042\n",
    hint: "Use \\A at the beginning and \\z at the end.",
    solution: String.raw`\A[A-Z]{2}-\d{4}\z`,
    options: 0,
    expected: [],
  },
]);

export const referenceSections = Object.freeze([
  {
    title: "Find characters",
    entries: [
      {
        pattern: ".",
        description: "Any character except LF; Singleline includes LF.",
      },
      {
        pattern: String.raw`\d / \D`,
        description: "A Unicode decimal digit / a nondigit.",
      },
      {
        pattern: String.raw`\w / \W`,
        description: "A .NET word character / a nonword character.",
      },
      {
        pattern: String.raw`\s / \S`,
        description: "Whitespace / a nonwhitespace character.",
      },
      {
        pattern: "[abc] / [^abc]",
        description: "One character from a set / outside a set.",
      },
      {
        pattern: String.raw`\p{L} / \p{Nd}`,
        description: "A Unicode letter / decimal digit.",
      },
      {
        pattern: "[a-z-[aeiou]]",
        description: ".NET character-class subtraction.",
      },
    ],
  },
  {
    title: "Choose how many",
    entries: [
      {
        pattern: "* / + / ?",
        description: "Zero or more / one or more / optional.",
      },
      {
        pattern: "{3} / {2,4} / {2,}",
        description: "Exactly 3 / from 2 to 4 / at least 2.",
      },
      {
        pattern: "*? / +? / ?? / {2,4}?",
        description: "Lazy repetition: try fewer first.",
      },
    ],
  },
  {
    title: "Check positions",
    entries: [
      {
        pattern: String.raw`\A / \z`,
        description: "Absolute beginning / absolute end.",
      },
      {
        pattern: "^ / $",
        description: "Beginning / end; Multiline adds line positions.",
      },
      {
        pattern: String.raw`\b / \B`,
        description: "Word boundary / not a word boundary.",
      },
      {
        pattern: String.raw`\G`,
        description: "The current operation’s starting position.",
      },
    ],
  },
  {
    title: "Group and remember",
    entries: [
      {
        pattern: "(abc) / (?:abc)",
        description: "Capture a group / group without capture.",
      },
      {
        pattern: "(?<name>abc)",
        description: "Capture text into a named group.",
      },
      {
        pattern: String.raw`\k<name> / \1`,
        description: "Match previously captured text.",
      },
      { pattern: "a|b", description: "Choose an alternative." },
      {
        pattern: "(?(name)yes|no)",
        description: "Choose according to a current capture.",
      },
      {
        pattern: "(?<name-other>abc)",
        description: ".NET capture-stack balancing.",
      },
    ],
  },
  {
    title: "Inspect without consuming",
    entries: [
      {
        pattern: "(?=abc) / (?!abc)",
        description: "Positive / negative lookahead.",
      },
      {
        pattern: "(?<=abc) / (?<!abc)",
        description: "Positive / negative lookbehind.",
      },
      {
        pattern: "(?>abc)",
        description: "Atomic group: commit its internal choices.",
      },
      {
        pattern: "(?i) / (?i:abc)",
        description: "Change options for the scope / a local group.",
      },
    ],
  },
  {
    title: ".NET replacements",
    entries: [
      {
        pattern: "$1 / ${name}",
        description: "A numbered / named group’s value.",
      },
      { pattern: "$& / $0", description: "The complete match." },
      { pattern: "$$", description: "A literal dollar sign." },
      {
        pattern: "$` / $'",
        description: "The text before / after this match.",
      },
      {
        pattern: "$+ / $_",
        description: "The last captured group / the whole input.",
      },
    ],
  },
]);

export const documentationLinks = Object.freeze([
  {
    title: ".NET regex language reference",
    url: "https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-language-quick-reference",
  },
  {
    title: "RegexOptions and engine behavior",
    url: "https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-options",
  },
  {
    title: "Groups, captures, and balancing groups",
    url: "https://learn.microsoft.com/dotnet/standard/base-types/grouping-constructs-in-regular-expressions",
  },
  {
    title: "Backtracking and timeouts",
    url: "https://learn.microsoft.com/dotnet/standard/base-types/backtracking-in-regular-expressions",
  },
  {
    title: ".NET source-generated regexes",
    url: "https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-source-generators",
  },
]);

/** Escape literal text for use outside a character class, including free-spacing mode. */
export function escapeRegexLiteral(value = "") {
  return String(value).replace(/[\\^$.*+?()[\]{}|#\s]/gu, (character) => {
    const escaped = {
      "\n": "\\n",
      "\r": "\\r",
      "\t": "\\t",
      "\f": "\\f",
      "\v": "\\v",
    };
    if (escaped[character]) return escaped[character];
    if (/\s/u.test(character) && character !== " ")
      return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    return `\\${character}`;
  });
}

export function escapeReplacementLiteral(value = "") {
  return String(value).replaceAll("$", () => "$$");
}

function escapeCharacterSet(value) {
  return String(value).replace(
    /[\\\]\[\-^\n\r\t]/g,
    (character) =>
      ({ "\n": "\\n", "\r": "\\r", "\t": "\\t" })[character] ||
      `\\${character}`,
  );
}

/** Build a pattern from serializable blocks, without using JavaScript RegExp for matching. */
export function buildPattern(steps = [], { anchor = "none" } = {}) {
  const build = (items, depth = 0) => {
    if (depth > 64)
      throw new RangeError(
        "The pattern builder supports up to 64 nested groups.",
      );
    return items
      .map((rawStep) => {
        const step = typeof rawStep === "string" ? { id: rawStep } : rawStep;
        if (!step || typeof step !== "object")
          throw new TypeError(
            "A pattern block must be an object or a block identifier.",
          );
        const id = step.id || step.type;
        const known = builderBlocks.find((block) => block.id === id);
        let source;
        const content = step.children
          ? build(step.children, depth + 1)
          : (step.pattern ?? step.value);
        switch (id) {
          case "literal":
            source = escapeRegexLiteral(step.value ?? "hello");
            break;
          case "raw":
            source = String(step.pattern ?? step.value ?? "");
            break;
          case "one-of":
            source = `[${escapeCharacterSet(step.value ?? "abc")}]`;
            break;
          case "none-of":
            source = `[^${escapeCharacterSet(step.value ?? "abc")}]`;
            break;
          case "capture": {
            const name = String(step.name ?? "name");
            if (!/^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(name))
              throw new TypeError(
                "Capture names must begin with a letter or underscore and contain only word characters.",
              );
            source = `(?<${name}>${content ?? String.raw`\w+`})`;
            break;
          }
          case "group":
            source = `(?:${content ?? "abc"})`;
            break;
          case "atomic":
            source = `(?>${content ?? "abc"})`;
            break;
          case "lookahead":
            source = `(?=${content ?? "text"})`;
            break;
          case "negative-lookahead":
            source = `(?!${content ?? "text"})`;
            break;
          case "lookbehind":
            source = `(?<=${content ?? "text"})`;
            break;
          case "negative-lookbehind":
            source = `(?<!${content ?? "text"})`;
            break;
          case "backreference": {
            const name = String(step.name ?? "name");
            if (
              !/^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(name) &&
              !/^[1-9][0-9]*$/.test(name)
            )
              throw new TypeError(
                "Enter a capture name or a positive capture number.",
              );
            source = `\\k<${name}>`;
            break;
          }
          case "either":
            source = `(?:${step.alternatives ? step.alternatives.map((alternative) => (Array.isArray(alternative) ? build(alternative, depth + 1) : escapeRegexLiteral(alternative))).join("|") : (content ?? "yes|no")})`;
            break;
          case "exact":
            source = `{${integerCount(step.count ?? 3)}}`;
            break;
          case "between": {
            const minimum = integerCount(step.min ?? 2);
            const maximum =
              step.max === null ? "" : integerCount(step.max ?? 4);
            if (maximum !== "" && maximum < minimum)
              throw new RangeError(
                "The repetition maximum must be at least the minimum.",
              );
            source = `{${minimum},${maximum}}`;
            break;
          }
          default:
            if (!known) throw new TypeError(`Unknown pattern block: ${id}`);
            source = known.pattern;
        }
        if (step.repeat) {
          const repeat =
            typeof step.repeat === "string"
              ? { kind: step.repeat }
              : step.repeat;
          const suffix =
            repeat.kind === "optional"
              ? "?"
              : repeat.kind === "one-or-more"
                ? "+"
                : repeat.kind === "zero-or-more"
                  ? "*"
                  : repeat.kind === "exact"
                    ? `{${integerCount(repeat.count)}}`
                    : repeat.kind === "range"
                      ? `{${integerCount(repeat.min)},${repeat.max === null ? "" : integerCount(repeat.max)}}`
                      : null;
          if (suffix === null)
            throw new TypeError(`Unknown repetition: ${repeat.kind}`);
          if (
            repeat.kind === "range" &&
            repeat.max !== null &&
            repeat.max < repeat.min
          )
            throw new RangeError(
              "The repetition maximum must be at least the minimum.",
            );
          source = `(?:${source})${suffix}${repeat.lazy ? "?" : ""}`;
        }
        return source;
      })
      .join("");
  };
  const source = build(steps);
  if (anchor === "input") return `\\A(?:${source})\\z`;
  if (anchor === "line") return `^(?:${source})$`;
  if (anchor !== "none")
    throw new TypeError("Anchor must be none, input, or line.");
  return source;
}

function integerCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 2_147_483_647)
    throw new RangeError(
      "Repetition counts must be nonnegative 32-bit integers.",
    );
  return count;
}

/** Assess the actual .NET result; this module does not run a substitute engine. */
export function evaluateLesson(lesson, result) {
  if (!lesson) throw new TypeError("A lesson is required.");
  if (result?.error)
    return {
      passed: false,
      checks: [],
      message:
        typeof result.error === "string"
          ? result.error
          : result.error.message || "The .NET engine reported an error.",
    };
  if (!Array.isArray(result?.matches))
    return {
      passed: false,
      checks: [],
      message: "Run the pattern to check your result.",
    };
  if (result.truncated)
    return {
      passed: false,
      checks: [],
      message:
        "The result was truncated; increase the match limit before checking this lesson.",
    };
  const expected = lesson.expected || [];
  const checks = [
    {
      label: `Find ${expected.length} ${expected.length === 1 ? "match" : "matches"}`,
      passed: result.matches.length === expected.length,
    },
  ];
  expected.forEach((item, index) => {
    const match = result.matches[index];
    checks.push({
      label: `Match ${index + 1}: ${JSON.stringify(item.value)}`,
      passed:
        !!match &&
        match.value === item.value &&
        (item.index === undefined || match.index === item.index),
    });
    for (const [name, value] of Object.entries(item.groups || {})) {
      const group = match?.groups?.find(
        (group) => group.name === name || String(group.number) === name,
      );
      checks.push({
        label: `Group ${name}: ${JSON.stringify(value)}`,
        passed: !!group?.success && group.value === value,
      });
    }
    for (const [name, values] of Object.entries(item.captures || {})) {
      const group = match?.groups?.find(
        (group) => group.name === name || String(group.number) === name,
      );
      checks.push({
        label: `Keep every ${name} capture`,
        passed:
          !!group &&
          JSON.stringify(group.captures?.map((capture) => capture.value)) ===
            JSON.stringify(values),
      });
    }
  });
  const passed = checks.every((check) => check.passed);
  return {
    passed,
    checks,
    message: passed
      ? "You have it. These .NET results meet the challenge."
      : "Not quite yet. Compare the highlighted matches with the challenge, then try again.",
  };
}

export const EXAMPLES = examples;
export const LESSONS = lessons;
export const BUILDER_BLOCKS = builderBlocks;

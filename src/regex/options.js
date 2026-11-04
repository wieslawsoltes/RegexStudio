/** Public .NET RegexOptions values. These are not JavaScript RegExp flags. */
export const RegexOptions = Object.freeze({
  None: 0,
  IgnoreCase: 1,
  Multiline: 2,
  ExplicitCapture: 4,
  Compiled: 8,
  Singleline: 16,
  IgnorePatternWhitespace: 32,
  RightToLeft: 64,
  ECMAScript: 256,
  CultureInvariant: 512,
  NonBacktracking: 1024,
});

export const regexOptions = Object.freeze([
  {
    name: "IgnoreCase",
    value: 1,
    short: "i",
    label: "Ignore case",
    description:
      "Compare letters without case, using the selected .NET culture.",
  },
  {
    name: "Multiline",
    value: 2,
    short: "m",
    label: "Line anchors",
    description:
      "^ and $ also match the beginning and end of individual lines.",
  },
  {
    name: "ExplicitCapture",
    value: 4,
    short: "n",
    label: "Named captures only",
    description: "Only explicitly named or numbered groups capture text.",
  },
  {
    name: "Compiled",
    value: 8,
    short: "",
    label: "Compiled",
    description:
      "Request compiled matching. WebAssembly uses the interpreter when dynamic code is unavailable.",
  },
  {
    name: "Singleline",
    value: 16,
    short: "s",
    label: "Dot includes newlines",
    description: "Let . match every character, including a line feed.",
  },
  {
    name: "IgnorePatternWhitespace",
    value: 32,
    short: "x",
    label: "Free spacing",
    description:
      "Ignore unescaped pattern whitespace and allow # comments outside character classes.",
  },
  {
    name: "RightToLeft",
    value: 64,
    short: "",
    label: "Right to left",
    description: "Search from the end of the input toward its beginning.",
  },
  {
    name: "ECMAScript",
    value: 256,
    short: "",
    label: ".NET ECMAScript mode",
    description:
      "Use .NET’s ECMAScript-compatible behavior. This still executes the .NET engine, not JavaScript RegExp.",
  },
  {
    name: "CultureInvariant",
    value: 512,
    short: "",
    label: "Invariant culture",
    description: "Use the invariant culture for case comparisons.",
  },
  {
    name: "NonBacktracking",
    value: 1024,
    short: "",
    label: "Nonbacktracking",
    description:
      "Use .NET’s linear-time matching engine. Some constructs and capture-history behavior differ.",
  },
]);

export function optionsToNames(options = 0) {
  return regexOptions
    .filter((option) => (options & option.value) !== 0)
    .map((option) => option.name);
}

export function formatRegexOptions(options = 0) {
  const value = Number(options);
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new TypeError("Regex options must be a nonnegative 32-bit integer.");
  }
  const knownMask = regexOptions.reduce(
    (mask, option) => mask | option.value,
    0,
  );
  if ((value & ~knownMask) !== 0) return `(RegexOptions)${value}`;
  return (
    optionsToNames(value)
      .map((name) => `RegexOptions.${name}`)
      .join(" | ") || "RegexOptions.None"
  );
}

export function optionsFromNames(names = []) {
  return names.reduce((value, name) => {
    if (!Object.hasOwn(RegexOptions, name))
      throw new TypeError(`Unknown .NET regex option: ${name}`);
    return value | RegexOptions[name];
  }, 0);
}

export const inlineOptionValues = Object.freeze({
  i: 1,
  m: 2,
  n: 4,
  s: 16,
  x: 32,
});

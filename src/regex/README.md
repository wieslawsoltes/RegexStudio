# Regex language tools

Dependency-free ES modules for explaining, building, and exporting .NET regular expressions. These modules never substitute JavaScript `RegExp` for the execution engine. Exact matching, final validation, replacement, splitting, and VM tracing belong to the .NET engine in `engine/`.

## Analyze

```js
import { analyzePattern } from './analyze.js';
import { RegexOptions } from './options.js';

const analysis = analyzePattern(
  String.raw`\b(?<region>[A-Z]{2})-(?<number>\d{4})\b`,
  RegexOptions.IgnoreCase,
);
```

The result contains:

- `tree`: a source-preserving structural AST. Each node has `id`, `type`, `kind`, `start`, `end`, `raw`, `options`, `children`, `label`, and `description`. Groups expose `body`; repetitions expose `body`, `min`, `max` (`null` means unbounded), and `lazy`.
- `tokens`: nonoverlapping source ranges with `id`, `nodeId`, `start`, `end`, `text`, `kind`, `label`, and `description`. The tokens preserve comments and ignored whitespace.
- `explanations`: user-facing descriptions with source ranges and nesting depth.
- `captureGroups`: group numbers/names and their source occurrences. Named groups follow unnamed groups, explicit numeric slots are preserved, duplicate names share a slot, and inline `n` is respected.
- `summary`: capture/repetition/alternative counts, evaluation direction, and an estimate of whether a structural path can consume zero characters. Assertions may reject such a path.
- `warnings`, `analysisComplete`, and `validSyntaxEstimate`: explanatory diagnostics, **not authoritative .NET validation**. Syntax the reader does not understand remains visible and is delegated to the runtime.

Offsets throughout are UTF-16 code units, matching .NET and browser text selection. Default budgets are 100,000 source units, 10,000 parser nodes, and 96 nested groups. Large/deep expressions retain a visible unexpanded node; the complete pattern still goes to the engine.

The grammar covers literals, .NET escapes, Unicode categories, character-class subtraction, alternation, greedy/lazy repetitions, inline options/comments, numbered/named/duplicate/balancing groups, lookarounds, atomic groups, conditional tests, and backreferences. Numeric escapes that depend on .NET's capture/ECMAScript resolution are labeled conservatively.

## Render structure

```js
import { renderRailroad, buildPatternGraph } from './diagram.js';

container.innerHTML = renderRailroad(analysis, {
  selectedId: null,
  fit: false,
  zoom: 1,
});
```

The generated SVG escapes user-controlled text and attributes, handles XML-invalid control characters and isolated surrogates, and supplies focusable source-linked nodes. Delegate click/keyboard actions using `data-node-id`, `data-start`, and `data-end`. `buildPatternGraph()` provides a renderer-independent graph.

This diagram shows **pattern structure**. The .NET optimizer can merge, eliminate, and rewrite source constructs. The simulator's native opcode offsets consequently must not be presented as a one-to-one mapping to these source nodes.

The SVG uses CSS custom properties including `--text`, `--muted`, `--accent`, `--diagram-rail`, `--diagram-node`, `--diagram-border`, `--diagram-class`, and `--diagram-class-border`, with independent default colors.

## Export C#

```js
import { generateCSharp, generateCsproj } from './codegen.js';

const source = generateCSharp({
  pattern: String.raw`(?<word>\w+)`,
  input: 'café Łódź hello',
  options: 0,
  culture: '', // Invariant culture; same default as the engine.
  timeoutMs: 250,
  operation: 'matches', // Also replace, split, and isMatch.
  replacement: '${word}',
}, { style: 'generated' }); // Or runtime.
```

Both styles produce a complete .NET 10 console program and preserve UTF-16 string contents. Runtime exports create the regex under an explicit comparison culture and restore the caller's culture. Generated exports declare the same culture in `GeneratedRegex` and retain a culture-bound runtime fallback for patterns the generator cannot implement, including `NonBacktracking`. The fallback is correct even if its generated cache was initialized earlier under another culture.

Timeout values are preserved; invalid values cause an error rather than a silent semantic change. Match export enumerates every capture in each successful group's `Captures` collection. `generateCsproj()` supplies a companion project.

## Build and learn

`learning.js` exports `examples`, `lessons`, `builderBlocks`, `referenceSections`, and official `documentationLinks`. `buildPattern()` accepts serializable blocks with nesting, named captures, alternatives, repetition, and optional full-input or line anchors. `escapeRegexLiteral()` and `escapeReplacementLiteral()` apply the appropriate, separate escaping rules.

`evaluateLesson(lesson, result)` checks actual engine output, including named fields and repeated capture histories. It refuses to declare success for truncated results or engine errors.

## Verification

```sh
node --test tests/regex*.test.js
REGEXSTUDIO_DOTNET=/path/to/dotnet node --test tests/regex-native-export.test.js
```

Native verification compiles runtime and source-generated exports and compares them with .NET itself, including Turkish casing, `RightToLeft`, lookbehind, `NonBacktracking`, balancing groups, backreferences, all capture histories, and isolated UTF-16 surrogates. It also checks every learning example's capture numbering and every lesson solution. When no .NET SDK is available, only the native test is explicitly skipped.

## Reference

- [.NET regular expression language](https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-language-quick-reference)
- [.NET grouping constructs](https://learn.microsoft.com/dotnet/standard/base-types/grouping-constructs-in-regular-expressions)
- [Regex options](https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-options)
- [Source-generated regular expressions](https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-source-generators)

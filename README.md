# RegexStudio

**A visual workspace for exploring, comparing, building, and learning regular expressions—with the actual .NET 10 engine running in your browser.**

[Open RegexStudio](https://wieslawsoltes.github.io/RegexStudio/) · [Engine documentation](engine/README.md) · [Data adapters](src/data/README.md) · [Regex language tools](src/regex/README.md)

RegexStudio combines a Fluent-inspired, dockable HTML/JavaScript interface with **.NET 10.0.14 `System.Text.RegularExpressions` in WebAssembly**. Paste expressions and data, compare approaches, inspect captures, and step through the backtracking interpreter. No account or matching server is required.

## Start exploring

1. **Paste or build a pattern.** Use the editor, choose a recipe in **Learn**, or insert searchable building blocks from **Build**. Literal-text insertion escapes special regex characters for you.
2. **Bring your data.** Paste text, drop files onto the workspace, reopen a saved dataset, or connect a CORS-enabled HTTP source. Select a worksheet, column, JSON Pointer, or XPath for structured input.
3. **Run and compare.** Add and name patterns, enable the ones to evaluate, and select **Run all**. **Compare** shows their results against the same input.
4. **Understand the result.** Select a highlighted match to inspect groups and capture history. **Explain** describes the expression; **Pattern map** shows branches and repetition loops. Both link back to source selections.
5. **Follow execution.** In **Simulator**, record a trace and browse it with previous/next, a scrubber, playback, or jumps to backtracking and capture events.
6. **Keep or use your work.** Projects autosave in this browser. Download a project, export results, save a map or trace, or generate C#.

## The workspace

| Area | Features |
| --- | --- |
| Patterns | Multiple named, colored patterns; enable/disable controls; per-pattern .NET options; optional automatic execution after edits. |
| Test data | Editable input, match highlighting, table previews, reusable datasets, replacement preview, and native `Regex.Split` output. |
| Matches | Positions and lengths, named/numbered groups, unsuccessful groups, capture histories, and CSV/JSON/XLSX export. |
| Compare | Counts, timings, coverage strips, and identical versus differing match spans across enabled patterns. |
| Simulator | Native interpreter instructions, input cursor, execution history, backtracking/work/capture stack depths, stack snapshots, active captures, and JSON trace export. |
| Pattern map | Source-linked railroad diagrams with zoom and SVG export. |
| Explain and Build | Plain-language explanations, advisory diagnostics, parameterized building blocks, and literal-text escaping. |
| Learn | Working recipes and 12 progressive lessons with hints, solutions, checks against .NET results, and saved completion. |
| Tests | Saved inputs that should match or should not match the active pattern, using its options, culture, and timeout. |
| C# code | Runtime `Regex` or `GeneratedRegex` programs for matching, replacement, and splitting; copy or download `Program.cs` and a `.csproj`. |

Drag tabs between the inspector and results area, resize dividers, focus a panel, hide secondary panels, and restore the default layout. Layout and workspace settings are saved with the project. Light/dark appearances and layouts for narrow screens are included.

| Action | Shortcut |
| --- | --- |
| Run all enabled patterns | `Ctrl` / `⌘` + `Enter` |
| Download project | `Ctrl` / `⌘` + `S` |
| Open saved projects | `Ctrl` / `⌘` + `O` |
| Previous / next simulator step | `←` / `→`, outside text fields and dialogs |
| Leave panel focus mode; stop playback | `Escape` |

## Exact .NET behavior

Matching, validation, grouping, capture histories, replacement, and splitting execute through the official **.NET 10.0.14** runtime. Options are native `RegexOptions` values, not translations into JavaScript flags. This includes .NET-specific balancing groups, character-class subtraction, duplicate/sparse capture names, right-to-left matching, and `NonBacktracking` behavior.

The default comparison culture is explicitly **invariant**; another culture can be selected, and full ICU data is bundled. Positions and lengths count **UTF-16 code units**, as in .NET strings. For projected data, offsets refer to the playground text, not the original file's bytes. The interop boundary also preserves isolated UTF-16 surrogate code units.

The engine runs in a dedicated module worker. Stop terminates that worker and starts a clean runtime. The default native regex timeout is **250 ms**, adjustable in the UI. .NET applies it to an individual match search; the host separately enforces a **15-second execution deadline** for a dispatched request. Runtime startup has its own deadline.

The studio defaults to **5,000 returned matches** and **10,000 trace events**. Limits are configurable and truncation is identified. The match table renders its first 500 rows for responsiveness; exports include every returned match within the configured limit. Replacement and splitting retain their full native semantics rather than using the match-display limit.

### Authentic interpreter simulation

The simulator executes an instrumented copy of the **.NET 10.0.14 backtracking interpreter**, with upstream source and adaptations recorded in [PROVENANCE.md](engine/RegexStudio.Engine/Reference/PROVENANCE.md).

1. The real .NET parser and optimizer produce the instruction stream.
2. An explicitly preserved reflection boundary reads that stream, constants, and runtime search optimizer.
3. The reference interpreter executes those instructions and records search, execution, backtracking, capture, uncapture, and completed-match events.
4. Every completed trace is compared with uninstrumented BCL execution, including all captures. **`resultsVerified: true` means that comparison passed.**

These are **interpreter instruction steps**, not CPU instructions or an event for every character comparison. Optimized instructions can consume whole character runs; the search optimizer can skip impossible starting positions. Execute events describe state before an instruction, and capture/undo events describe the resulting state. Stack snapshots contain the top 64 values; depth counters describe complete stacks.

The trace budget stops execution and marks the trace incomplete. An incomplete trace never claims verification. Trace timings include instrumentation overhead and are not benchmarks; ordinary comparison timings also vary with browser/runtime conditions.

### Boundaries

- **NonBacktracking:** exact matching is supported, including its different repeated-capture behavior. Internal symbolic-automaton stepping is unavailable. The UI reports this and offers switching to the backtracking interpreter.
- **Compiled:** `RegexOptions.Compiled` is accepted by .NET, but interactive WebAssembly execution uses the interpreter when dynamic compilation is unavailable. Generated C# targets the user's .NET project separately.
- **Explanations and maps:** these describe source structure. Optimized bytecode has no one-to-one mapping to source nodes. Explanation expansion is bounded for very large/deep patterns, and .NET remains the validation authority.

## Files and online data

| Input | Preparation |
| --- | --- |
| Text, logs, Markdown, HTML-as-text | Use the complete text or edit a playground copy. |
| JSON / JSON Lines | Inspect rows and select fields with JSON Pointer; `*` is an explicit wildcard extension, for example `/users/*/email`. |
| XML | Extract values using browser XPath 1.0, for example `//email/text()`. Prefix `d:` refers to a default XML namespace. |
| CSV / TSV | Read quoted delimiters, multiline fields, escaped quotes, and empty cells; select a column or all columns. |
| Excel `.xlsx` | Select worksheets and columns; read shared/inline text, numbers, booleans, dates, and stored formula results. |

Imported source data is retained so changing projections is reversible. Save datasets independently for reuse across projects. Export input as text, structured rows as JSON/XLSX, and workbook data as a new XLSX workbook. Match JSON includes full groups and captures; CSV/XLSX match exports provide tabular fields.

**XLSX formulas are not evaluated:** cached values are read, and missing caches are reported. Export creates data workbooks without preserving original formulas, formatting, drawings, charts, or macros. Legacy binary `.xls`, encrypted workbooks, and ZIP64 archives are unsupported. XML DTDs/custom entities are not expanded. Import/decompression bounds and detailed APIs are documented in [Data adapters](src/data/README.md).

Online sources use an explicit HTTP GET directly from the browser. The source must permit **CORS** and any requested authentication headers. Optional headers apply to that request and are not saved in projects. There is no proxy or automatic polling. Normal matching and file processing keep the input in the browser; connecting a source contacts the URL you select.

## Projects and C# export

Projects store patterns, datasets, options, tests, lesson progress, and layout in **IndexedDB**, with localStorage fallback when database access is unavailable. Save failures are surfaced. Datasets can also be saved independently for reuse.

**Download project** creates a portable `.regexstudio` file containing versioned JSON and embedded datasets. Import it to restore the project in another browser. Browser storage belongs to that profile and can be cleared; there is no automatic cloud synchronization. Project files provide a portable backup.

The C# panel exports a complete .NET 10 console program using a runtime factory or `GeneratedRegex` partial method. It preserves the pattern, input, native options, culture, and timeout; matching examples enumerate complete capture histories. Culture is applied explicitly and restored afterward. Source-generator fallbacks remain culture-correct even if their cached ordinary `Regex` initialized under another ambient culture. Escaping preserves every UTF-16 code unit. Download the companion `.csproj` and run the example with `dotnet run`.

## Build and run locally

Use **Node.js 22+**, **.NET SDK 10.0.403**, and the **`wasm-tools`** workload. The browser project pins its runtime pack to **10.0.14** to match the reference interpreter. The application uses native ES modules and has no npm package dependencies.

```sh
git clone https://github.com/wieslawsoltes/RegexStudio.git
cd RegexStudio

dotnet workload install wasm-tools
npm run build
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/). The development server serves `dist/`; rebuild after edits. Serve over HTTP/HTTPS rather than opening `index.html` as a local file.

`npm run build` publishes the engine and assembles the static distribution. `npm run build:web` rebuilds web files using an already-published runtime; it does not compile the engine and requires a successful engine publish first. Set `DOTNET` to use a custom SDK path. An optional in-process MSBuild configuration for restricted hosts is described in [Engine documentation](engine/README.md).

### Validation

```sh
# JavaScript data, storage, workspace, client, analyzer, and export tests.
npm test

# Native .NET semantics and interpreter/BCL equivalence.
dotnet run --project engine/RegexStudio.Engine.Tests -c Release

# Exercise the published, trimmed WebAssembly JSExport boundary.
npm run build
node engine/wasm-smoke.mjs
```

With .NET on `PATH`, the JavaScript suite also compiles exported C# and compares results with native .NET. Set `REGEXSTUDIO_DOTNET=/path/to/dotnet` when needed; without an SDK, that native export test is explicitly skipped.

Coverage includes .NET-specific syntax, Unicode/culture, capture histories, right-to-left/nonbacktracking behavior, timeouts, truncation, trace equivalence, JSON interop, generated-code fallbacks, persistence, projections, and real XLSX roundtrips. The WASM smoke test catches trimming/marshaling issues missed by desktop tests. Browser interaction checks remain a separate layer.

## Architecture and reuse

| Location | Responsibility |
| --- | --- |
| `src/app.js` | Workspace orchestration, projects, commands, and events. |
| `src/ui/`, `src/styles.css` | Docking, resizing, panels, safe DOM helpers, icons, responsive layout, and themes. |
| `src/engine/` | Worker lifetime, FIFO dispatch, cancellation, deadlines, and .NET interop. |
| `engine/RegexStudio.Engine/` | Native execution, JSON contracts, preserved runtime metadata, and instrumented interpreter. |
| `src/regex/` | Independent analysis, railroad SVG/graph generation, C# export, builders, examples, and lessons. |
| `src/data/` | Independent file/HTTP adapters, projections, ZIP/XLSX processing, and exports. |
| `src/state/` | Versioned project/dataset storage and validated workspace/layout state. |
| `tests/`, `engine/RegexStudio.Engine.Tests/` | JavaScript/native tests and cross-engine verification. |
| `scripts/`, `.github/workflows/pages.yml` | Build, local serving, validation, and Pages deployment. |

Data and regex modules can be imported independently. The engine provides a standalone `bootstrap.js` ES-module entry point in its published AppBundle. Component documentation describes the reusable contracts and examples.

## Deployment

Pushes to `main` run [Build and deploy RegexStudio](.github/workflows/pages.yml). GitHub Actions installs Node 22, SDK 10.0.403 and `wasm-tools`; runs JavaScript/native tests; builds; checks the trimmed WASM exports; uploads `dist/`; and deploys to GitHub Pages. The workflow also supports manual runs.

Application modules, the worker, and all .NET boot resources share a content-addressed release directory so browser caches cannot mix incompatible releases. `build-info.json` records the deployed commit and asset digest.

The distribution is static. Hosting serves the application and runtime assets; regex execution and project storage run in the visitor's browser.

## License

[MIT](LICENSE). Adapted .NET runtime files retain their upstream notices and [MIT license](engine/RegexStudio.Engine/Reference/LICENSE.dotnet.txt); pinned origins and modifications are recorded in [PROVENANCE.md](engine/RegexStudio.Engine/Reference/PROVENANCE.md).

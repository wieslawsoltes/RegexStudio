# RegexStudio .NET 10 engine

This directory contains the reusable execution and tracing component. The web UI
is HTML/JavaScript; all authoritative regex execution is performed by
`System.Text.RegularExpressions` inside the official .NET 10 WebAssembly runtime.
Input never needs to be sent to a matching service.

## Build and test

Install .NET SDK **10.0.403** and `dotnet workload install wasm-tools`. The browser
project pins its runtime pack to **10.0.14**, matching the interpreter source.

```sh
dotnet run --project engine/RegexStudio.Engine.Tests -c Release
dotnet publish engine/RegexStudio.Engine -c Release
node engine/wasm-smoke.mjs
```

The runtime bundle is emitted under
`engine/RegexStudio.Engine/bin/Release/net10.0/browser-wasm/AppBundle/`. Deploy its
`_framework/` directory together with the studio. `bootstrap.js` is a standalone
ES-module entry point for other consumers. The studio loads the runtime in a
dedicated module worker, so a slow expression cannot monopolize the UI thread.

On execution hosts which prohibit local IPC sockets, the standard SDK build task
hosts cannot start. An optional, checked-in MSBuild configuration runs the same
tasks in the existing process without changing SDK files or runtime semantics:

```sh
dotnet publish engine/RegexStudio.Engine -c Release -m:1 -nr:false \
  -p:RegexStudioBuildInProcess=true
```

Regular GitHub Actions builds use the SDK's default task hosting.

## JavaScript interface

```js
import { dotnet } from './_framework/dotnet.js';
const runtime = await dotnet.withDiagnosticTracing(false).create();
const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
const engine = exports.RegexStudio.Engine;

const request = {
  pattern: '(?<digit>\\d)+',
  input: 'Order 123',
  options: 0,
  culture: '',
  timeoutMs: 250,
  maxMatches: 10000,
  operation: 'matches',
  replacement: '${digit}',
  maxSteps: 10000,
};

const result = JSON.parse(engine.Run(JSON.stringify(request)));
const trace = JSON.parse(engine.Trace(JSON.stringify(request)));
```

`options` is the ordinary numeric `RegexOptions` bit mask. The options are not
translated to JavaScript flags. Invalid .NET combinations and syntax are reported
by .NET. An empty culture name selects `CultureInfo.InvariantCulture`; another
name uses that culture for construction and matching. Full ICU data is bundled.

`Run` returns the runtime version, actual algorithm, elapsed and construction
times, matches, all groups (including group zero and unsuccessful groups), and
each group's complete capture history. Sparse numeric group names and duplicate
named groups are retained. All offsets and lengths count **UTF-16 code units**,
as both .NET strings and JavaScript strings do.

The JSON boundary also preserves isolated UTF-16 surrogate code units in input,
patterns, replacements, capture values, split output, and trace data. A small
source-generated JSON string converter retains JavaScript's `\\uXXXX` escapes
instead of rejecting or replacing those units. Ordinary Unicode strings use
the normal BCL serializer path.

For `operation: 'replace'`, `replacement` in the response contains the result of
`Regex.Replace`. For `operation: 'split'`, `splits` contains the result of
`Regex.Split`, including captured delimiters. A display match limit does not
change replacement or split semantics. Results exceeding `maxMatches` are marked
`truncated`, with an explanation. The limit is 1–100,000 displayed matches.

The default 250 ms timeout is passed to the actual `Regex` constructor. Callers
may choose 1–60,000 ms. .NET applies this timeout to an individual match search;
it is not a deadline for processing all matches, serializing a response, or
loading the runtime. The worker host can cancel or replace a worker for a total
wall-clock deadline.

Errors have the shape `{ code, message, offset? }`; parse offsets come directly
from `RegexParseException`. `Run` and `Trace` always return JSON, including for a
malformed request.

## Authentic interpreter tracing

The simulator executes the **optimized .NET 10 backtracking interpreter**. It is
not a JavaScript regex engine and it does not reconstruct an execution from the
final matches.

1. The normal .NET regex constructor parses and optimizes the pattern and writes
   its internal instruction stream.
2. `RuntimeCode` reads that stream, its constant table, and the runtime search
   optimizer. The small reflection boundary is explicit and its members are
   rooted by `ILLink.Descriptors.xml` for trimmed WebAssembly publication.
3. A copy of the .NET 10.0.14 interpreter executes those instructions as a
   `RegexRunner` subclass. Its original backtracking, grouping, repetition,
   balancing, lookaround, and capture logic is retained. It calls the actual
   runtime character-class evaluator and search optimizer.
4. Instrumentation records search, opcode execution, backtracking, capture,
   uncapture, and completed-match events.
5. A completed trace is compared with an uninstrumented BCL execution, including
   every capture. `resultsVerified: true` means that this check passed.

Every event has a step number, opcode address, current/previous input position,
direction, operand values, stack depths, active captures, and a plain-language
description. Stack snapshots contain the top 64 values; depth counters describe
the entire stacks. An execute event describes state **before** that instruction.
Capture events describe state **after** the capture or undo operation.

An optimized opcode can consume an entire character run. These are interpreter
instruction steps, not CPU instructions or an event for every vectorized
character comparison. The native search optimizer may skip impossible starting
positions; those skips are recorded. Optimized bytecode does not preserve a
one-to-one mapping to pattern source spans, so an AST diagram is a separate view.

Tracing has overhead and trace elapsed time is not a performance benchmark. The
trace budget (1–100,000 events) stops execution at the budget boundary and reports
that the trace is incomplete. An incomplete trace never claims verification.

### Algorithm boundaries

The ordinary matching API supports `RegexOptions.NonBacktracking` and preserves
that engine's different capture-history behavior. Its symbolic automaton does
not execute interpreter opcodes, so it returns a clear
`NonBacktrackingTraceUnavailable` response for instruction tracing. The UI must
not label an interpreter trace as a NonBacktracking trace.

`RegexOptions.Compiled` retains its semantics in the browser, but WebAssembly
cannot generate new machine code at runtime and .NET uses the interpreter.
Source-generated C# is intended for the user's .NET project and is separate from
interactive pattern execution.

## Validation

The dependency-free console test suite verifies .NET-specific behaviors,
including Unicode/category subtraction, repeated captures, sparse and duplicate
group names, empty matches, replacements, splitting, balancing groups,
conditional expressions, lookbehind, atomic/lazy/bounded loops, right-to-left,
ECMAScript, Turkish/Greek case-insensitive backreferences, timeouts, explicit
truncation, and the JSON interop boundary. Interpreter traces are compared to
unmodified .NET for the complete match and capture data.

## Source references

- [.NET JavaScript/WASM interop](https://learn.microsoft.com/aspnet/core/client-side/dotnet-interop/wasm-browser-app?view=aspnetcore-10.0)
- [.NET regex options](https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-options)
- [Pinned .NET 10.0.14 regex source](https://github.com/dotnet/runtime/tree/v10.0.14/src/libraries/System.Text.RegularExpressions/src/System/Text/RegularExpressions)
- [Vendored-source provenance](RegexStudio.Engine/Reference/PROVENANCE.md)


# .NET interpreter provenance

The following files originate from the MIT-licensed `dotnet/runtime` repository,
tag **v10.0.14**, directory
[`src/libraries/System.Text.RegularExpressions/src/System/Text/RegularExpressions`](https://github.com/dotnet/runtime/tree/v10.0.14/src/libraries/System.Text.RegularExpressions/src/System/Text/RegularExpressions).

The original license is reproduced in [LICENSE.dotnet.txt](LICENSE.dotnet.txt).
Original source notices remain in every copied file.

| File | Original SHA-256 |
| --- | --- |
| `RegexInterpreter.cs` | `2dc00cf78529cba0da03c688f60c80bb6c51c01fc431d6ca45a51b3b0940aa5c` |
| `RegexOpcode.cs` | `0e4ed011b79dadf925123e17b982d3bfa5e9d89b40d601ec7e5a0ba033c0e60f` |
| `RegexCaseEquivalences.cs` | `5c1be67f2d650140d5466111abd3e95ded4c8b0c23605d690b172afc930b03ba` |
| `RegexCaseEquivalences.Data.cs` | `31d55d2c30a9aaeaec6972dc0811b21571b10d1f046523988d4070f8aa0c8038` |
| `RegexCaseBehavior.cs` | `8c52d21a6ef3c838ef28582157f11fa0b3c099d1206eac0930cd3f218db55d73` |

## Local adaptations

All copied types move to the `RegexStudio.Reference` namespace. The opcode enum,
case-equivalence algorithm, case-equivalence tables, and casing behavior have no
other changes.

The interpreter is made `partial`. Its original factory is replaced by the
studio's `TracingRunnerFactory`, and its internal `RegexInterpreterCode` field is
replaced by `RuntimeCode`, which reads the same data from the actual runtime
factory. The constructor receives an event recorder.

The protected/internal scan override becomes a protected override, as required
when deriving from another assembly. Internal-only calls are adapted as follows:

- `runmatch.FoundMatch` becomes the equivalent protected `IsMatched(0)` check.
- `runregex.roptions` uses the public `runregex.Options` property.
- `RegexCharClass.CharInClass` invokes the runtime's same internal method through
  a preserved, strongly typed delegate, retaining the ASCII lookup cache.
- Boundary predicates use the protected string-based `RegexRunner` methods on
  the same full input. The engine API always executes on strings.
- The runtime's actual `RegexFindOptimizations` methods are called through
  preserved delegates and wrapped in a search event.

An event is inserted before each interpreter `switch` dispatch and after
backtrack restoration. The partial instrumentation file wraps `Capture`,
`TransferCapture`, and `Uncapture`, calling the original base methods and then
recording state. It never changes the choice of opcode, target address, matched
character, capture range, or backtracking decision.

The test suite compares full results and capture histories against the untouched
BCL. Each completed user trace performs the same comparison. Unsupported or
incompatible runtime metadata causes an explicit error rather than an
approximation.


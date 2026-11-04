using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using RegexStudio.Reference;

namespace RegexStudio;

internal static class InterpreterTracing
{
    public static TraceResponse Execute(RegexRequest request)
    {
        Engine.Validate(request);
        var response = new TraceResponse();
        var watch = Stopwatch.StartNew();
        using var culture = new CultureScope(request.Culture);
        try
        {
            if (((RegexOptions)request.Options & RegexOptions.NonBacktracking) != 0)
            {
                response.Kind = "unavailable";
                response.Error = new()
                {
                    Code = "NonBacktrackingTraceUnavailable",
                    Message = "Matching uses the actual .NET NonBacktracking engine. Instruction tracing is available for the backtracking interpreter only; switch the engine to Interpreter to inspect its execution. The two algorithms have different capture behavior, so their traces are not interchangeable."
                };
                return response;
            }

            var recorder = new TraceRecorder(request.MaxSteps, response);
            var regex = new TracingRegex(request.Pattern, (RegexOptions)request.Options & ~RegexOptions.Compiled,
                TimeSpan.FromMilliseconds(request.TimeoutMs), recorder);
            response.Instructions = regex.Code.Instructions();
            response.Warnings.Add("Tracing adds overhead. Trace elapsed time is not a regex performance benchmark.");
            response.Warnings.Add("Each execute event is one real optimized .NET interpreter opcode; a single opcode can process a run of characters. Search optimizations may skip impossible starting positions. Stack snapshots show the top 64 values; depth counters include the entire stack.");

            var match = regex.Match(request.Input);
            while (match.Success)
            {
                if (response.Matches.Count == request.MaxMatches)
                {
                    response.Truncated = true;
                    response.TruncationReason = $"The display limit of {request.MaxMatches:N0} matches was reached.";
                    break;
                }
                var result = Engine.ToResult(regex, match);
                response.Matches.Add(result);
                recorder.Add(new()
                {
                    Kind = "match", Opcode = "Match", CodePosition = -1,
                    Position = match.Index, PreviousPosition = match.Index + match.Length,
                    RightToLeft = regex.RightToLeft,
                    Description = $"Match {response.Matches.Count} captures [{match.Index}, {match.Index + match.Length}) — {match.Length} UTF-16 code units.",
                    Captures = result.Groups.Where(x => x.Success).Select(x => new TraceCapture
                    {
                        Number = x.Number, Name = x.Name, Index = x.Index, Length = x.Length
                    }).ToList()
                });
                match = match.NextMatch();
            }

            // This is a correctness check against the uninstrumented BCL,
            // including all capture histories, and is never used to invent a
            // trace when the interpreter cannot execute a construct.
            var reference = Engine.Execute(new RegexRequest
            {
                Pattern = request.Pattern, Input = request.Input, Options = request.Options & ~(int)RegexOptions.Compiled,
                TimeoutMs = request.TimeoutMs, Culture = request.Culture, MaxMatches = request.MaxMatches
            });
            if (reference.Error is null)
            {
                response.ResultsVerified = JsonSerializer.Serialize(response.Matches, EngineJsonContext.Default.ListMatchResult) ==
                    JsonSerializer.Serialize(reference.Matches, EngineJsonContext.Default.ListMatchResult);
                if (response.ResultsVerified == false)
                {
                    response.Error = new() { Code = "TraceVerificationFailed", Message = "The instrumented interpreter differed from the reference .NET engine. Use the authoritative matches view; this trace must not be treated as equivalent." };
                }
            }
            else
            {
                response.Warnings.Add("The separate reference verification did not complete: " + reference.Error.Message);
            }
        }
        catch (TraceLimitException)
        {
            response.Truncated = true;
            response.TruncationReason = $"Execution was stopped after {request.MaxSteps:N0} trace events. Increase the trace limit or shorten the input to continue further.";
        }
        catch (Exception error)
        {
            response.Error = Engine.DescribeError(error);
        }
        finally
        {
            response.ElapsedMs = watch.Elapsed.TotalMilliseconds;
        }
        return response;
    }
}

internal sealed class TracingRegex : Regex
{
    public RuntimeCode Code { get; }

    public TracingRegex(string expression, RegexOptions options, TimeSpan timeout, TraceRecorder recorder)
        : base(expression, options, timeout)
    {
        Code = new RuntimeCode(factory!);
        recorder.GroupNumbers = GetGroupNumbers();
        recorder.GroupNames = recorder.GroupNumbers.Select(GroupNameFromNumber).ToArray();
        factory = new TracingRunnerFactory(Code, recorder);
    }
}

internal sealed class TracingRunnerFactory(RuntimeCode code, TraceRecorder recorder) : RegexRunnerFactory
{
    protected override RegexRunner CreateInstance() => new RegexInterpreter(code, code.Culture, recorder);
}

internal sealed class TraceRecorder(int maxSteps, TraceResponse response)
{
    public int[] GroupNumbers { get; set; } = [];
    public string[] GroupNames { get; set; } = [];

    public void Add(TraceEvent step)
    {
        if (response.Events.Count >= maxSteps) throw new TraceLimitException();
        step.Step = response.Events.Count;
        response.Events.Add(step);
    }
}

internal sealed class TraceLimitException : Exception;


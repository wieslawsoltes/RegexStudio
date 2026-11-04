using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RegexStudio;

/// <summary>
/// A JSON ABI over the real .NET regex implementation. No JavaScript regular
/// expression is used for matching, capture extraction, replacement or splitting.
/// </summary>
public static partial class Engine
{
#if BROWSER
    [JSExport]
#endif
    public static string Run(string json)
    {
        RegexResponse response;
        try
        {
            var request = Deserialize(json);
            response = Execute(request);
        }
        catch (Exception error)
        {
            response = new RegexResponse { Error = DescribeError(error) };
        }
        return JsonSerializer.Serialize(response, EngineJsonContext.Default.RegexResponse);
    }

#if BROWSER
    [JSExport]
#endif
    public static string Trace(string json)
    {
        TraceResponse response;
        try
        {
            response = InterpreterTracing.Execute(Deserialize(json));
        }
        catch (Exception error)
        {
            response = new TraceResponse { Error = DescribeError(error) };
        }
        return JsonSerializer.Serialize(response, EngineJsonContext.Default.TraceResponse);
    }

    public static RegexResponse Execute(RegexRequest request)
    {
        Validate(request);
        using var culture = new CultureScope(request.Culture);
        var response = new RegexResponse { Options = request.Options, Culture = CultureInfo.CurrentCulture.Name };
        var watch = Stopwatch.StartNew();
        try
        {
            var options = (RegexOptions)request.Options;
            var regex = new Regex(request.Pattern, options, TimeSpan.FromMilliseconds(request.TimeoutMs));
            response.ConstructionMs = watch.Elapsed.TotalMilliseconds;
            var nonBacktracking = (options & RegexOptions.NonBacktracking) != 0;
            var compiled = (options & RegexOptions.Compiled) != 0 && RuntimeFeature.IsDynamicCodeCompiled;
            response.Algorithm = nonBacktracking ? "non-backtracking" : compiled ? "compiled" : "interpreter";
            if ((options & RegexOptions.Compiled) != 0)
            {
                if (nonBacktracking)
                    response.Warnings.Add("RegexOptions.Compiled does not change the NonBacktracking engine.");
                else if (!compiled)
                    response.Warnings.Add("RegexOptions.Compiled is a hint. Browser WebAssembly uses the interpreter because runtime code generation is unavailable; matching semantics are unchanged.");
            }

            var match = regex.Match(request.Input);
            while (match.Success)
            {
                if (response.Matches.Count == request.MaxMatches)
                {
                    response.Truncated = true;
                    response.TruncationReason = $"Only the first {request.MaxMatches:N0} matches are displayed. Increase the match limit to inspect more.";
                    break;
                }
                response.Matches.Add(ToResult(regex, match));
                match = match.NextMatch();
            }

            switch (request.Operation)
            {
                case "replace":
                    response.Replacement = regex.Replace(request.Input, request.Replacement);
                    break;
                case "split":
                    response.Splits = regex.Split(request.Input);
                    break;
            }
        }
        catch (Exception error)
        {
            response.Error = DescribeError(error);
        }
        finally
        {
            response.ElapsedMs = watch.Elapsed.TotalMilliseconds;
        }
        return response;
    }

    internal static RegexRequest Deserialize(string json) =>
        JsonSerializer.Deserialize(json, EngineJsonContext.Default.RegexRequest) ?? throw new ArgumentException("A regex request is required.");

    internal static void Validate(RegexRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Pattern);
        ArgumentNullException.ThrowIfNull(request.Input);
        ArgumentNullException.ThrowIfNull(request.Replacement);
        if (request.TimeoutMs is < 1 or > 60_000)
            throw new ArgumentOutOfRangeException(nameof(request.TimeoutMs), "Choose a timeout between 1 and 60,000 milliseconds.");
        if (request.MaxMatches is < 1 or > 100_000)
            throw new ArgumentOutOfRangeException(nameof(request.MaxMatches), "Choose a display limit between 1 and 100,000 matches.");
        if (request.MaxSteps is < 1 or > 100_000)
            throw new ArgumentOutOfRangeException(nameof(request.MaxSteps), "Choose a trace limit between 1 and 100,000 events.");
        if (request.Operation is not ("matches" or "replace" or "split"))
            throw new ArgumentException("Operation must be matches, replace or split.", nameof(request.Operation));
    }

    internal static MatchResult ToResult(Regex regex, Match match)
    {
        var result = new MatchResult { Index = match.Index, Length = match.Length, Value = match.Value };
        foreach (var number in regex.GetGroupNumbers())
        {
            var group = match.Groups[number];
            var data = new GroupResult
            {
                Name = regex.GroupNameFromNumber(number), Number = number,
                Index = group.Index, Length = group.Length, Value = group.Value, Success = group.Success
            };
            foreach (Capture capture in group.Captures)
            {
                data.Captures.Add(new CaptureResult { Index = capture.Index, Length = capture.Length, Value = capture.Value });
            }
            result.Groups.Add(data);
        }
        return result;
    }

    internal static RegexError DescribeError(Exception error) => error switch
    {
        RegexParseException parse => new() { Code = parse.Error.ToString(), Message = parse.Message, Offset = parse.Offset },
        RegexMatchTimeoutException => new() { Code = "RegexMatchTimeout", Message = "The .NET regex engine reached the configured match timeout. Simplify the pattern, shorten the input, increase the timeout, or use NonBacktracking when the expression supports it." },
        _ => new() { Code = error.GetType().Name, Message = error.Message }
    };
}

internal sealed class CultureScope : IDisposable
{
    private readonly CultureInfo _previousCulture = CultureInfo.CurrentCulture;
    private readonly CultureInfo _previousUICulture = CultureInfo.CurrentUICulture;

    public CultureScope(string? name)
    {
        var culture = string.IsNullOrEmpty(name) ? CultureInfo.InvariantCulture : CultureInfo.GetCultureInfo(name);
        CultureInfo.CurrentCulture = culture;
        CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
    }

    public void Dispose()
    {
        CultureInfo.CurrentCulture = _previousCulture;
        CultureInfo.CurrentUICulture = _previousUICulture;
    }
}


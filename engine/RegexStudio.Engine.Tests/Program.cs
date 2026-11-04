using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using RegexStudio;

var failures = new List<string>();
var assertions = 0;
void Check(bool condition, string description)
{
    assertions++;
    if (!condition) failures.Add(description);
}

// These expressions exercise runtime-specific behavior that JavaScript regex
// engines and most educational simulators cannot reproduce faithfully.
(string Pattern, string Input, RegexOptions Options, string Culture)[] cases =
[
    ("cat", "a cat and a caterpillar", 0, ""),
    ("", "abc", 0, ""),
    ("a*", "baa", 0, ""),
    ("^$", "", 0, ""),
    (@"\b\w+\b", "café Δοκιμή 東京 Łódź ١٢٣", 0, ""),
    (@"\d+", "ab١٢٣ and 123 and ৪৫", 0, ""),
    (@"[a-z-[aeiou]]+", "the quick brown fox", 0, ""),
    (@"[\p{Lu}\p{Lt}]+", "aAbÉĆǅẞ", 0, ""),
    (@"(?<word>\w+)(?:\s+\k<word>)+", "go go go stop no no", 0, ""),
    (@"(?<x>a)+", "aaa", 0, ""),
    (@"(?<x>a)|(?<x>b)", "ab", 0, ""),
    (@"(?<7>a)(?<2>b)(?<name>c)", "abc", 0, ""),
    (@"(?<=\d{1,4})abc", "123abc abc", 0, ""),
    (@"(?<=foo)bar|baz(?=qux)", "foobar bazqux", 0, ""),
    (@"(?<!foo)bar|baz(?!qux)", "foobar bar bazqux baz", 0, ""),
    (@"(?>a+)a|a+b", "aaab aaa", 0, ""),
    (@"(?<open>\()+(?<-open>\))+(?(open)(?!))", "(()) () ((())", 0, ""),
    (@"(?<N>foo)?(?(N)bar|baz)", "foobar baz foobaz", 0, ""),
    (@"(?(?=foo)foo|bar)", "foo bar baz", 0, ""),
    (@"(a|ab)+?b", "aaabab", 0, ""),
    (@"a{2,4}?a", "aaaaaaa", 0, ""),
    (@"(?:ab){1,3}c", "abababc abc", 0, ""),
    (@"(?:ab){1,3}?c", "abababc abc", 0, ""),
    (@"(?:a?)*b", "aaab b", 0, ""),
    (@"(?:a?)*?b", "aaab b", 0, ""),
    (@"(?:a?){1,3}?b", "aaab b", 0, ""),
    (@"[^x]+?x", "aaax bbx", 0, ""),
    (@"[^x]{2,4}x", "aaax bbx", 0, ""),
    (@"[ab]{2,4}?c", "aabbc abbc", 0, ""),
    (@"\A.+\z", "abc\n", 0, ""),
    (@"\G\w,?", "a,b,c, x,y", 0, ""),
    (@"^word$", "word\nword\r\nword", RegexOptions.Multiline, ""),
    (@"a.b", "a\nb", RegexOptions.Singleline, ""),
    (@"(?i:abc)(?-i:DEF)", "AbcDEF abcdef", 0, ""),
    ("(?x) (?<n> \\d+ ) # comment\n \\s*", "123 456", 0, ""),
    (@"(a)(?<b>b)", "abab", RegexOptions.ExplicitCapture, ""),
    (@"\w+", "one two three", RegexOptions.RightToLeft, ""),
    (@"(?<x>\d)+", "123 45", RegexOptions.RightToLeft, ""),
    (@"\b\w+\b", "café Δοκιμή 123", RegexOptions.ECMAScript, ""),
    (@"\Bfoo\B", "xfooy foo", 0, ""),
    (@"\Bfoo\B", "xfooy foo", RegexOptions.ECMAScript, ""),
    (@"(a)?\1b", "b ab aab", RegexOptions.ECMAScript, ""),
    (@"(?i)(?<x>i)\k<x>", "ii iI iİ iı II İİ ıı", 0, ""),
    (@"(?i)(?<x>i)\k<x>", "ii iI iİ iı II İİ ıı", 0, "tr-TR"),
    (@"(?i)(?<x>i)\k<x>", "ii iI iİ iı II İİ ıı", 0, "en-US"),
    (@"(?i)(?<x>Σ)\k<x>", "ΣΣ σς ςσ Σς", 0, "el-GR"),
    (@"(?i)(?<x>k)\k<x>", "kK KK Kk", 0, ""),
    (@"(?i)file", "FILE FİLE fıle file", RegexOptions.CultureInvariant, "tr-TR"),
    (@"😀+|.", "A😀😀Z", 0, ""),
    (@"(ab|a)c", "aac abc ac", 0, ""),
    (@".*?END", "one END two END", 0, ""),
    (@".*END", "one END two END", 0, ""),
    (@"(?>a|ab)b", "abb ab", 0, ""),
    (@"(?:(?<x>a)|b)+\k<x>", "abbab ba", 0, ""),
    (@"(?<a-b>x)", "x", 0, ""), // Invalid balancing reference is asserted separately.
];

foreach (var (pattern, input, options, cultureName) in cases)
{
    var request = new RegexRequest { Pattern = pattern, Input = input.Replace("\\n", "\n").Replace("\\r", "\r"), Options = (int)options, Culture = cultureName, TimeoutMs = 2000, MaxSteps = 100_000 };
    var exact = Engine.Execute(request);
    var trace = InterpreterTracing.Execute(request);
    if (pattern == @"(?<a-b>x)")
    {
        Check(exact.Error?.Offset is not null && trace.Error?.Offset is not null, "Invalid balancing references return a .NET parse offset.");
        continue;
    }
    Check(exact.Error is null, $"Reference engine failed for {pattern}: {exact.Error?.Message}");
    Check(trace.Error is null, $"Trace failed for {pattern}: {trace.Error?.Message}");
    Check(!trace.Truncated, $"Unexpected trace truncation for {pattern}");
    Check(trace.ResultsVerified == true, $"Trace does not match BCL captures for {pattern} ({cultureName})");
    Check(trace.Events.Count > 0, $"Trace events missing for {pattern}");
}

var captures = Engine.Execute(new() { Pattern = @"(?<digit>\d)+", Input = "123" });
Check(captures.Matches[0].Groups.Single(x => x.Name == "digit").Captures.Select(x => x.Value).SequenceEqual(["1", "2", "3"]), "Every .NET capture in a repeated group is preserved.");

var nonbacktracking = Engine.Execute(new() { Pattern = @"(?<digit>\d)+", Input = "123", Options = (int)RegexOptions.NonBacktracking });
Check(nonbacktracking.Algorithm == "non-backtracking" && nonbacktracking.Matches[0].Groups.Single(x => x.Name == "digit").Captures.Count == 1, "NonBacktracking preserves its own final-capture semantics.");
var unavailable = InterpreterTracing.Execute(new() { Pattern = "a+", Input = "aaa", Options = (int)RegexOptions.NonBacktracking });
Check(unavailable.Kind == "unavailable" && unavailable.Error?.Code == "NonBacktrackingTraceUnavailable", "NonBacktracking is never passed off as an interpreter trace.");

var replacement = Engine.Execute(new() { Pattern = @"(?<word>\w+)", Input = "one two", Operation = "replace", Replacement = "${word}:$&:$$" });
Check(replacement.Replacement == "one:one:$ two:two:$", ".NET replacement tokens are evaluated by .NET.");
var splits = Engine.Execute(new() { Pattern = @"(,)", Input = "a,b,c", Operation = "split" });
Check(splits.Splits!.SequenceEqual(["a", ",", "b", ",", "c"]), ".NET split includes captured delimiters.");

var limited = Engine.Execute(new() { Pattern = "a", Input = "aaaa", MaxMatches = 2 });
Check(limited.Truncated && limited.Matches.Count == 2, "Match truncation is explicit.");
var traceLimited = InterpreterTracing.Execute(new() { Pattern = "a+", Input = "aaa", MaxSteps = 2 });
Check(traceLimited.Truncated && traceLimited.Events.Count == 2 && traceLimited.ResultsVerified is null, "Trace budget stops execution and does not claim verification.");

var bad = Engine.Execute(new() { Pattern = "(", Input = "" });
Check(bad.Error is { Offset: not null }, "Parse error exposes position.");
using var malformed = JsonDocument.Parse(Engine.Run("{"));
Check(malformed.RootElement.GetProperty("error").GetProperty("code").GetString() == "JsonException", "Malformed requests cross the JSON boundary as structured errors.");
using var serialized = JsonDocument.Parse(Engine.Run("{\"pattern\":\"(?<x>a)+\",\"input\":\"aaa\"}"));
Check(serialized.RootElement.GetProperty("matches")[0].GetProperty("value").GetString() == "aaa", "Browser JSON ABI uses camel-case keys.");
using var serializedTrace = JsonDocument.Parse(Engine.Trace("{\"pattern\":\"a+\",\"input\":\"aaa\"}"));
Check(serializedTrace.RootElement.GetProperty("resultsVerified").GetBoolean(), "Trace JSON ABI serializes its complete native event schema.");

var previousCulture = CultureInfo.CurrentCulture;
_ = Engine.Execute(new() { Pattern = "i", Input = "İ", Options = (int)RegexOptions.IgnoreCase, Culture = "tr-TR" });
Check(CultureInfo.CurrentCulture.Equals(previousCulture), "Culture is restored after each request.");

var catastrophic = Engine.Execute(new() { Pattern = "^(a+)+$", Input = new string('a', 10_000) + "!", TimeoutMs = 1 });
Check(catastrophic.Error?.Code == "RegexMatchTimeout", "Catastrophic backtracking respects the .NET timeout.");

if (failures.Count > 0)
{
    Console.Error.WriteLine($"FAILED: {failures.Count} of {assertions} assertions");
    foreach (var failure in failures) Console.Error.WriteLine("  " + failure);
    return 1;
}
Console.WriteLine($"PASS: {assertions} assertions, {cases.Length} interpreter/BCL parity cases on .NET {Environment.Version}.");
return 0;


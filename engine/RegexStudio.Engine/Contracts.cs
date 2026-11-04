using System.Text.Json.Serialization;

namespace RegexStudio;

public sealed class RegexRequest
{
    public string Pattern { get; set; } = "";
    public string Input { get; set; } = "";
    public int Options { get; set; }
    public int TimeoutMs { get; set; } = 250;
    public string Culture { get; set; } = "";
    public string Replacement { get; set; } = "";
    public int MaxMatches { get; set; } = 10_000;
    public int MaxSteps { get; set; } = 10_000;
    public string Operation { get; set; } = "matches";
}

public sealed class RegexResponse
{
    public string Engine { get; set; } = ".NET 10";
    public string Version { get; set; } = Environment.Version.ToString();
    public string Algorithm { get; set; } = "interpreter";
    public string Culture { get; set; } = "";
    public int Options { get; set; }
    public List<MatchResult> Matches { get; set; } = [];
    public double ElapsedMs { get; set; }
    public double ConstructionMs { get; set; }
    public bool Truncated { get; set; }
    public string? TruncationReason { get; set; }
    public string? Replacement { get; set; }
    public string[]? Splits { get; set; }
    public RegexError? Error { get; set; }
    public List<string> Warnings { get; set; } = [];
}

public sealed class RegexError
{
    public string Code { get; set; } = "Error";
    public string Message { get; set; } = "";
    public int? Offset { get; set; }
}

public class CaptureResult
{
    public int Index { get; set; }
    public int Length { get; set; }
    public string Value { get; set; } = "";
}

public sealed class GroupResult : CaptureResult
{
    public string Name { get; set; } = "";
    public int Number { get; set; }
    public bool Success { get; set; }
    public List<CaptureResult> Captures { get; set; } = [];
}

public sealed class MatchResult : CaptureResult
{
    public List<GroupResult> Groups { get; set; } = [];
}

public sealed class TraceResponse
{
    public string Engine { get; set; } = ".NET 10";
    public string Version { get; set; } = Environment.Version.ToString();
    public string Kind { get; set; } = "dotnet-interpreter";
    public string SourceVersion { get; set; } = "10.0.14";
    public string Description { get; set; } = "The .NET 10 optimized interpreter, with an event before every executed opcode. Search-optimization skips are recorded separately. Indices are UTF-16 code units.";
    public List<TraceEvent> Events { get; set; } = [];
    public List<TraceInstruction> Instructions { get; set; } = [];
    public List<MatchResult> Matches { get; set; } = [];
    public double ElapsedMs { get; set; }
    public bool Truncated { get; set; }
    public bool? ResultsVerified { get; set; }
    public string? TruncationReason { get; set; }
    public RegexError? Error { get; set; }
    public List<string> Warnings { get; set; } = [];
}

public sealed class TraceEvent
{
    public int Step { get; set; }
    public string Kind { get; set; } = "execute";
    public string Opcode { get; set; } = "";
    public int CodePosition { get; set; }
    public int Position { get; set; }
    public int? PreviousPosition { get; set; }
    public int TrackDepth { get; set; }
    public int StackDepth { get; set; }
    public int CaptureDepth { get; set; }
    public string Description { get; set; } = "";
    public int[] Operands { get; set; } = [];
    public bool RightToLeft { get; set; }
    public int[] Track { get; set; } = [];
    public int[] Stack { get; set; } = [];
    public List<TraceCapture> Captures { get; set; } = [];
}

public sealed class TraceCapture
{
    public int Number { get; set; }
    public string Name { get; set; } = "";
    public int Index { get; set; }
    public int Length { get; set; }
}

public sealed class TraceInstruction
{
    public int Offset { get; set; }
    public string Opcode { get; set; } = "";
    public int[] Operands { get; set; } = [];
    public string Label { get; set; } = "";
    public bool RightToLeft { get; set; }
    public string? Text { get; set; }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    Converters = [typeof(Utf16StringConverter)])]
[JsonSerializable(typeof(RegexRequest))]
[JsonSerializable(typeof(RegexResponse))]
[JsonSerializable(typeof(TraceResponse))]
[JsonSerializable(typeof(List<MatchResult>))]
internal partial class EngineJsonContext : JsonSerializerContext;


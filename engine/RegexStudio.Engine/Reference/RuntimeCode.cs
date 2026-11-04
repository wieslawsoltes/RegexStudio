using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;

namespace RegexStudio.Reference;

/// <summary>
/// Reads the actual .NET parser/writer output. Reflection is isolated here, and
/// the referenced members are explicitly retained by ILLink.Descriptors.xml.
/// We do not parse or translate .NET regex syntax in JavaScript.
/// </summary>
internal sealed class RuntimeCode
{
    internal delegate bool FindPosition(ReadOnlySpan<char> text, ref int position, int start);
    internal delegate bool ClassTest(char value, string set, ref uint[]? asciiLookup);

    public int[] Codes { get; }
    public string[] Strings { get; }
    public uint[]?[] StringsAsciiLookup { get; }
    public int TrackCount { get; }
    public CultureInfo? Culture { get; }
    public FindPosition FindLeftToRight { get; }
    public FindPosition FindRightToLeft { get; }

    private const BindingFlags Fields = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
    private static readonly ClassTest TestClass = CreateClassTest();

    [UnconditionalSuppressMessage("Trimming", "IL2075", Justification = "All inspected runtime members are retained by ILLink.Descriptors.xml and checked by integration tests.")]
    public RuntimeCode(RegexRunnerFactory factory)
    {
        if (Environment.Version.Major != 10)
            throw new NotSupportedException("The native interpreter trace adapter requires .NET 10.");

        var type = factory.GetType();
        if (type.FullName != "System.Text.RegularExpressions.RegexInterpreterFactory")
            throw new NotSupportedException("This trace adapter supports the .NET backtracking interpreter. Select the interpreter to inspect its actual opcode execution.");

        var code = Read(type, factory, "_code");
        var codeType = code.GetType();
        Codes = (int[])Read(codeType, code, "Codes");
        Strings = (string[])Read(codeType, code, "Strings");
        StringsAsciiLookup = new uint[Strings.Length][];
        TrackCount = (int)Read(codeType, code, "TrackCount");
        Culture = type.GetField("_culture", Fields)?.GetValue(factory) as CultureInfo;

        var find = Read(codeType, code, "FindOptimizations");
        var findType = find.GetType();
        FindLeftToRight = CreateFinder(findType, find, "TryFindNextStartingPositionLeftToRight");
        FindRightToLeft = CreateFinder(findType, find, "TryFindNextStartingPositionRightToLeft");

        // Validate the complete stream before executing any instruction. A
        // future incompatible runtime fails visibly rather than guessing.
        var offset = 0;
        while (offset < Codes.Length)
        {
            var length = Size((RegexOpcode)Codes[offset]);
            if (offset + length > Codes.Length)
                throw new NotSupportedException("The runtime produced an incompatible regex instruction stream.");
            offset += length;
        }
    }

    [UnconditionalSuppressMessage("Trimming", "IL2070", Justification = "The named runtime types are rooted in ILLink.Descriptors.xml.")]
    private static object Read(Type type, object instance, string field) =>
        type.GetField(field, Fields)?.GetValue(instance) ??
        throw new NotSupportedException($"The .NET runtime does not expose the expected trace metadata ({type.Name}.{field}).");

    [UnconditionalSuppressMessage("Trimming", "IL2070", Justification = "RegexFindOptimizations is retained in ILLink.Descriptors.xml.")]
    private static FindPosition CreateFinder(Type type, object target, string method) =>
        (type.GetMethod(method, Fields) ?? throw new NotSupportedException($"Missing runtime regex search method {method}."))
        .CreateDelegate<FindPosition>(target);

    [UnconditionalSuppressMessage("Trimming", "IL2026", Justification = "RegexCharClass.CharInClass is explicitly retained in ILLink.Descriptors.xml.")]
    [UnconditionalSuppressMessage("Trimming", "IL2075", Justification = "RegexCharClass.CharInClass is explicitly retained in ILLink.Descriptors.xml.")]
    private static ClassTest CreateClassTest()
    {
        var type = typeof(Regex).Assembly.GetType("System.Text.RegularExpressions.RegexCharClass", throwOnError: true)!;
        var method = type.GetMethod("CharInClass", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
            [typeof(char), typeof(string), typeof(uint[]).MakeByRefType()]);
        return (method ?? throw new NotSupportedException("Missing .NET character-class evaluator.")).CreateDelegate<ClassTest>();
    }

    public static bool CharInClass(char value, string set, ref uint[]? asciiLookup) => TestClass(value, set, ref asciiLookup);

    public static int Size(RegexOpcode opcode) => (opcode & RegexOpcode.OperatorMask) switch
    {
        RegexOpcode.Nothing or RegexOpcode.Bol or RegexOpcode.Eol or RegexOpcode.Boundary or RegexOpcode.NonBoundary or
        RegexOpcode.ECMABoundary or RegexOpcode.NonECMABoundary or RegexOpcode.Beginning or RegexOpcode.Start or
        RegexOpcode.EndZ or RegexOpcode.End or RegexOpcode.Nullmark or RegexOpcode.Setmark or RegexOpcode.Getmark or
        RegexOpcode.Setjump or RegexOpcode.Backjump or RegexOpcode.Forejump or RegexOpcode.Stop or RegexOpcode.UpdateBumpalong => 1,

        RegexOpcode.One or RegexOpcode.Notone or RegexOpcode.Multi or RegexOpcode.Backreference or RegexOpcode.TestBackreference or
        RegexOpcode.Goto or RegexOpcode.Nullcount or RegexOpcode.Setcount or RegexOpcode.Lazybranch or RegexOpcode.Branchmark or
        RegexOpcode.Lazybranchmark or RegexOpcode.Set => 2,

        RegexOpcode.Capturemark or RegexOpcode.Branchcount or RegexOpcode.Lazybranchcount or RegexOpcode.Onerep or
        RegexOpcode.Notonerep or RegexOpcode.Oneloop or RegexOpcode.Oneloopatomic or RegexOpcode.Notoneloop or
        RegexOpcode.Notoneloopatomic or RegexOpcode.Onelazy or RegexOpcode.Notonelazy or RegexOpcode.Setlazy or
        RegexOpcode.Setrep or RegexOpcode.Setloop or RegexOpcode.Setloopatomic => 3,

        _ => throw new NotSupportedException($"Unknown .NET regex opcode {(int)opcode}.")
    };

    public int[] OperandsAt(int offset) => Codes.AsSpan(offset + 1, Size((RegexOpcode)Codes[offset]) - 1).ToArray();

    public List<TraceInstruction> Instructions()
    {
        List<TraceInstruction> instructions = [];
        for (var offset = 0; offset < Codes.Length; offset += Size((RegexOpcode)Codes[offset]))
        {
            var code = (RegexOpcode)Codes[offset];
            var operands = OperandsAt(offset);
            instructions.Add(new()
            {
                Offset = offset, Opcode = Name(code), Operands = operands,
                Label = Explain(code, operands), RightToLeft = (code & RegexOpcode.RightToLeft) != 0,
                Text = (code & RegexOpcode.OperatorMask) == RegexOpcode.Multi ? Strings[operands[0]] : null
            });
        }
        return instructions;
    }

    public static string Name(RegexOpcode code)
    {
        var name = (code & RegexOpcode.OperatorMask).ToString();
        if ((code & RegexOpcode.Backtracking) != 0) name += " · backtrack";
        if ((code & RegexOpcode.BacktrackingSecond) != 0) name += " · backtrack 2";
        if ((code & RegexOpcode.CaseInsensitive) != 0) name += " · ignore case";
        return name;
    }

    public string Explain(RegexOpcode code, int[] args)
    {
        if ((code & (RegexOpcode.Backtracking | RegexOpcode.BacktrackingSecond)) != 0)
            return $"Revisit {(code & RegexOpcode.OperatorMask)} after a later part failed; restore or reduce its earlier choice.";
        var opcode = code & RegexOpcode.OperatorMask;
        string Character() => JsonEscape((char)args[0]);
        string Limit() => args[1] == int.MaxValue ? "as many characters as possible" : $"up to {args[1]} characters";
        return opcode switch
        {
            RegexOpcode.One => $"Consume the literal {Character()} if it matches the next character.",
            RegexOpcode.Notone => $"Consume one character other than {Character()}.",
            RegexOpcode.Multi => $"Match the literal string {System.Text.Json.JsonSerializer.Serialize(Strings[args[0]], EngineJsonContext.Default.String)}.",
            RegexOpcode.Set => $"Consume a character in .NET Unicode character class #{args[0]}.",
            RegexOpcode.Onerep => $"Require exactly {args[1]} copies of {Character()}.",
            RegexOpcode.Notonerep => $"Require exactly {args[1]} characters other than {Character()}.",
            RegexOpcode.Setrep => $"Require exactly {args[1]} characters in character class #{args[0]}.",
            RegexOpcode.Oneloop => $"Greedily consume {Limit()} equal to {Character()}; save shorter choices for backtracking.",
            RegexOpcode.Notoneloop => $"Greedily consume {Limit()} other than {Character()}; save shorter choices.",
            RegexOpcode.Setloop => $"Greedily consume {Limit()} in character class #{args[0]}; save shorter choices.",
            RegexOpcode.Oneloopatomic => $"Atomically consume {Limit()} equal to {Character()}; no shorter choices are saved.",
            RegexOpcode.Notoneloopatomic => $"Atomically consume {Limit()} other than {Character()}; no shorter choices are saved.",
            RegexOpcode.Setloopatomic => $"Atomically consume {Limit()} in character class #{args[0]}; no shorter choices are saved.",
            RegexOpcode.Onelazy or RegexOpcode.Notonelazy or RegexOpcode.Setlazy => "Initially consume nothing; save the option to expand this lazy repetition if the following expression fails.",
            RegexOpcode.Capturemark when args[1] >= 0 => $"Balance capture slot {args[1]} and capture the interval into slot {args[0]}.",
            RegexOpcode.Capturemark => $"Capture the interval from the saved group start into capture slot {args[0]}.",
            RegexOpcode.Backreference => $"Match the text previously captured by capture slot {args[0]}.",
            RegexOpcode.TestBackreference => $"Continue only if capture slot {args[0]} has a successful capture.",
            RegexOpcode.Lazybranch => $"Save instruction {args[0]} as an alternative, then try the next instruction first.",
            RegexOpcode.Goto => $"Jump to instruction {args[0]}.",
            RegexOpcode.Setmark => "Save the current input position as a group or loop boundary.",
            RegexOpcode.Nullmark => "Save an unset boundary for an optional group or repetition.",
            RegexOpcode.Getmark => "Restore the input position saved at the group boundary.",
            RegexOpcode.Branchmark => $"Repeat from instruction {args[0]} if the previous iteration consumed input.",
            RegexOpcode.Lazybranchmark => $"Try leaving the repetition first; return to instruction {args[0]} only if needed.",
            RegexOpcode.Setcount or RegexOpcode.Nullcount => "Initialize the bounded repetition counter and its saved input position.",
            RegexOpcode.Branchcount or RegexOpcode.Lazybranchcount => $"Check the repetition counter and conditionally return to instruction {args[0]}.",
            RegexOpcode.Setjump => "Save the backtracking and capture stack boundaries for a lookaround or atomic group.",
            RegexOpcode.Backjump => "Restore the saved stack boundary and reject this lookaround branch.",
            RegexOpcode.Forejump => "Discard backtracking choices inside this completed lookaround or atomic group.",
            RegexOpcode.Bol => "Require the start of the input or a position immediately after a newline.",
            RegexOpcode.Eol => "Require the end of the input or a position immediately before a newline.",
            RegexOpcode.Beginning => "Require the absolute beginning of the input (\\A).",
            RegexOpcode.Start => "Require the starting position of this match search (\\G).",
            RegexOpcode.End => "Require the absolute end of the input (\\z).",
            RegexOpcode.EndZ => "Require the end of the input, permitting one final newline (\\Z or non-multiline $).",
            RegexOpcode.Boundary => "Require a .NET Unicode word boundary (\\b).",
            RegexOpcode.NonBoundary => "Require a position that is not a .NET Unicode word boundary (\\B).",
            RegexOpcode.ECMABoundary => "Require an ECMAScript word boundary.",
            RegexOpcode.NonECMABoundary => "Require a position that is not an ECMAScript word boundary.",
            RegexOpcode.Nothing => "This branch cannot match; begin backtracking.",
            RegexOpcode.UpdateBumpalong => "Advance the next search start past positions already proved impossible.",
            RegexOpcode.Stop => "Finish this match attempt and report whether capture 0 succeeded.",
            _ => $"Execute the .NET {opcode} instruction."
        };
    }

    private static string JsonEscape(char value) => value switch
    {
        '\n' => "\\n", '\r' => "\\r", '\t' => "\\t", '\0' => "\\0",
        ' ' => "a space", _ when char.IsControl(value) || char.IsSurrogate(value) => $"U+{(int)value:X4}",
        _ => $"‘{value}’"
    };
}


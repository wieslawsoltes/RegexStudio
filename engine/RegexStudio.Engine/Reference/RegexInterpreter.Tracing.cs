using System.Text.RegularExpressions;

namespace RegexStudio.Reference;

/// <summary>Instrumentation attached to the pinned .NET interpreter.</summary>
internal sealed partial class RegexInterpreter
{
    private readonly TraceRecorder _trace;
    private int _previousPosition;

    private bool FindNext(ReadOnlySpan<char> input, bool rightToLeft)
    {
        var from = runtextpos;
        var found = rightToLeft
            ? _code.FindRightToLeft(input, ref runtextpos, runtextstart)
            : _code.FindLeftToRight(input, ref runtextpos, runtextstart);
        _trace.Add(new()
        {
            Kind = "search", Opcode = "FindNextStartingPosition", CodePosition = -1,
            Position = runtextpos, PreviousPosition = from, RightToLeft = rightToLeft,
            Description = found
                ? from == runtextpos
                    ? $"Try a match starting at input position {runtextpos}."
                    : $"The .NET search optimizer skipped from {from} to {runtextpos}; the skipped positions cannot start a match."
                : "The .NET search optimizer found no remaining position where this pattern can match."
        });
        _previousPosition = runtextpos;
        return found;
    }

    private void RecordStep()
    {
        var operands = _code.OperandsAt(_codepos);
        RecordEvent("execute", _code.Explain(_operator, operands), operands);
    }

    private void RecordEvent(string kind, string description, int[]? operands = null)
    {
        List<TraceCapture> captures = [];
        for (var slot = 0; slot < _trace.GroupNumbers.Length; slot++)
        {
            if (IsMatched(slot))
            {
                captures.Add(new()
                {
                    Number = _trace.GroupNumbers[slot], Name = _trace.GroupNames[slot],
                    Index = MatchIndex(slot), Length = MatchLength(slot)
                });
            }
        }
        _trace.Add(new()
        {
            Kind = kind, Opcode = RuntimeCode.Name(_operator), CodePosition = _codepos,
            Position = runtextpos, PreviousPosition = _previousPosition, RightToLeft = _rightToLeft,
            TrackDepth = runtrack is null ? 0 : runtrack.Length - runtrackpos,
            StackDepth = runstack is null ? 0 : runstack.Length - runstackpos,
            CaptureDepth = runcrawl is null ? 0 : runcrawl.Length - runcrawlpos,
            Description = description, Operands = operands ?? _code.OperandsAt(_codepos),
            Track = Snapshot(runtrack, runtrackpos), Stack = Snapshot(runstack, runstackpos), Captures = captures
        });
        _previousPosition = runtextpos;
    }

    private new void Capture(int capnum, int start, int end)
    {
        base.Capture(capnum, start, end);
        var number = _trace.GroupNumbers[capnum];
        RecordEvent("capture", $"Capture group {_trace.GroupNames[capnum]} (#{number}): [{Math.Min(start, end)}, {Math.Max(start, end)}).");
    }

    private new void TransferCapture(int capnum, int uncapnum, int start, int end)
    {
        base.TransferCapture(capnum, uncapnum, start, end);
        RecordEvent("capture", $"Balance capture slot {uncapnum}" + (capnum >= 0 ? $" into capture slot {capnum}." : "."));
    }

    private new void Uncapture()
    {
        base.Uncapture();
        RecordEvent("uncapture", "Undo the most recent capture while restoring an earlier backtracking choice.");
    }

    private static int[] Snapshot(int[]? values, int position) => values is null
        ? [] : values.AsSpan(position, Math.Min(64, values.Length - position)).ToArray();
}


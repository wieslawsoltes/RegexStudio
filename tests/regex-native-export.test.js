import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  csharpString,
  generateCSharp,
  generateCsproj,
} from "../src/regex/codegen.js";
import { analyzePattern } from "../src/regex/analyze.js";
import { examples, lessons, evaluateLesson } from "../src/regex/learning.js";

const dotnet =
  process.env.REGEXSTUDIO_DOTNET || process.env.DOTNET_HOST_PATH || "dotnet";
const sdk = spawnSync(dotnet, ["--version"], {
  encoding: "utf8",
  timeout: 10_000,
});
const hasSdk = sdk.status === 0 && Number.parseInt(sdk.stdout, 10) >= 10;

test(
  "C# exports and learning samples agree with native .NET 10, including source-generator fallbacks",
  {
    skip: hasSdk
      ? false
      : "Install .NET 10 or set REGEXSTUDIO_DOTNET to run native export verification.",
    timeout: 120_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "regexstudio-export-test-"));
    try {
      const fixtures = [
        {
          pattern: "(?<x>i+)",
          input: "İİ ıi II",
          options: 1,
          culture: "tr-TR",
          timeoutMs: 250,
        },
        {
          pattern: "(?<x>a)+",
          input: "aaa aa",
          options: 1024,
          culture: "",
          timeoutMs: 300,
        },
        {
          pattern: "(?<=USD )\\d+\\.\\d{2}",
          input: "USD 12.50 USD 1.00",
          options: 64,
          timeoutMs: 100,
        },
        {
          pattern: "[\\s\\S]",
          input: '\0\n\r\t"\\😀\ud800',
          options: 0,
          timeoutMs: 250,
        },
        {
          pattern: "\\b(?<word>\\w+)\\s+\\k<word>\\b",
          input: "go go END end",
          options: 513,
          timeoutMs: 250,
          operation: "replace",
          replacement: "${word}$$",
        },
        { pattern: "([,;])", input: "a,b;c", options: 0, operation: "split" },
        {
          pattern: String.raw`\A(?:(?<open>\()|(?<-open>\))|[^()])*(?(open)(?!))\z`,
          input: "a(b(c))",
          options: 0,
        },
        {
          pattern: "(?<x>i+)",
          input: "İİ ıi II",
          options: 1025,
          culture: "tr-TR",
          timeoutMs: 250,
        },
        {
          pattern: String.raw`(?<x>i)\k<x>`,
          input: "İİ ii Iı ıI",
          options: 1,
          culture: "tr-TR",
          timeoutMs: 250,
        },
      ];
      const checks = [];
      for (const [index, fixture] of fixtures.entries()) {
        for (const style of ["runtime", "generated"]) {
          const className = `Export_${style}_${index}`;
          await writeFile(
            join(directory, `${className}.cs`),
            generateCSharp(fixture, { style }).replace(
              "partial class Program",
              `partial class ${className}`,
            ),
          );
          checks.push(
            `new Check(${csharpString(className)}, ${csharpString(fixture.pattern)}, ${csharpString(fixture.input)}, ${fixture.options}, ${csharpString(fixture.culture ?? "")}, ${fixture.timeoutMs ?? 250})`,
          );
        }
      }
      const samples = [
        ...examples.map((item) => ({ ...item, kind: "example" })),
        ...lessons.map((item) => ({
          ...item,
          kind: "lesson",
          pattern: item.solution,
        })),
      ];
      const sampleCode = samples.map(
        (sample) =>
          `new Sample(${csharpString(sample.id)}, ${csharpString(sample.kind)}, ${csharpString(sample.pattern)}, ${csharpString(sample.input)}, ${sample.options})`,
      );
      await writeFile(
        join(directory, "Cases.cs"),
        `internal sealed record Check(string ClassName, string Pattern, string Input, int Options, string Culture, int Timeout);\ninternal sealed record Sample(string Id, string Kind, string Pattern, string Input, int Options);\ninternal static class Cases { internal static Check[] Checks = [${checks.join(",\n")}]; internal static Sample[] Samples = [${sampleCode.join(",\n")}]; }\n`,
      );
      await writeFile(join(directory, "Harness.cs"), harnessSource);
      await writeFile(
        join(directory, "Validation.csproj"),
        generateCsproj().replace(
          "<Nullable>",
          "<StartupObject>Harness</StartupObject>\n    <Nullable>",
        ),
      );
      await writeFile(
        join(directory, "NuGet.Config"),
        "<configuration><packageSources><clear /></packageSources></configuration>",
      );
      const run = spawnSync(
        dotnet,
        [
          "run",
          "--project",
          "Validation.csproj",
          "--configuration",
          "Release",
          "--no-launch-profile",
          "--verbosity",
          "quiet",
        ],
        {
          cwd: directory,
          encoding: "utf8",
          timeout: 110_000,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: "1",
            DOTNET_NOLOGO: "1",
          },
        },
      );
      assert.equal(
        run.status,
        0,
        `${run.error?.message || ""}\n${run.stdout}\n${run.stderr}`,
      );
      const results = JSON.parse(
        await readFile(join(directory, "results.json"), "utf8"),
      );
      assert.equal(results.length, samples.length);
      for (const result of results) {
        const item = samples.find(
          (sample) => sample.id === result.id && sample.kind === result.kind,
        );
        const analysis = analyzePattern(item.pattern, item.options);
        assert.deepEqual(
          analysis.captureGroups.map(({ number, name }) => ({ number, name })),
          result.groups,
          `Capture-number parity: ${item.kind}/${item.id}`,
        );
        if (item.kind === "lesson")
          assert.equal(
            evaluateLesson(item, result.result).passed,
            true,
            `Lesson solution: ${item.id}`,
          );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

const harnessSource = String.raw`
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

internal static class Harness
{
    private static void Main()
    {
        foreach (Check check in Cases.Checks)
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(check.Culture);
            Regex expected = new Regex(check.Pattern, (RegexOptions)check.Options, TimeSpan.FromMilliseconds(check.Timeout));
            // Initialize the attributed accessor under an intentionally different culture.
            // Its plain-Regex fallback can be cached before CreateRegex is ever called.
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
            Type type = Assembly.GetExecutingAssembly().GetType(check.ClassName)!;
            type.GetMethod("GeneratedPattern", BindingFlags.NonPublic | BindingFlags.Static)?.Invoke(null, null);
            Regex actual = (Regex)type.GetMethod("CreateRegex", BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, null)!;
            if (CultureInfo.CurrentCulture.Name != "en-US") throw new Exception("Caller culture was changed by " + check.ClassName);
            if (actual.MatchTimeout != expected.MatchTimeout) throw new Exception("Timeout differs in " + check.ClassName);
            CompareMatches(expected, actual, check.Input, check.ClassName);
        }
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        var output = new List<object>();
        foreach (Sample sample in Cases.Samples)
        {
            var regex = new Regex(sample.Pattern, (RegexOptions)sample.Options, TimeSpan.FromMilliseconds(250));
            output.Add(new { id = sample.Id, kind = sample.Kind, result = Describe(regex, sample.Input), groups = regex.GetGroupNumbers().Where(number => number != 0).Select(number => new { number, name = regex.GroupNameFromNumber(number) }).ToArray() });
        }
        File.WriteAllText("results.json", JsonSerializer.Serialize(output));
    }

    private static void CompareMatches(Regex expectedRegex, Regex actualRegex, string input, string name)
    {
        var expected = expectedRegex.Matches(input);
        var actual = actualRegex.Matches(input);
        if (expected.Count != actual.Count) throw new Exception("Match count differs in " + name);
        if (!expectedRegex.GetGroupNames().SequenceEqual(actualRegex.GetGroupNames())) throw new Exception("Group names differ in " + name);
        for (int index = 0; index < expected.Count; index++)
        {
            if (expected[index].Index != actual[index].Index || expected[index].Length != actual[index].Length || expected[index].Value != actual[index].Value) throw new Exception("Match differs in " + name);
            foreach (int number in expectedRegex.GetGroupNumbers())
            {
                Group left = expected[index].Groups[number], right = actual[index].Groups[number];
                if (left.Success != right.Success || left.Index != right.Index || left.Length != right.Length || left.Value != right.Value || left.Captures.Count != right.Captures.Count) throw new Exception("Group differs in " + name);
                for (int capture = 0; capture < left.Captures.Count; capture++)
                {
                    Capture a = left.Captures[capture], b = right.Captures[capture];
                    if (a.Value != b.Value || a.Index != b.Index || a.Length != b.Length) throw new Exception("Capture differs in " + name);
                }
            }
        }
    }

    private static object Describe(Regex regex, string input) => new
    {
        matches = regex.Matches(input).Cast<Match>().Select(match => new
        {
            index = match.Index, length = match.Length, value = match.Value,
            groups = regex.GetGroupNumbers().Select(number =>
            {
                Group group = match.Groups[number];
                return new { number, name = regex.GroupNameFromNumber(number), index = group.Index, length = group.Length, value = group.Value, success = group.Success, captures = group.Captures.Cast<Capture>().Select(capture => new { index = capture.Index, length = capture.Length, value = capture.Value }).ToArray() };
            }).ToArray()
        }).ToArray()
    };
}
`;

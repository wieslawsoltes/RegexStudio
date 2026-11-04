import { RegexOptions, formatRegexOptions, optionsToNames } from "./options.js";

export { RegexOptions, formatRegexOptions, optionsToNames } from "./options.js";

/** An ordinary C# string literal that preserves every UTF-16 code unit. */
export function csharpString(value = "") {
  let result = '"';
  for (let index = 0; index < String(value).length; index++) {
    const character = String(value)[index];
    const code = character.charCodeAt(0);
    const short = {
      '"': '\\"',
      "\\": "\\\\",
      "\n": "\\n",
      "\r": "\\r",
      "\t": "\\t",
      "\b": "\\b",
      "\f": "\\f",
      "\v": "\\v",
      "\0": "\\0",
    };
    if (Object.hasOwn(short, character)) result += short[character];
    else if (
      code < 32 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      /[\p{Cf}\p{Zl}\p{Zp}]/u.test(character)
    )
      result += `\\u${code.toString(16).padStart(4, "0")}`;
    else result += character;
  }
  return result + '"';
}

/**
 * Generate a complete, compilable .NET 10 console example.
 * Runtime style explicitly snapshots/restores CurrentCulture during construction.
 * GeneratedRegex style fixes the same culture in its source-generator attribute.
 */
export function generateCSharp(request = {}, { style = "runtime" } = {}) {
  if (!["runtime", "generated"].includes(style))
    throw new TypeError("C# style must be runtime or generated.");
  const options = Number(request.options ?? 0);
  const optionExpression = formatRegexOptions(options);
  const timeout = Number(request.timeoutMs ?? 250);
  if (
    !Number.isInteger(timeout) ||
    (timeout !== -1 && (timeout < 1 || timeout > 2_147_483_646))
  ) {
    throw new RangeError(
      "The .NET regex timeout must be a whole number from 1 to 2,147,483,646 milliseconds, or -1 for infinite.",
    );
  }
  const pattern = csharpString(request.pattern ?? "");
  const input = csharpString(request.input ?? "");
  const replacement = csharpString(request.replacement ?? "");
  const cultureName =
    options & RegexOptions.CultureInvariant
      ? ""
      : String(request.culture ?? "");
  const cultureExpression = cultureName
    ? `CultureInfo.GetCultureInfo(${csharpString(cultureName)})`
    : "CultureInfo.InvariantCulture";
  const timeoutExpression =
    timeout === -1
      ? "Regex.InfiniteMatchTimeout"
      : `TimeSpan.FromMilliseconds(${timeout})`;
  const operation = request.operation ?? "matches";
  const action =
    operation === "replace" || operation === "replacement"
      ? [
          `            const string replacement = ${replacement};`,
          "            // Replacement syntax is .NET syntax: $1, ${name}, $$, $&, and more.",
          "            Console.WriteLine(regex.Replace(input, replacement));",
        ]
      : operation === "split"
        ? [
            "            string[] parts = regex.Split(input);",
            "            for (int index = 0; index < parts.Length; index++)",
            "            {",
            '                Console.WriteLine($"{index}: {parts[index]}");',
            "            }",
          ]
        : operation === "isMatch"
          ? ["            Console.WriteLine(regex.IsMatch(input));"]
          : [
              "            foreach (Match match in regex.Matches(input))",
              "            {",
              '                Console.WriteLine($"Match [{match.Index}..{match.Index + match.Length}): {match.Value}");',
              "                foreach (string name in regex.GetGroupNames())",
              "                {",
              "                    Group group = match.Groups[name];",
              "                    if (!group.Success) continue;",
              '                    Console.WriteLine($"  Group {name}: {group.Value}");',
              "                    foreach (Capture capture in group.Captures)",
              "                    {",
              '                        Console.WriteLine($"    [{capture.Index}..{capture.Index + capture.Length}): {capture.Value}");',
              "                    }",
              "                }",
              "            }",
            ];
  const method = [
    ...(style === "generated"
      ? [
          "    // Full source generation fixes the comparison culture in this attribute.",
          `    [GeneratedRegex(${pattern}, ${optionExpression}, ${timeout}, ${csharpString(cultureName)})]`,
          "    private static partial Regex GeneratedPattern();",
          "",
        ]
      : []),
    "    private static Regex CreateRegex()",
    "    {",
    `        const string pattern = ${pattern};`,
    `        const RegexOptions options = ${optionExpression};`,
    "        CultureInfo previousCulture = CultureInfo.CurrentCulture;",
    "        try",
    "        {",
    `            CultureInfo.CurrentCulture = ${cultureExpression};`,
    ...(style === "generated"
      ? [
          "            Regex generated = GeneratedPattern();",
          "            if (generated.GetType() != typeof(Regex)) return generated;",
          "",
          "            // Unsupported source-generation cases (including NonBacktracking)",
          "            // use a cached plain Regex. It may have initialized under another",
          "            // ambient culture, so construct that fallback with this explicit culture.",
        ]
      : []),
    "            // Regex records its comparison culture during construction.",
    `            return new Regex(pattern, options, ${timeoutExpression});`,
    "        }",
    "        finally",
    "        {",
    "            CultureInfo.CurrentCulture = previousCulture;",
    "        }",
    "    }",
  ];
  return [
    "// RegexStudio · .NET 10 / System.Text.RegularExpressions",
    "// Match indices and lengths are UTF-16 code units.",
    ...(options & RegexOptions.Compiled
      ? [
          "// Compiled is a runtime optimization request; platforms without dynamic code use a fallback.",
        ]
      : []),
    ...(options & RegexOptions.NonBacktracking
      ? [
          "// NonBacktracking preserves only the final capture of a repeated capturing group.",
        ]
      : []),
    "using System;",
    "using System.Globalization;",
    "using System.Text.RegularExpressions;",
    "",
    "internal static partial class Program",
    "{",
    "    private static void Main()",
    "    {",
    `        const string input = ${input};`,
    "        try",
    "        {",
    "            Regex regex = CreateRegex();",
    ...action,
    "        }",
    "        catch (RegexMatchTimeoutException exception)",
    "        {",
    '            Console.Error.WriteLine($"The match exceeded {exception.MatchTimeout.TotalMilliseconds} ms.");',
    "            Environment.ExitCode = 1;",
    "        }",
    "        catch (ArgumentException exception)",
    "        {",
    "            Console.Error.WriteLine(exception.Message);",
    "            Environment.ExitCode = 1;",
    "        }",
    "    }",
    "",
    ...method,
    "}",
    "",
  ].join("\n");
}

/** Useful alongside a download of generated Program.cs. */
export function generateCsproj() {
  return '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n';
}

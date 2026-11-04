using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RegexStudio;

/// <summary>
/// Preserves every UTF-16 code unit across the JavaScript/.NET JSON boundary.
/// JavaScript JSON.stringify escapes isolated surrogate code units, while the
/// normal System.Text.Json string converter rejects them on read and replaces
/// them on write. Both JS and .NET regex strings can legitimately contain those
/// units. Normal strings retain the BCL's fast serialization paths.
/// </summary>
internal sealed class Utf16StringConverter : JsonConverter<string>
{
    public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String) throw new JsonException("A string was expected.");
        if (!reader.ValueIsEscaped) return reader.GetString()!;

        ReadOnlySpan<byte> bytes = reader.HasValueSequence ? reader.ValueSequence.ToArray() : reader.ValueSpan;
        if (bytes.IndexOf("\\u"u8) < 0) return reader.GetString()!;

        // The reader has validated JSON token syntax. Decode escape sequences
        // without imposing a Unicode-scalar restriction on \uXXXX code units.
        var raw = Encoding.UTF8.GetString(bytes);
        var decoded = new StringBuilder(raw.Length);
        for (var i = 0; i < raw.Length; i++)
        {
            var value = raw[i];
            if (value != '\\')
            {
                decoded.Append(value);
                continue;
            }
            if (++i >= raw.Length) throw new JsonException("Incomplete JSON escape.");
            switch (raw[i])
            {
                case '"': decoded.Append('"'); break;
                case '\\': decoded.Append('\\'); break;
                case '/': decoded.Append('/'); break;
                case 'b': decoded.Append('\b'); break;
                case 'f': decoded.Append('\f'); break;
                case 'n': decoded.Append('\n'); break;
                case 'r': decoded.Append('\r'); break;
                case 't': decoded.Append('\t'); break;
                case 'u':
                    if (i + 4 >= raw.Length) throw new JsonException("Incomplete JSON Unicode escape.");
                    var unit = 0;
                    for (var digit = 0; digit < 4; digit++) unit = (unit << 4) | Hex(raw[++i]);
                    decoded.Append((char)unit);
                    break;
                default: throw new JsonException("Invalid JSON escape.");
            }
        }
        return decoded.ToString();
    }

    public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
    {
        if (!ContainsIsolatedSurrogate(value))
        {
            writer.WriteStringValue(value);
            return;
        }

        // Build a JSON string token entirely from validated escape sequences.
        // Raw-value writing is necessary because WriteStringValue normalizes
        // isolated surrogates to U+FFFD. JSON.parse preserves these escapes.
        var encoded = new StringBuilder(value.Length + 2).Append('"');
        foreach (var unit in value)
        {
            if (unit is '"' or '\\') encoded.Append('\\').Append(unit);
            else if (unit < 0x20 || unit > 0x7E || unit is '<' or '>' or '&' or '\'' or '+')
                encoded.Append("\\u").Append(((int)unit).ToString("X4", System.Globalization.CultureInfo.InvariantCulture));
            else encoded.Append(unit);
        }
        encoded.Append('"');
        writer.WriteRawValue(encoded.ToString(), skipInputValidation: true);
    }

    private static bool ContainsIsolatedSurrogate(ReadOnlySpan<char> text)
    {
        while (true)
        {
            var index = text.IndexOfAnyInRange('\uD800', '\uDFFF');
            if (index < 0) return false;
            if (!char.IsHighSurrogate(text[index]) || index + 1 == text.Length || !char.IsLowSurrogate(text[index + 1]))
                return true;
            text = text[(index + 2)..];
        }
    }

    private static int Hex(char value) => value switch
    {
        >= '0' and <= '9' => value - '0',
        >= 'a' and <= 'f' => value - 'a' + 10,
        >= 'A' and <= 'F' => value - 'A' + 10,
        _ => throw new JsonException("Invalid hexadecimal digit in JSON Unicode escape.")
    };
}

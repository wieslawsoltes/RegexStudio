import { DataError, tableFromGrid, toCellText } from "./errors.js";

/** Detect a delimiter without counting delimiters inside quoted fields. */
export function detectDelimiter(text) {
  const candidates = [",", "\t", ";", "|"];
  const counts = candidates.map(() => []);
  let record = candidates.map(() => 0);
  let quoted = false;
  let records = 0;
  for (let i = 0; i < text.length && records < 32; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (record.some(Boolean)) {
        record.forEach((count, index) => counts[index].push(count));
        records++;
      }
      record = candidates.map(() => 0);
      if (character === "\r" && text[i + 1] === "\n") i++;
    } else if (!quoted) {
      const index = candidates.indexOf(character);
      if (index !== -1) record[index]++;
    }
  }
  if (record.some(Boolean))
    record.forEach((count, index) => counts[index].push(count));
  let bestScore = 0;
  let best = ",";
  counts.forEach((values, index) => {
    const frequencies = new Map();
    for (const value of values)
      if (value) frequencies.set(value, (frequencies.get(value) || 0) + 1);
    for (const [width, frequency] of frequencies) {
      const score =
        (frequency / Math.max(1, values.length)) * 100 +
        Math.min(width, 50) +
        frequency;
      if (score > bestScore) {
        bestScore = score;
        best = candidates[index];
      }
    }
  });
  return best;
}

/** RFC 4180-style parser; preserves quoted line endings, blank cells and trailing fields. */
export function parseDelimited(
  text,
  { delimiter = ",", maxRows = 1_000_000, maxCells = 2_000_000 } = {},
) {
  if (typeof text !== "string")
    throw new TypeError("Delimited data must be a string.");
  if (delimiter.length !== 1 || /[\r\n"]/.test(delimiter))
    throw new DataError(
      "Choose one delimiter character other than a quote or line break.",
      "invalid-delimiter",
    );
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.length) return [];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let cells = 0;
  let line = 1;
  const appendField = () => {
    row.push(field);
    field = "";
    closedQuote = false;
    if (++cells > maxCells)
      throw new DataError(
        `The file exceeds the ${maxCells.toLocaleString()} cell import limit. Select a smaller file.`,
        "data-limit",
      );
  };
  const appendRow = () => {
    appendField();
    rows.push(row);
    row = [];
    if (rows.length > maxRows)
      throw new DataError(
        `The file exceeds the ${maxRows.toLocaleString()} row import limit.`,
        "data-limit",
      );
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
        if (character === "\n" || (character === "\r" && text[i + 1] !== "\n"))
          line++;
      }
    } else if (character === delimiter) {
      appendField();
    } else if (character === "\n" || character === "\r") {
      appendRow();
      if (character === "\r" && text[i + 1] === "\n") i++;
      line++;
    } else if (character === '"' && !field.length && !closedQuote) {
      quoted = true;
    } else if (closedQuote) {
      // Whitespace after a closing quote is commonly emitted by spreadsheet tools.
      if (character !== " " && character !== "\t")
        throw new DataError(
          `Unexpected ${JSON.stringify(character)} after a closing quote on line ${line}.`,
          "invalid-csv",
          { line },
        );
    } else {
      field += character;
    }
  }
  if (quoted)
    throw new DataError(
      `A quoted field is not closed at the end of the file (line ${line}).`,
      "invalid-csv",
      { line },
    );
  if (row.length || field.length || closedQuote || text.endsWith(delimiter))
    appendRow();
  return rows;
}

export function parseCsv(
  text,
  { delimiter = detectDelimiter(text), header = true, ...limits } = {},
) {
  const grid = parseDelimited(text, { delimiter, ...limits });
  const width = grid[0]?.length || 0;
  const inconsistent = grid.reduce(
    (count, row) => count + (row.length !== width ? 1 : 0),
    0,
  );
  return {
    ...tableFromGrid(grid, { header }),
    grid,
    delimiter,
    warnings: inconsistent
      ? [
          `${inconsistent} row${inconsistent === 1 ? " has" : "s have"} a different number of fields. Missing cells are shown as empty.`,
        ]
      : [],
  };
}

/** Pass excelSafe:true to prefix formula-looking text with an apostrophe. Default is lossless. */
export function stringifyCsv(
  rows,
  {
    columns,
    delimiter = ",",
    newline = "\r\n",
    excelSafe = false,
    bom = false,
  } = {},
) {
  if (delimiter.length !== 1 || /[\r\n"]/.test(delimiter))
    throw new DataError("Invalid CSV delimiter.", "invalid-delimiter");
  const input = Array.from(rows || []);
  const objectRows = input.some(
    (row) => !Array.isArray(row) && row !== null && typeof row === "object",
  );
  const names =
    columns ||
    (objectRows
      ? [...new Set(input.flatMap((row) => Object.keys(row || {})))]
      : null);
  const quote = (value) => {
    let text = toCellText(value);
    if (excelSafe && typeof value !== "number" && /^[\s]*[=+@-]/.test(text))
      text = `'${text}`;
    return text.includes(delimiter) ||
      /["\r\n]/.test(text) ||
      /^\s|\s$/.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  };
  const lines = [];
  if (names) lines.push(names.map(quote).join(delimiter));
  for (const row of input) {
    const values = Array.isArray(row)
      ? row
      : names
        ? names.map((name) => row?.[name])
        : [row];
    lines.push(values.map(quote).join(delimiter));
  }
  return `${bom ? "\ufeff" : ""}${lines.join(newline)}`;
}

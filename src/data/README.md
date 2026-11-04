# Data adapters

These dependency-free ES modules work independently of RegexStudio's UI. File decoding,
CSV, JSON, XML table extraction, ZIP and XLSX processing also work in a Web Worker.
Full XPath evaluation and `downloadFile` use browser DOM APIs.

```js
import {
  parseData, selectData, getDataColumns, fetchData,
  exportRows, exportXlsx, exportWorkbook, downloadFile
} from './data/index.js';

const dataset = await parseData(file); // File, Blob, string, ArrayBuffer or typed array
const emailView = selectData(dataset, { sheet: 0, column: 'Email' });
console.log(emailView.text); // Send this exact string to the regex engine.
console.log(getDataColumns(emailView)); // All available columns before projection.

const json = await parseData('{"users":[{"email":"ada@example.com"}]}', { format: 'json' });
const view = selectData(json, { path: '/users/*/email' });

const online = await fetchData('https://example.org/data.json', {
  headers: { Authorization: 'Bearer user-provided-token' },
  signal: abortController.signal
});
// No request headers are included in online.source or persisted with the dataset.

const csv = exportRows(matchRows, { format: 'csv' });
downloadFile(csv.blob, 'matches.csv');
downloadFile(await exportXlsx(matchRows, { columns, sheetName: 'Matches' }), 'matches.xlsx');
downloadFile(await exportWorkbook(dataset.sheets), 'data.xlsx');
```

## Dataset contract

`parseData` produces an ordinary, serializable object:

```text
id, name, format, text, sourceText, columns: string[], rows: string[][],
source, warnings: string[], byteLength, createdAt
```

`text` is the current regex input. `sourceText` retains the imported source, so changing
a selection is reversible. `selectData` returns a new object. Regex indices refer to
the selected `text`, not the original file's byte positions.

CSV and TSV retain `grid`, `delimiter` and the `header` preference. JSON/JSON Lines retain
the parsed `raw` value and suggested `paths`. XLSX retains all `sheets`, each with `grid`,
`rows`, `columns`, original worksheet `rowNumbers`, and `cellInfo` for formula/date/error
cells. Gaps in worksheet row numbering are kept in `rowNumbers`; empty formatting-only
rows are omitted from the extracted table.

`selectData` accepts:

- `sheet`: zero-based index or worksheet name.
- `column`: a column name, zero-based index, or array of names/indices. Empty/`null` means all columns.
- `path`: RFC 6901 JSON Pointer with `*` as an explicit wildcard extension, such as `/users/*/email`.
- `xpath`: browser XPath 1.0, such as `//email/text()`. Prefix `d:` resolves the default XML namespace; `namespaces` can supply additional prefix mappings.
- `header`: whether the first CSV/XLSX row supplies column names.
- `includeHeader`: include headers in projected text. The original unprojected source retains its headers.
- `separator` / `columnSeparator`: projected output separators, defaulting to newline and tab.

## File semantics

CSV parsing preserves quoted delimiters, escaped quotes, multiline fields, CRLF and
empty cells. Duplicate/empty headers receive distinct display names. Ragged rows produce
a warning and are padded for table views; the original source stays intact.

XLSX imports use package relationships, all data worksheets, shared and inline rich text,
booleans, stored numeric strings and cached formula results. Dates become ISO values;
raw serials and format metadata remain in `cellInfo`. Excel's 1900 leap-day convention
and 1904 epoch are handled explicitly. Formulas are not evaluated. A missing cached
result produces a warning. Workbook formatting, drawings, macros and charts are not
part of the extracted data model.

XLSX exports produce new data workbooks. Strings remain literal cells even when they
begin with `=`; spreadsheet formulas are not synthesized from regex output. Original
workbook formatting and formulas are not copied. CSV exports are lossless by default;
`excelSafe: true` prefixes formula-looking text with an apostrophe when that behavior
is desired.

ZIP parsing verifies entry checksums and bounds decompression. Defaults are 32 MB per
import/download, 64 MB per expanded ZIP entry, 128 MB total expanded entries, and
2,000,000 cells per worksheet table. These are explicit options on the reusable APIs.
Encrypted, legacy binary `.xls`, multipart ZIP and ZIP64 workbooks are rejected with
specific recovery messages. XML DTDs/custom entities are not expanded.

Online sources use a single explicit HTTP GET with a 20-second deadline, cancellation,
streamed size enforcement and `credentials: 'omit'`. Their server must permit browser
CORS access. There is no intermediary proxy or automatic background polling.

## Project and dataset storage

`../state/projects.js` exports `createProject`, `validateProject`, `serializeProject`,
`deserializeProject`, project/dataset `save`, `load`, `list`, `delete` functions, and
`storageStatus`. Projects use version 1 of the `regex-studio-project` JSON format and
the `.regexstudio.json` extension. Patterns keep their numeric .NET options, replacement,
enabled state and color. Workspace/layout state is preserved.

The default adapter uses IndexedDB and falls back to localStorage when database access
is unavailable. Failed saves throw; they are not reported as persisted. Saved summaries
are separate IndexedDB records, so listing projects does not read all document data.
`saveProject(value, { expectedUpdatedAt })` supports optimistic concurrency when a host
needs to detect changes made in another tab. `createProjectStore` accepts injected
storage adapters and database/namespace names for reuse.

Browser storage can be cleared by the user or browser. File export provides a portable
copy of the project and all embedded datasets.

## Validation

Run `node --test tests/data*.test.js`. Tests cover parsing, reversible projections,
actual compressed/stored OOXML workbooks, XLSX export roundtrips, corrupt archives,
Excel date epochs, streamed downloads and project/dataset persistence behavior.

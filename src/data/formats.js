import { checkAbort, createId, DataError, tableFromGrid, toCellText } from './errors.js';
import { detectDelimiter, parseCsv, stringifyCsv } from './csv.js';
import { jsonPaths, jsonTable, parseJson, selectJson } from './json.js';
import { parseXml, selectXml, xmlTable } from './xml.js';
import { parseXlsx } from './xlsx.js';

export const DATA_FORMATS = Object.freeze([
  { id: 'text', label: 'Plain text', extensions: ['txt', 'log', 'md'] },
  { id: 'json', label: 'JSON', extensions: ['json'] },
  { id: 'jsonl', label: 'JSON Lines', extensions: ['jsonl', 'ndjson'] },
  { id: 'xml', label: 'XML', extensions: ['xml', 'svg', 'xsd'] },
  { id: 'csv', label: 'CSV', extensions: ['csv'] },
  { id: 'tsv', label: 'TSV', extensions: ['tsv'] },
  { id: 'xlsx', label: 'Excel workbook', extensions: ['xlsx', 'xlsm'] }
]);
export const MAX_DATA_BYTES = 32 * 1024 * 1024;

export function detectFormat({ name = '', type = '', text = '', bytes } = {}) {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'xls') return 'xls';
  const byExtension = DATA_FORMATS.find(format => format.extensions.includes(extension));
  if (byExtension) return byExtension.id;
  if (type.includes('spreadsheetml') || bytes?.[0] === 0x50 && bytes?.[1] === 0x4b && bytes?.[2] === 3 && bytes?.[3] === 4) return 'xlsx';
  if (/json|ndjson/.test(type)) return type.includes('ndjson') ? 'jsonl' : 'json';
  if (/xml/.test(type)) return 'xml';
  if (type.includes('csv')) return 'csv';
  if (type.includes('tab-separated')) return 'tsv';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  if (text.includes('\n') || text.includes('\r')) {
    const delimiter = detectDelimiter(text);
    try {
      const sample = parseCsv(text.slice(0, 64_000), { delimiter });
      if (sample.grid.length > 1 && sample.columns.length > 1 && !sample.warnings.length) return delimiter === '\t' ? 'tsv' : 'csv';
    } catch { /* An arbitrary text sample does not need to be valid CSV. */ }
  }
  return 'text';
}

export function decodeText(buffer, encoding) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!encoding) {
    encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    // UTF-16 XML without a BOM still has an identifiable opening declaration.
    if (bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0 && bytes[3] === 0x3f) encoding = 'utf-16be';
    else if (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0x3f && bytes[3] === 0) encoding = 'utf-16le';
    else if (encoding === 'utf-8') {
      const beginning = String.fromCharCode(...bytes.subarray(0, 250));
      const declared = /^<\?xml\s[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(beginning)?.[1];
      if (declared) encoding = declared;
    }
  }
  try { return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding }; }
  catch (error) { throw new DataError(`The file cannot be decoded as ${encoding}. Choose the file's original encoding or save it as UTF-8. ${error.message}`, 'invalid-encoding', { encoding }); }
}

/** Parse strings, File/Blob objects, ArrayBuffers, or Uint8Arrays into a reusable dataset. */
export async function parseData(input, options = {}) {
  const { maxBytes = MAX_DATA_BYTES, signal } = options;
  checkAbort(signal);
  let text;
  let bytes;
  let encoding = options.encoding || 'utf-8';
  let name = options.name || input?.name || 'Untitled data';
  let type = options.type || input?.type || '';
  let byteLength;
  if (typeof input === 'string') {
    text = input;
    byteLength = new TextEncoder().encode(text).byteLength;
  } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    byteLength = bytes.byteLength;
  } else if (typeof input?.arrayBuffer === 'function') {
    if (input.size > maxBytes) throw new DataError(`The file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`, 'data-limit');
    bytes = new Uint8Array(await input.arrayBuffer());
    byteLength = bytes.byteLength;
  } else throw new TypeError('parseData expects a string, File, Blob, ArrayBuffer or typed array.');
  if (byteLength > maxBytes) throw new DataError(`The data exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`, 'data-limit');
  checkAbort(signal);
  let format = options.format && options.format !== 'auto' ? options.format : detectFormat({ name, type, text, bytes });
  if (format === 'xls') throw new DataError('The older binary .xls format is not supported. Save it as .xlsx or CSV and import that file.', 'unsupported-format');
  if (format === 'xlsx') {
    if (!bytes) throw new DataError('Import an XLSX file to read a workbook; workbook data is binary.', 'invalid-xlsx');
    const workbook = await parseXlsx(bytes, options);
    return { id: createId(), name, format, ...workbook, sourceText: workbook.text, byteLength, warnings: workbook.warnings, source: options.source || { kind: 'file', name }, createdAt: new Date().toISOString() };
  }
  if (text === undefined) {
    const decoded = decodeText(bytes, options.encoding);
    text = decoded.text;
    encoding = decoded.encoding;
    if (!options.format || options.format === 'auto') format = detectFormat({ name, type, text });
  }
  let parsed = { columns: ['Text'], rows: text.length ? text.split(/\r\n|\r|\n/).map(line => [line]) : [], warnings: [] };
  if (format === 'json') {
    const raw = parseJson(text);
    parsed = { raw, ...jsonTable(raw), paths: jsonPaths(raw), warnings: [] };
  } else if (format === 'jsonl') {
    const raw = [];
    for (const [index, line] of text.split(/\r\n|\n|\r/).entries()) {
      if (!line.trim()) continue;
      try { raw.push(JSON.parse(line)); }
      catch (error) { throw new DataError(`JSON Lines row ${index + 1} is invalid: ${error.message}`, 'invalid-json', { line: index + 1 }); }
    }
    parsed = { raw, ...jsonTable(raw), paths: jsonPaths(raw), warnings: [] };
  } else if (format === 'xml') parsed = { ...xmlTable(parseXml(text, options), options), warnings: [] };
  else if (format === 'csv' || format === 'tsv') parsed = parseCsv(text, { ...options, delimiter: options.delimiter || (format === 'tsv' ? '\t' : detectDelimiter(text)) });
  else if (format !== 'text') throw new DataError(`Data format ${format} is not supported.`, 'unsupported-format');
  return { id: createId(), name, format, text, sourceText: text, ...parsed, encoding, byteLength, source: options.source || { kind: typeof input === 'string' ? 'paste' : 'file', name }, createdAt: new Date().toISOString() };
}

/** Create a data view while retaining the original source so a selection is reversible. */
export function selectData(dataset, selection = {}) {
  if (!dataset || typeof dataset.text !== 'string') throw new DataError('No dataset is selected.', 'invalid-selection');
  let columns = dataset.columns || [];
  let rows = dataset.rows || [];
  let text = dataset.sourceText ?? dataset.text;
  let selectedSheet = dataset.selectedSheet;
  const header = selection.header ?? dataset.header ?? true;
  let grid = dataset.grid;
  if (dataset.format === 'xlsx') {
    const requested = selection.sheet ?? selectedSheet ?? 0;
    selectedSheet = typeof requested === 'string' ? dataset.sheets.findIndex(sheet => sheet.name === requested) : requested;
    if (selectedSheet === -1 && typeof requested === 'string' && /^\d+$/.test(requested)) selectedSheet = Number(requested);
    const sheet = dataset.sheets?.[selectedSheet];
    if (!sheet) throw new DataError('The selected worksheet was not found.', 'invalid-selection');
    grid = sheet.grid;
    ({ columns, rows } = tableFromGrid(grid, { header }));
    text = stringifyCsv(selection.includeHeader === false && header ? grid.slice(1) : grid, { delimiter: '\t', newline: '\n' });
  } else if ((dataset.format === 'csv' || dataset.format === 'tsv') && grid) {
    ({ columns, rows } = tableFromGrid(grid, { header }));
    if (selection.includeHeader === false && header) text = stringifyCsv(rows, { delimiter: dataset.delimiter || ',', newline: '\n' });
  }
  if (dataset.format === 'json' || dataset.format === 'jsonl') {
    const raw = dataset.raw !== undefined ? dataset.raw : dataset.format === 'jsonl'
      ? (dataset.sourceText ?? dataset.text).split(/\r\n|\r|\n/).filter(line => line.trim()).map(parseJson)
      : parseJson(dataset.sourceText ?? dataset.text);
    ({ columns, rows } = jsonTable(raw));
    if (selection.path) {
      const values = selectJson(raw, selection.path).flatMap(value => Array.isArray(value) ? value : [value]);
      ({ columns, rows } = jsonTable(values));
      text = values.map(toCellText).join(selection.separator ?? '\n');
    }
  }
  if (dataset.format === 'xml') {
    if (selection.xpath) {
      const values = selectXml(dataset.sourceText ?? dataset.text, selection.xpath, selection);
      columns = ['Value'];
      rows = values.map(value => [value]);
      text = values.join(selection.separator ?? '\n');
    } else ({ columns, rows } = xmlTable(parseXml(dataset.sourceText ?? dataset.text)));
  }
  const requestedColumn = selection.column;
  if (requestedColumn !== undefined && requestedColumn !== null && requestedColumn !== '' && requestedColumn !== '*') {
    const requested = Array.isArray(requestedColumn) ? requestedColumn : [requestedColumn];
    const indices = requested.map(column => {
      if (typeof column === 'number') return column;
      const named = columns.indexOf(column);
      return named === -1 && /^\d+$/.test(column) ? Number(column) : named;
    });
    if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= columns.length)) throw new DataError('The selected column was not found. Choose a column from the current data view.', 'invalid-selection');
    const selectedRows = rows.map(row => indices.map(index => row[index] ?? ''));
    const selectedColumns = indices.map(index => columns[index]);
    text = (selection.includeHeader ? [selectedColumns, ...selectedRows] : selectedRows).map(row => row.join(selection.columnSeparator ?? '\t')).join(selection.separator ?? '\n');
    columns = selectedColumns;
    rows = selectedRows;
  }
  return { ...dataset, text, columns, rows, selectedSheet, selection: { ...selection }, header };
}

/** Column choices for the current worksheet/path, before applying a column projection. */
export function getDataColumns(dataset, selection = dataset.selection || {}) {
  return selectData(dataset, { ...selection, column: null }).columns;
}

export function exportRows(rows, { format = 'csv', columns, ...options } = {}) {
  let text;
  let mimeType;
  let extension = format;
  if (format === 'json') {
    const values = columns ? rows.map(row => Array.isArray(row) ? Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ''])) : row) : rows;
    text = JSON.stringify(values, null, 2);
    mimeType = 'application/json;charset=utf-8';
  } else if (format === 'csv' || format === 'tsv') {
    text = stringifyCsv(rows, { ...options, columns, delimiter: format === 'tsv' ? '\t' : options.delimiter || ',' });
    mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8';
  } else if (format === 'text' || format === 'txt') {
    text = rows.map(row => Array.isArray(row) ? row.map(toCellText).join('\t') : toCellText(row)).join('\n');
    mimeType = 'text/plain;charset=utf-8';
    extension = 'txt';
  } else throw new DataError(`Export format ${format} is not supported.`, 'unsupported-format');
  return { text, mimeType, extension, blob: new Blob([text], { type: mimeType }) };
}

export function downloadFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  if (typeof document === 'undefined') throw new Error('File downloads require a browser.');
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'data.txt').replace(/[\\/\u0000-\u001f]/g, '_');
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return blob;
}

import { DataError, toCellText } from './errors.js';
import { crc32 } from './zip.js';
import { columnName } from './xlsx.js';

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function cellText(value) {
  const text = toCellText(value).replace(/_x[\da-f]{4}_/gi, literal => `_x005F_${literal.slice(1)}`);
  let encoded = '';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      encoded += text[index] + text[++index];
    } else if (code < 0x20 && code !== 9 && code !== 10 || code >= 0xd800 && code <= 0xdfff || code === 0xfffe || code === 0xffff) {
      encoded += `_x${code.toString(16).toUpperCase().padStart(4, '0')}_`;
    } else encoded += text[index];
  }
  return xml(encoded);
}

async function zipParts(files, { compress = true, maxBytes = 256 * 1024 * 1024 } = {}) {
  const encoder = new TextEncoder();
  const parts = [];
  const directory = [];
  let offset = 0;
  let expanded = 0;
  for (const [path, source] of Object.entries(files)) {
    const name = encoder.encode(path);
    const raw = encoder.encode(source);
    if ((expanded += raw.length) > maxBytes) throw new DataError('The exported workbook exceeds the export size limit. Export smaller worksheets separately.', 'data-limit');
    let bytes = raw;
    let method = 0;
    if (compress && typeof CompressionStream !== 'undefined') {
      let compressor;
      try { compressor = new CompressionStream('deflate-raw'); } catch { /* Stored ZIP entries work in older browsers too. */ }
      if (compressor) {
        const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(compressor)).arrayBuffer());
        if (compressed.length < raw.length) { bytes = compressed; method = 8; }
      }
    }
    const checksum = crc32(raw);
    const header = new Uint8Array(30);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true);
    h.setUint16(8, method, true);
    h.setUint16(12, 33, true); // 1980-01-01, valid DOS ZIP date.
    h.setUint32(14, checksum, true);
    h.setUint32(18, bytes.length, true);
    h.setUint32(22, raw.length, true);
    h.setUint16(26, name.length, true);
    parts.push(header, name, bytes);
    const central = new Uint8Array(46);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint16(10, method, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, checksum, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    directory.push(central, name);
    offset += header.length + name.length + bytes.length;
  }
  const centralSize = directory.reduce((size, part) => size + part.length, 0);
  const count = Object.keys(files).length;
  if (count > 65_535 || offset + centralSize > 0xffff_ffff) throw new DataError('The workbook exceeds the ZIP format size limit.', 'data-limit');
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, count, true);
  e.setUint16(10, count, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: XLSX_MIME_TYPE });
}

/** Create an XLSX data workbook. Strings are literal cells, never executable formulas. */
export async function exportWorkbook(sheets, options = {}) {
  if (!Array.isArray(sheets) || !sheets.length) throw new DataError('Add at least one worksheet to export.', 'invalid-data');
  const names = new Set();
  const prepared = sheets.map((sheet, index) => {
    const base = String(sheet.name || `Sheet ${index + 1}`).replace(/[\\/\[\]:*?\u0000-\u001f]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31) || `Sheet ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (names.has(name.toLowerCase())) {
      const ending = ` (${suffix++})`;
      name = base.slice(0, 31 - ending.length) + ending;
    }
    names.add(name.toLowerCase());
    const sourceRows = sheet.grid || sheet.rows || [];
    const columns = sheet.columns || (sourceRows.some(row => row && typeof row === 'object' && !Array.isArray(row)) ? [...new Set(sourceRows.flatMap(row => Object.keys(row || {})))] : null);
    const rows = sourceRows.map(row => Array.isArray(row) ? row : columns ? columns.map(column => row?.[column]) : [row]);
    if (!sheet.grid && columns && sheet.includeHeader !== false) rows.unshift(columns);
    if (rows.length > 1_048_576 || rows.some(row => row.length > 16_384)) throw new DataError('A worksheet exceeds the XLSX row or column limit.', 'data-limit');
    return { name, rows };
  });
  const files = {
    '[Content_Types].xml': `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${prepared.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `${declaration}<Relationships xmlns="${packageNamespace}"><Relationship Id="workbook" Type="${relationNamespace}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${declaration}<workbook xmlns="${sheetNamespace}" xmlns:r="${relationNamespace}"><sheets>${prepared.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="sheet${index + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${declaration}<Relationships xmlns="${packageNamespace}">${prepared.map((_, index) => `<Relationship Id="sheet${index + 1}" Type="${relationNamespace}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`
  };
  prepared.forEach((sheet, index) => {
    const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
      if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${cellText(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${index + 1}.xml`] = `${declaration}<worksheet xmlns="${sheetNamespace}"><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zipParts(files, options);
}

export function exportXlsx(rows, { columns, sheetName = 'Data', includeHeader = true, ...options } = {}) {
  return exportWorkbook([{ name: sheetName, columns, rows, includeHeader }], options);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 as nativeCrc32 } from 'node:zlib';
import { parseData, selectData, parseXlsx, excelDate, exportXlsx, exportWorkbook } from '../src/data/index.js';
import { openZip } from '../src/data/zip.js';

// Independently construct real ZIP fixtures, including compressed and stored entries.
function archive(files, compressed = true) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [path, xml] of Object.entries(files)) {
    const name = Buffer.from(path);
    const bytes = Buffer.from(xml);
    const data = compressed ? deflateRawSync(bytes) : bytes;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(compressed ? 8 : 0, 8);
    header.writeUInt32LE(nativeCrc32(bytes), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    locals.push(header, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(compressed ? 8 : 0, 10);
    central.writeUInt32LE(nativeCrc32(bytes), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const inline = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;

function workbookFiles() {
  return {
    '_rels/.rels': `<Relationships xmlns="${packageNs}"><Relationship Id="root" Type="${relNs}/officeDocument" Target="book/workbook.xml"/></Relationships>`,
    'book/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${relNs}"><sheets><sheet name="People" sheetId="1" r:id="s1"/><sheet name="Flags" sheetId="2" r:id="s2"/></sheets></workbook>`,
    'book/_rels/workbook.xml.rels': `<Relationships xmlns="${packageNs}"><Relationship Id="s1" Type="${relNs}/worksheet" Target="../tables/people.xml"/><Relationship Id="s2" Type="${relNs}/worksheet" Target="../tables/flags.xml"/><Relationship Id="strings" Type="${relNs}/sharedStrings" Target="strings.xml"/><Relationship Id="styles" Type="${relNs}/styles" Target="styles.xml"/></Relationships>`,
    'book/strings.xml': `<sst xmlns="${ns}"><si><t>Ada</t></si><si><r><t>ada</t></r><r><t>@example.com</t></r><rPh><t>phonetic text is not the value</t></rPh></si><si><t>_x005F_x0041_</t></si></sst>`,
    'book/styles.xml': `<styleSheet xmlns="${ns}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    'tables/people.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1">${inline('A1', 'Name')}${inline('B1', 'Email')}${inline('C1', 'Date')}${inline('D1', 'Count')}</row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" s="1"><v>1</v></c><c r="D2"><f>SUM(1,2)</f><v>3</v></c></row><row r="5">${inline('A5', 'Grace &amp; Helena')}${inline('B5', 'grace@example.net')}<c r="C5" s="1"><v>60</v></c><c r="D5"><f>SUM(2,3)</f></c></row></sheetData></worksheet>`,
    'tables/flags.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1">${inline('A1', 'Flag')}${inline('B1', 'Literal')}${inline('C1', 'Error')}</row><row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="e"><v>#DIV/0!</v></c></row></sheetData></worksheet>`
  };
}

test('XLSX reads actual compressed OOXML, relationship paths, sheets, rich strings, dates and cached formulas', async () => {
  const bytes = archive(workbookFiles());
  const data = await parseData(new File([bytes], 'people.xlsx'));
  assert.equal(data.format, 'xlsx');
  assert.deepEqual(data.sheets.map(sheet => sheet.name), ['People', 'Flags']);
  assert.deepEqual(data.columns, ['Name', 'Email', 'Date', 'Count']);
  assert.deepEqual(data.rows, [['Ada', 'ada@example.com', '1900-01-01', '3'], ['Grace & Helena', 'grace@example.net', '1900-02-29', '']]);
  assert.deepEqual(data.sheets[0].rowNumbers, [1, 2, 5]);
  assert.equal(data.sheets[0].cellInfo.C2.raw, '1');
  assert.equal(data.sheets[0].cellInfo.D2.formula, 'SUM(1,2)');
  assert.equal(data.sheets[0].cellInfo.D5.cached, false);
  assert.match(data.warnings[0], /without a saved result/);
  assert.equal(selectData(data, { sheet: 'People', column: 'Email' }).text, 'ada@example.com\ngrace@example.net');
  const flags = selectData(data, { sheet: 'Flags' });
  assert.deepEqual(flags.rows, [['true', '_x0041_', '#DIV/0!']]);
  assert.equal(selectData(data, { sheet: 'Flags', column: 'Literal' }).text, '_x0041_');
});

test('XLSX also accepts stored ZIP entries and preserves exact numeric values', async () => {
  const files = workbookFiles();
  files['tables/people.xml'] = `<worksheet xmlns="${ns}"><sheetData><row r="1">${inline('A1', 'Identifier')}</row><row r="2"><c r="A2"><v>9007199254740993123</v></c></row></sheetData></worksheet>`;
  const data = await parseXlsx(archive(files, false));
  assert.equal(data.rows[0][0], '9007199254740993123');
});

test('Excel serial conversion covers the 1900 leap-day bug, 1904 epoch, times and durations', () => {
  assert.equal(excelDate('1', 'date'), '1900-01-01');
  assert.equal(excelDate('59', 'date'), '1900-02-28');
  assert.equal(excelDate('60', 'date'), '1900-02-29');
  assert.equal(excelDate('61', 'date'), '1900-03-01');
  assert.equal(excelDate('0', 'date', true), '1904-01-01');
  assert.equal(excelDate('0.5', 'time'), '12:00:00');
  assert.equal(excelDate('2.5', 'duration'), '60:00:00');
});

test('ZIP readers detect corruption and enforce declared/expanded entry limits', async () => {
  const bytes = archive({ 'entry.xml': '<test>value</test>' }, false);
  const corrupt = Buffer.from(bytes);
  corrupt[30 + Buffer.byteLength('entry.xml') + 7] ^= 1;
  await assert.rejects(() => openZip(corrupt).text('entry.xml'), /integrity check/);
  await assert.rejects(() => openZip(bytes, { maxEntryBytes: 3 }).text('entry.xml'), /size limit/);
  assert.throws(() => openZip(bytes.subarray(0, bytes.length - 4)), /archive/);
  const compressed = archive({ 'entry.xml': '<test>' + 'A'.repeat(100_000) + '</test>' });
  await assert.rejects(() => openZip(compressed, { maxTotalBytes: 100 }).read('entry.xml'), /size limit/);
});

test('XLSX data matrix limits reject excessively sparse/large shapes before allocation', async () => {
  const files = workbookFiles();
  files['tables/people.xml'] = `<worksheet xmlns="${ns}"><sheetData><row r="1">${inline('XFD1', 'Far column')}</row></sheetData></worksheet>`;
  await assert.rejects(() => parseXlsx(archive(files), { maxCells: 100 }), /cell import limit/);
});

test('XLSX export roundtrips matches as literal text, preserving Unicode, control characters and numeric values', async () => {
  const rows = [['=SUM(1,2)', 'A&B <test>', 42, true], ['_x0041_', 'line\r\n\u0000🙂', 3.5, false]];
  const blob = await exportXlsx(rows, { columns: ['Match', 'Text', 'Number', 'Flag'], sheetName: 'Results' });
  const data = await parseXlsx(await blob.arrayBuffer());
  assert.deepEqual(data.rows, [['=SUM(1,2)', 'A&B <test>', '42', 'true'], ['_x0041_', 'line\r\n\u0000🙂', '3.5', 'false']]);
  assert.equal(data.sheets[0].name, 'Results');
  assert.deepEqual(Object.keys(data.sheets[0].cellInfo), []);
  const multi = await exportWorkbook([{ name: 'Result', rows: [{ value: 'a' }] }, { name: 'result', rows: [{ value: 'b' }] }], { compress: false });
  assert.deepEqual((await parseXlsx(await multi.arrayBuffer())).sheets.map(sheet => sheet.name), ['Result', 'result (2)']);
});

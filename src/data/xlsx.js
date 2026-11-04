import { checkAbort, DataError, tableFromGrid } from "./errors.js";
import { stringifyCsv } from "./csv.js";
import { childrenNamed, firstChild, nodeText, parseXml } from "./xml.js";
import { openZip } from "./zip.js";

const builtInFormats = new Map([
  [14, "mm-dd-yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
]);

function resolvePart(base, target) {
  if (
    !target ||
    /^[a-z][a-z\d+.-]*:/i.test(target) ||
    target.startsWith("//") ||
    target.includes("\\")
  )
    throw new DataError(
      "The workbook references an unsupported external part.",
      "unsupported-xlsx",
    );
  const clean = target.split("#")[0];
  const segments = clean.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length)
        throw new DataError(
          "A workbook relationship points outside the archive.",
          "invalid-xlsx",
        );
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

function relationships(root, base) {
  const result = new Map();
  for (const relation of childrenNamed(root, "Relationship")) {
    const {
      Id: id,
      Target: target,
      Type: type,
      TargetMode: targetMode,
    } = relation.attributes;
    if (!id || !type || !target || targetMode === "External") continue;
    result.set(id, { type, target: resolvePart(base, target) });
  }
  return result;
}

function relationshipPart(path) {
  const segments = path.split("/");
  const file = segments.pop();
  return [...segments, "_rels", `${file}.rels`].join("/");
}

function decodeSpreadsheetText(text) {
  // A single pass preserves escaped literals such as _x005F_x0041_ -> _x0041_.
  return text.replace(/_x([\da-f]{4})_/gi, (_, code) =>
    String.fromCharCode(Number.parseInt(code, 16)),
  );
}

function richText(container) {
  return decodeSpreadsheetText(
    (container?.children || [])
      .map((child) =>
        child.localName === "t"
          ? nodeText(child)
          : child.localName === "r"
            ? nodeText(firstChild(child, "t"))
            : "",
      )
      .join(""),
  );
}

function dateFormat(format, id) {
  if (
    !format &&
    ((id >= 27 && id <= 36) || (id >= 50 && id <= 58) || (id >= 71 && id <= 81))
  )
    return "date";
  if (!format) return null;
  if (/\[[hms]+\]/i.test(format)) return "duration";
  const cleaned = format
    .replace(/"[^"]*"|\\.|\[[^\]]*\]|_.|\*./g, "")
    .toLowerCase();
  const hasTime = /[hs]/.test(cleaned);
  const hasDate = /[yd]/.test(cleaned) || (/m/.test(cleaned) && !hasTime);
  return hasDate && hasTime
    ? "datetime"
    : hasDate
      ? "date"
      : hasTime
        ? "time"
        : null;
}

function readStyles(root) {
  const formats = new Map(builtInFormats);
  for (const node of childrenNamed(firstChild(root, "numFmts"), "numFmt"))
    formats.set(
      Number(node.attributes.numFmtId),
      node.attributes.formatCode || "",
    );
  return childrenNamed(firstChild(root, "cellXfs"), "xf").map((node) => {
    const numFmtId = Number(node.attributes.numFmtId || 0);
    const formatCode = formats.get(numFmtId) || "";
    return { numFmtId, formatCode, kind: dateFormat(formatCode, numFmtId) };
  });
}

export function columnName(index) {
  let label = "";
  for (index++; index > 0; index = Math.floor((index - 1) / 26))
    label = String.fromCharCode(65 + ((index - 1) % 26)) + label;
  return label;
}

function columnIndex(reference) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(reference);
  if (!match || Number(match[2]) > 1_048_576)
    throw new DataError(
      `The workbook contains invalid cell reference ${reference}.`,
      "invalid-xlsx",
    );
  let index = 0;
  for (const character of match[1].toUpperCase())
    index = index * 26 + character.charCodeAt(0) - 64;
  if (index > 16_384)
    throw new DataError(
      `Cell reference ${reference} exceeds the XLSX column limit.`,
      "invalid-xlsx",
    );
  return index - 1;
}

/** Dates become ISO values; raw serials and number format metadata remain in cellInfo. */
export function excelDate(value, kind, date1904 = false) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || Math.abs(serial) > 100_000_000) return value;
  const milliseconds = Math.round(serial * 86_400_000);
  const pad = (number) => String(number).padStart(2, "0");
  if (kind === "duration") {
    const seconds = Math.round(Math.abs(milliseconds) / 1000);
    return `${serial < 0 ? "-" : ""}${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  }
  const dayMilliseconds =
    ((milliseconds % 86_400_000) + 86_400_000) % 86_400_000;
  const time = `${pad(Math.floor(dayMilliseconds / 3_600_000))}:${pad(Math.floor(dayMilliseconds / 60_000) % 60)}:${pad(Math.floor(dayMilliseconds / 1000) % 60)}${dayMilliseconds % 1000 ? `.${String(dayMilliseconds % 1000).padStart(3, "0")}` : ""}`;
  if (kind === "time") return time;
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : Date.UTC(1899, 11, serial < 60 ? 31 : 30);
  const date = new Date(epoch + milliseconds);
  if (!Number.isFinite(date.getTime())) return value;
  const iso =
    !date1904 && serial >= 60 && serial < 61
      ? "1900-02-29"
      : date.toISOString().split("T")[0];
  return kind === "datetime" ? `${iso}T${time}` : iso;
}

function readSheet(
  root,
  { sharedStrings, styles, date1904, header, maxCells, maxRows, signal },
) {
  const sheetData = firstChild(root, "sheetData");
  const grid = [];
  const rowNumbers = [];
  const cellInfo = Object.create(null);
  let uncachedFormulas = 0;
  let cells = 0;
  let width = 0;
  let previousRow = 0;
  for (const rowNode of childrenNamed(sheetData, "row")) {
    checkAbort(signal);
    const rowNumber = Number(rowNode.attributes.r || previousRow + 1);
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1_048_576)
      throw new DataError(
        "The workbook contains an invalid worksheet row number.",
        "invalid-xlsx",
      );
    previousRow = rowNumber;
    const row = [];
    let nextColumn = 0;
    let populated = false;
    for (const cell of childrenNamed(rowNode, "c")) {
      if (++cells > maxCells)
        throw new DataError(
          `A worksheet exceeds the ${maxCells.toLocaleString()} cell import limit.`,
          "data-limit",
        );
      const reference =
        cell.attributes.r || `${columnName(nextColumn)}${rowNumber}`;
      const index = columnIndex(reference);
      nextColumn = index + 1;
      const type = cell.attributes.t || "n";
      const formulaNode = firstChild(cell, "f");
      const valueNode = firstChild(cell, "v");
      const inlineNode = firstChild(cell, "is");
      const raw = nodeText(valueNode);
      let value = raw;
      const styleIndex = Number(cell.attributes.s || 0);
      const style = styles[styleIndex];
      if (type === "s") {
        if (!/^\d+$/.test(raw) || !Object.hasOwn(sharedStrings, Number(raw)))
          throw new DataError(
            `Cell ${reference} references a missing shared string.`,
            "invalid-xlsx",
          );
        value = sharedStrings[Number(raw)];
      } else if (type === "inlineStr") value = richText(inlineNode);
      else if (type === "b")
        value = raw === "1" ? "true" : raw === "0" ? "false" : raw;
      else if (type === "str") value = decodeSpreadsheetText(raw);
      else if (type === "n" && raw !== "" && style?.kind)
        value = excelDate(raw, style.kind, date1904);
      if (formulaNode && !valueNode) uncachedFormulas++;
      if (formulaNode || style?.kind || type === "e")
        cellInfo[reference] = {
          raw,
          value,
          type,
          ...(formulaNode
            ? { formula: nodeText(formulaNode), cached: Boolean(valueNode) }
            : {}),
          ...(style?.kind
            ? { format: style.formatCode, numFmtId: style.numFmtId }
            : {}),
        };
      row[index] = value;
      if (value !== "" || formulaNode) populated = true;
    }
    if (!populated) continue;
    while (row.length && (row.at(-1) === "" || row.at(-1) === undefined))
      row.pop();
    width = Math.max(width, row.length);
    grid.push(
      Array.from({ length: row.length }, (_, index) => row[index] ?? ""),
    );
    rowNumbers.push(rowNumber);
    if (grid.length > maxRows || width * grid.length > maxCells)
      throw new DataError(
        `The worksheet table exceeds the ${maxCells.toLocaleString()} cell import limit. Export only the needed rows and columns as CSV.`,
        "data-limit",
      );
  }
  const table = tableFromGrid(grid, {
    header,
    labels: Array.from({ length: width }, (_, index) => columnName(index)),
  });
  return { ...table, grid, rowNumbers, cellInfo, uncachedFormulas };
}

export async function parseXlsx(
  buffer,
  {
    header = true,
    sheet = 0,
    maxCells = 2_000_000,
    maxRows = 1_000_000,
    signal,
    ...zipOptions
  } = {},
) {
  const archive = openZip(buffer, { ...zipOptions, signal });
  let workbookPath = "xl/workbook.xml";
  if (archive.has("_rels/.rels")) {
    const packageRelations = relationships(
      parseXml(await archive.text("_rels/.rels")),
      "",
    );
    const officeDocument = [...packageRelations.values()].find((relation) =>
      relation.type.endsWith("/officeDocument"),
    );
    if (officeDocument) workbookPath = officeDocument.target;
  }
  const workbook = parseXml(await archive.text(workbookPath));
  if (workbook.localName !== "workbook")
    throw new DataError(
      "The archive does not contain an XLSX workbook.",
      "invalid-xlsx",
    );
  const relations = relationships(
    parseXml(await archive.text(relationshipPart(workbookPath))),
    workbookPath,
  );
  const relationByType = (type) =>
    [...relations.values()].find((relation) =>
      relation.type.endsWith(`/${type}`),
    );
  const stringsRelation = relationByType("sharedStrings");
  const stylesRelation = relationByType("styles");
  const sharedStrings = stringsRelation
    ? childrenNamed(
        parseXml(await archive.text(stringsRelation.target)),
        "si",
      ).map(richText)
    : [];
  const styles = stylesRelation
    ? readStyles(parseXml(await archive.text(stylesRelation.target)))
    : [];
  const date1904 = ["1", "true"].includes(
    firstChild(workbook, "workbookPr")?.attributes.date1904,
  );
  const warnings = [];
  const sheets = [];
  for (const sheetNode of childrenNamed(
    firstChild(workbook, "sheets"),
    "sheet",
  )) {
    checkAbort(signal);
    const id =
      sheetNode.attributes["r:id"] ||
      Object.entries(sheetNode.attributes).find(([key]) =>
        key.endsWith(":id"),
      )?.[1];
    const relation = relations.get(id);
    const name = decodeSpreadsheetText(
      sheetNode.attributes.name || `Sheet ${sheets.length + 1}`,
    );
    if (!relation?.type.endsWith("/worksheet")) {
      warnings.push(`“${name}” is not a data worksheet and was skipped.`);
      continue;
    }
    const parsed = readSheet(
      parseXml(await archive.text(relation.target), {
        maxNodes: Math.max(1_000_000, maxCells * 3),
      }),
      { sharedStrings, styles, date1904, header, maxCells, maxRows, signal },
    );
    if (parsed.uncachedFormulas)
      warnings.push(
        `“${name}” has ${parsed.uncachedFormulas} formula cell${parsed.uncachedFormulas === 1 ? "" : "s"} without a saved result. Open and save it in a spreadsheet app to calculate those cells.`,
      );
    sheets.push({
      name,
      id: sheetNode.attributes.sheetId || String(sheets.length + 1),
      state: sheetNode.attributes.state || "visible",
      ...parsed,
    });
  }
  if (!sheets.length)
    throw new DataError(
      "The workbook does not contain any data worksheets.",
      "invalid-xlsx",
    );
  let selectedSheet =
    typeof sheet === "string"
      ? sheets.findIndex((item) => item.name === sheet)
      : sheet;
  if (selectedSheet === -1 && typeof sheet === "string" && /^\d+$/.test(sheet))
    selectedSheet = Number(sheet);
  if (
    !Number.isInteger(selectedSheet) ||
    selectedSheet < 0 ||
    selectedSheet >= sheets.length
  )
    throw new DataError(
      "The selected worksheet was not found.",
      "invalid-selection",
    );
  const selected = sheets[selectedSheet];
  return {
    sheets,
    selectedSheet,
    columns: selected.columns,
    rows: selected.rows,
    grid: selected.grid,
    header,
    text: stringifyCsv(selected.grid, { delimiter: "\t", newline: "\n" }),
    warnings,
  };
}

/** Errors with stable codes for hosts that want to show contextual recovery actions. */
export class DataError extends Error {
  constructor(message, code = "invalid-data", details = {}) {
    super(message);
    this.name = "DataError";
    this.code = code;
    this.details = details;
  }
}

export function checkAbort(signal) {
  if (signal?.aborted)
    throw (
      signal.reason || new DOMException("Operation cancelled.", "AbortError")
    );
}

export function createId(prefix = "data") {
  const value =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${value}`;
}

export function toCellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function uniqueColumns(values, prefix = "Column") {
  const used = new Set();
  return values.map((value, index) => {
    const base = toCellText(value).trim() || `${prefix} ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} (${suffix++})`;
    used.add(name);
    return name;
  });
}

export function tableFromGrid(grid, { header = true, labels } = {}) {
  const width = grid.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const first = grid[0] || [];
  const columns = uniqueColumns(
    Array.from({ length: width }, (_, index) =>
      header ? first[index] : labels?.[index] || `Column ${index + 1}`,
    ),
  );
  const rows = (header ? grid.slice(1) : grid).map((row) =>
    Array.from({ length: width }, (_, index) => toCellText(row[index])),
  );
  return { columns, rows, header };
}

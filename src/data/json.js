import { DataError, toCellText } from "./errors.js";

export function parseJson(text) {
  try {
    return JSON.parse(text.replace(/^\ufeff/, ""));
  } catch (error) {
    throw new DataError(
      `This is not valid JSON. ${error.message}`,
      "invalid-json",
    );
  }
}

export function jsonTable(value) {
  const values = Array.isArray(value) ? value : [value];
  if (
    values.every(
      (item) =>
        item !== null && typeof item === "object" && !Array.isArray(item),
    )
  ) {
    const columns = [...new Set(values.flatMap((item) => Object.keys(item)))];
    return {
      columns,
      rows: values.map((item) =>
        columns.map((name) =>
          Object.hasOwn(item, name) ? toCellText(item[name]) : "",
        ),
      ),
    };
  }
  return { columns: ["Value"], rows: values.map((item) => [toCellText(item)]) };
}

/** RFC 6901 JSON Pointer, with a documented '*' extension to select every child. */
export function selectJson(value, pointer = "") {
  if (pointer === "") return [value];
  if (!pointer.startsWith("/"))
    throw new DataError(
      "Enter a JSON Pointer such as /users/0/email or /users/*/email. An empty path selects the whole document.",
      "invalid-json-path",
    );
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => {
      if (/~(?![01])/u.test(token))
        throw new DataError(
          "JSON Pointer escapes are ~0 for a tilde and ~1 for a slash.",
          "invalid-json-path",
        );
      return token.replaceAll("~1", "/").replaceAll("~0", "~");
    });
  let selected = [value];
  for (const token of tokens) {
    const next = [];
    for (const item of selected) {
      if (item === null || typeof item !== "object") continue;
      if (token === "*") next.push(...Object.values(item));
      else if (
        Object.hasOwn(item, token) &&
        (!Array.isArray(item) || /^(0|[1-9]\d*)$/.test(token))
      )
        next.push(item[token]);
    }
    selected = next;
  }
  return selected;
}

export function jsonPaths(value, { maxDepth = 5, limit = 120 } = {}) {
  const paths = [""];
  const visit = (item, prefix, depth) => {
    if (
      depth >= maxDepth ||
      item === null ||
      typeof item !== "object" ||
      paths.length >= limit
    )
      return;
    const entries = Array.isArray(item)
      ? item.length
        ? [["*", item[0]]]
        : []
      : Object.entries(item);
    for (const [key, child] of entries) {
      if (paths.length >= limit) return;
      const path = `${prefix}/${key === "*" ? "*" : key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      paths.push(path);
      visit(child, path, depth + 1);
    }
  };
  visit(value, "", 0);
  return paths;
}

import { createId, DataError, toCellText } from "../data/errors.js";

export const PROJECT_FORMAT = "regex-studio-project";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".regexstudio.json";
export const MAX_PROJECT_BYTES = 128 * 1024 * 1024;
const colors = [
  "#6d5ce7",
  "#008c82",
  "#dd7d32",
  "#337dcc",
  "#bf5d99",
  "#788c34",
];
const dataFormats = new Set([
  "text",
  "json",
  "jsonl",
  "xml",
  "csv",
  "tsv",
  "xlsx",
]);

function cloneJson(value, description = "Project") {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new DataError(
      `${description} must contain ordinary JSON values without circular references.`,
      "invalid-project",
    );
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DataError(`${label} must be an object.`, "invalid-project");
  return value;
}

function safeState(value, depth = 0) {
  if (depth > 64)
    throw new DataError(
      "Workspace state exceeds the supported nesting depth.",
      "invalid-project",
    );
  if (Array.isArray(value))
    return value.map((item) => safeState(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !["__proto__", "constructor", "prototype"].includes(key),
      )
      .map(([key, item]) => [key, safeState(item, depth + 1)]),
  );
}

function identifier(value, prefix) {
  if (value === undefined || value === null || value === "")
    return createId(prefix);
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    /[\u0000-\u001f]/u.test(value)
  )
    throw new DataError(`Invalid ${prefix} identifier.`, "invalid-project");
  return value;
}

function string(value, fallback = "", maxLength = MAX_PROJECT_BYTES) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string")
    throw new DataError(
      "A project text field has an invalid type.",
      "invalid-project",
    );
  if (value.length > maxLength)
    throw new DataError(
      "A project text field exceeds the supported length.",
      "data-limit",
    );
  return value;
}

function date(value, fallback) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : fallback;
}

function grid(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((row) => !Array.isArray(row)))
    throw new DataError(
      `${label} must contain an array of rows.`,
      "invalid-project",
    );
  return value.map((row) => row.map(toCellText));
}

function safeSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    return { kind: "paste" };
  const allowed = [
    "kind",
    "name",
    "url",
    "fetchedAt",
    "contentType",
    "size",
    "byteLength",
    "lastModified",
  ];
  const result = Object.fromEntries(
    allowed
      .filter(
        (key) =>
          Object.hasOwn(source, key) &&
          ["string", "number"].includes(typeof source[key]),
      )
      .map((key) => [key, source[key]]),
  );
  if (result.url) {
    try {
      const url = new URL(result.url);
      if (!["http:", "https:"].includes(url.protocol)) delete result.url;
      else {
        url.username = "";
        url.password = "";
        result.url = url.href;
      }
    } catch {
      delete result.url;
    }
  }
  return result;
}

export function validateDataset(input) {
  plainObject(input, "Dataset");
  const value = cloneJson(input, "Dataset");
  if (!dataFormats.has(value.format || "text"))
    throw new DataError(
      `Dataset format ${value.format} is not supported.`,
      "invalid-project",
    );
  const now = new Date().toISOString();
  const text = string(value.text);
  const result = {
    ...value,
    id: identifier(value.id, "data"),
    name: string(value.name, "Untitled data", 500),
    format: value.format || "text",
    text,
    sourceText: string(value.sourceText, text),
    columns: Array.isArray(value.columns) ? value.columns.map(toCellText) : [],
    rows: grid(value.rows, "Dataset rows"),
    source: safeSource(value.source),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.map(toCellText)
      : [],
    createdAt: date(value.createdAt, now),
    updatedAt: date(value.updatedAt, now),
  };
  if (value.grid !== undefined) result.grid = grid(value.grid, "Dataset grid");
  if (value.sheets !== undefined) {
    if (!Array.isArray(value.sheets))
      throw new DataError(
        "Workbook sheets must be an array.",
        "invalid-project",
      );
    result.sheets = value.sheets.map((sheet, index) => {
      plainObject(sheet, "Workbook sheet");
      return {
        ...sheet,
        id: string(sheet.id, String(index + 1)),
        name: string(sheet.name, `Sheet ${index + 1}`, 500),
        columns: Array.isArray(sheet.columns)
          ? sheet.columns.map(toCellText)
          : [],
        rows: grid(sheet.rows, "Worksheet rows"),
        grid: grid(sheet.grid, "Worksheet grid"),
      };
    });
  }
  if (value.selection !== undefined)
    result.selection = safeState(value.selection);
  delete result.headers;
  delete result.requestHeaders;
  return result;
}

/** Normalize a project without mutating it; arbitrary workspace/layout keys are retained. */
export function validateProject(input) {
  plainObject(input, "Project");
  if (input.format !== undefined && input.format !== PROJECT_FORMAT)
    throw new DataError(
      "This file is not a RegexStudio project.",
      "invalid-project",
    );
  const version = input.version ?? input.schemaVersion ?? PROJECT_VERSION;
  if (version !== PROJECT_VERSION)
    throw new DataError(
      `Project version ${version} is not supported by this version of RegexStudio.`,
      "unsupported-project",
    );
  const value = cloneJson(input);
  const now = new Date().toISOString();
  if (value.patterns !== undefined && !Array.isArray(value.patterns))
    throw new DataError(
      "Project patterns must be an array.",
      "invalid-project",
    );
  if (value.datasets !== undefined && !Array.isArray(value.datasets))
    throw new DataError(
      "Project datasets must be an array.",
      "invalid-project",
    );
  const patterns = (value.patterns || []).map((pattern, index) => {
    plainObject(pattern, "Pattern");
    const options = pattern.options ?? 0;
    if (!Number.isInteger(options) || options < 0 || options > 2_147_483_647)
      throw new DataError(
        `Pattern ${index + 1} has invalid .NET RegexOptions.`,
        "invalid-project",
      );
    return {
      ...safeState(pattern),
      id: identifier(pattern.id, "pattern"),
      name: string(pattern.name, `Pattern ${index + 1}`, 500),
      pattern: string(pattern.pattern),
      options,
      color:
        typeof pattern.color === "string" &&
        /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(pattern.color)
          ? pattern.color
          : colors[index % colors.length],
      enabled: pattern.enabled !== false,
      replacement: string(pattern.replacement),
    };
  });
  const datasets = (value.datasets || []).map(validateDataset);
  if (
    new Set(patterns.map((pattern) => pattern.id)).size !== patterns.length ||
    new Set(datasets.map((dataset) => dataset.id)).size !== datasets.length
  )
    throw new DataError(
      "Every pattern and dataset needs a unique identifier.",
      "invalid-project",
    );
  const result = {
    ...safeState(
      Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => !["patterns", "datasets"].includes(key),
        ),
      ),
    ),
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: identifier(value.id, "project"),
    name: string(value.name, "Untitled project", 500),
    description: string(value.description, "", 10_000),
    createdAt: date(value.createdAt, now),
    updatedAt: date(value.updatedAt, now),
    patterns,
    datasets,
    activePatternId: patterns.some(
      (pattern) => pattern.id === value.activePatternId,
    )
      ? value.activePatternId
      : (patterns[0]?.id ?? null),
    activeDatasetId: datasets.some(
      (dataset) => dataset.id === value.activeDatasetId,
    )
      ? value.activeDatasetId
      : (datasets[0]?.id ?? null),
    workspace: safeState(value.workspace || {}),
    layout: safeState(value.layout || {}),
  };
  delete result.schemaVersion;
  delete result.headers;
  delete result.requestHeaders;
  return result;
}

export function createProject(initial = {}) {
  return validateProject({
    name: "Untitled project",
    patterns: [
      {
        id: createId("pattern"),
        name: "Pattern 1",
        pattern: "",
        options: 0,
        color: colors[0],
        enabled: true,
        replacement: "",
      },
    ],
    datasets: [],
    workspace: {},
    layout: {},
    ...initial,
  });
}

function boundedJson(value, pretty = false) {
  const text = JSON.stringify(value, null, pretty ? 2 : 0);
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES)
    throw new DataError(
      `The project exceeds the ${Math.round(MAX_PROJECT_BYTES / 1024 / 1024)} MB storage limit. Export datasets separately or remove unused data.`,
      "data-limit",
    );
  return text;
}

export function serializeProject(project) {
  return boundedJson(validateProject(project), true);
}

export function deserializeProject(content, { newId = false } = {}) {
  let value;
  if (typeof content === "string") {
    if (new TextEncoder().encode(content).byteLength > MAX_PROJECT_BYTES)
      throw new DataError(
        "This project file exceeds the import size limit.",
        "data-limit",
      );
    try {
      value = JSON.parse(content);
    } catch (error) {
      throw new DataError(
        `The project file is not valid JSON. ${error.message}`,
        "invalid-project",
      );
    }
  } else value = content;
  if (value?.format !== PROJECT_FORMAT)
    throw new DataError(
      "This file is not a RegexStudio project. Import it as data instead.",
      "invalid-project",
    );
  const project = validateProject(value);
  if (newId) {
    project.id = createId("project");
    project.createdAt = project.updatedAt = new Date().toISOString();
  }
  return project;
}

function summary(kind, value) {
  const common = {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  return kind === "projects"
    ? {
        ...common,
        patternCount: value.patterns.length,
        datasetCount: value.datasets.length,
      }
    : {
        ...common,
        format: value.format,
        byteLength:
          value.byteLength ?? new TextEncoder().encode(value.text).byteLength,
        rowCount: value.rows.length,
        columnCount: value.columns.length,
        sheetCount: value.sheets?.length ?? 0,
      };
}

function storageError(error) {
  if (error instanceof DataError) return error;
  if (error?.name === "QuotaExceededError")
    return new DataError(
      "Browser storage is full. Export a project or remove a saved item before saving again.",
      "storage-quota",
    );
  return new DataError(
    `Browser storage is unavailable. Download the project to keep your work. ${error?.message || ""}`.trim(),
    "storage-unavailable",
  );
}

/** Injectable storage adapter makes this module usable in other browser applications. */
export function createProjectStore({
  indexedDB: indexedDBFactory,
  localStorage: localStorageAdapter,
  databaseName = "regex-studio",
  namespace = "regex-studio:",
} = {}) {
  let backendPromise;
  let backendName = "uninitialized";
  const backend = () => {
    if (backendPromise) return backendPromise;
    const attempt = (async () => {
      const factory =
        indexedDBFactory === undefined
          ? globalThis.indexedDB
          : indexedDBFactory;
      if (factory) {
        try {
          const database = await new Promise((resolve, reject) => {
            const request = factory.open(databaseName, 1);
            let blockedTimer;
            let settled = false;
            const fail = (error) => {
              if (settled) return;
              settled = true;
              clearTimeout(blockedTimer);
              reject(error);
            };
            request.onupgradeneeded = () => {
              for (const name of [
                "projects",
                "datasets",
                "project-summaries",
                "dataset-summaries",
              ])
                if (!request.result.objectStoreNames.contains(name))
                  request.result.createObjectStore(name, { keyPath: "id" });
            };
            request.onsuccess = () => {
              clearTimeout(blockedTimer);
              const result = request.result;
              if (settled) {
                result.close();
                return;
              }
              settled = true;
              result.onversionchange = () => {
                result.close();
                backendPromise = undefined;
                backendName = "uninitialized";
              };
              resolve(result);
            };
            request.onerror = () => fail(request.error);
            request.onblocked = () => {
              blockedTimer = setTimeout(
                () =>
                  fail(
                    new Error(
                      "Another tab is holding an older database connection.",
                    ),
                  ),
                3_000,
              );
            };
          });
          backendName = "indexeddb";
          return { database };
        } catch {
          /* Private/embedded browsers can disable IndexedDB but allow localStorage. */
        }
      }
      try {
        const local =
          localStorageAdapter === undefined
            ? globalThis.localStorage
            : localStorageAdapter;
        if (!local) throw new Error("Storage is disabled.");
        const probe = `${namespace}storage-probe`;
        local.setItem(probe, "1");
        local.removeItem(probe);
        backendName = "localstorage";
        return { local };
      } catch (error) {
        backendName = "unavailable";
        throw storageError(error);
      }
    })();
    backendPromise = attempt;
    attempt.catch(() => {
      if (backendPromise === attempt) backendPromise = undefined;
    });
    return attempt;
  };

  async function transaction(database, storeNames, mode, action) {
    const tx = database.transaction(storeNames, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error("Storage transaction failed."));
      tx.onabort = () =>
        reject(tx.error || new Error("Storage transaction was cancelled."));
    });
    // Attach a rejection handler immediately; a failed request can abort before action returns.
    done.catch(() => {});
    const request = (operation) =>
      new Promise((resolve, reject) => {
        operation.onsuccess = () => resolve(operation.result);
        operation.onerror = () => reject(operation.error);
      });
    try {
      const result = await action(tx, request);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* A failed transaction may already have aborted. */
      }
      await done.catch(() => {});
      throw error;
    }
  }

  const summaryStore = (kind) =>
    kind === "projects" ? "project-summaries" : "dataset-summaries";
  const key = (kind, id) => `${namespace}${kind}:${id}`;
  async function save(kind, input, { expectedUpdatedAt } = {}) {
    const record =
      kind === "projects" ? validateProject(input) : validateDataset(input);
    try {
      const { database, local } = await backend();
      const prepare = (existing) => {
        if (
          expectedUpdatedAt !== undefined &&
          (existing?.updatedAt ?? null) !== expectedUpdatedAt
        )
          throw new DataError(
            "This item was changed in another tab. Reload it or save a copy before replacing it.",
            "storage-conflict",
          );
        record.createdAt = existing?.createdAt || record.createdAt;
        // Distinct revisions even when two saves occur in the same millisecond.
        record.updatedAt = new Date(
          Math.max(
            Date.now(),
            existing?.updatedAt ? Date.parse(existing.updatedAt) + 1 : 0,
          ),
        ).toISOString();
        return boundedJson(record);
      };
      if (database) {
        return await transaction(
          database,
          [kind, summaryStore(kind)],
          "readwrite",
          async (tx, request) => {
            const store = tx.objectStore(kind);
            prepare(await request(store.get(record.id)));
            store.put(record);
            tx.objectStore(summaryStore(kind)).put(summary(kind, record));
            return record;
          },
        );
      }
      const previous = local.getItem(key(kind, record.id));
      const json = prepare(previous ? JSON.parse(previous) : null);
      local.setItem(key(kind, record.id), json);
      return record;
    } catch (error) {
      throw storageError(error);
    }
  }

  async function load(kind, id) {
    if (!id) return null;
    try {
      const { database, local } = await backend();
      const value = database
        ? await transaction(database, [kind], "readonly", (tx, request) =>
            request(tx.objectStore(kind).get(id)),
          )
        : JSON.parse(local.getItem(key(kind, id)) || "null");
      return value
        ? kind === "projects"
          ? validateProject(value)
          : validateDataset(value)
        : null;
    } catch (error) {
      throw storageError(error);
    }
  }

  async function list(kind) {
    try {
      const { database, local } = await backend();
      let values;
      if (database)
        values = await transaction(
          database,
          [summaryStore(kind)],
          "readonly",
          (tx, request) => request(tx.objectStore(summaryStore(kind)).getAll()),
        );
      else {
        values = [];
        const prefix = `${namespace}${kind}:`;
        for (let index = 0; index < local.length; index++) {
          const currentKey = local.key(index);
          if (!currentKey?.startsWith(prefix)) continue;
          const value = JSON.parse(local.getItem(currentKey));
          values.push(summary(kind, value));
        }
      }
      return values.sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.name.localeCompare(right.name),
      );
    } catch (error) {
      throw storageError(error);
    }
  }

  async function remove(kind, id) {
    try {
      const { database, local } = await backend();
      if (database)
        await transaction(
          database,
          [kind, summaryStore(kind)],
          "readwrite",
          (tx) => {
            tx.objectStore(kind).delete(id);
            tx.objectStore(summaryStore(kind)).delete(id);
          },
        );
      else local.removeItem(key(kind, id));
    } catch (error) {
      throw storageError(error);
    }
  }

  return {
    saveProject: (value, options) => save("projects", value, options),
    loadProject: (id) => load("projects", id),
    listProjects: () => list("projects"),
    deleteProject: (id) => remove("projects", id),
    saveDataset: (value, options) => save("datasets", value, options),
    loadDataset: (id) => load("datasets", id),
    listDatasets: () => list("datasets"),
    deleteDataset: (id) => remove("datasets", id),
    async status() {
      await backend();
      let persisted = false;
      let estimate;
      try {
        persisted =
          (await globalThis.navigator?.storage?.persisted?.()) || false;
        estimate = await globalThis.navigator?.storage?.estimate?.();
      } catch {
        /* Storage estimates are optional. */
      }
      return { backend: backendName, persisted, ...estimate };
    },
  };
}

const store = createProjectStore();
export const saveProject = (value, options) =>
  store.saveProject(value, options);
export const loadProject = (id) => store.loadProject(id);
export const listProjects = () => store.listProjects();
export const deleteProject = (id) => store.deleteProject(id);
export const saveDataset = (value, options) =>
  store.saveDataset(value, options);
export const loadDataset = (id) => store.loadDataset(id);
export const listDatasets = () => store.listDatasets();
export const deleteDataset = (id) => store.deleteDataset(id);
export const storageStatus = () => store.status();

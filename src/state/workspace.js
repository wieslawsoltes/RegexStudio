// Imported projects are data, never executable objects or trusted UI configuration.
const EMPTY = Object.freeze({});
const OMIT = Symbol("omit");
const unsafeKeys = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "prototype",
]);
const workspaceKeys = new Set([
  "inputMode",
  "inputOperation",
  "codeStyle",
  "autoRun",
  "timeoutMs",
  "maxMatches",
  "maxSteps",
  "culture",
  "sidebarMode",
  "tests",
  "completedLessons",
]);
const layoutKeys = new Set([
  "sidebarWidth",
  "inspectorWidth",
  "patternHeight",
  "resultsHeight",
  "showSidebar",
  "showInspector",
  "dock",
]);
const defaultZones = Object.freeze({
  bottom: Object.freeze([
    "matches",
    "compare",
    "steps",
    "graph",
    "code",
    "tests",
  ]),
  right: Object.freeze(["explain", "build", "reference"]),
});
const panelIds = new Set([...defaultZones.bottom, ...defaultZones.right]);

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : EMPTY;
}

function own(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  // Accessors cannot originate in a JSON file and must never be invoked during import.
  return descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function safeKey(key) {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 200 &&
    !unsafeKeys.has(key) &&
    !/[\u0000-\u001f\u007f]/u.test(key)
  );
}
function choice(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : fallback;
}
function boolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function number(value, minimum, maximum, fallback, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(
    minimum,
    Math.min(maximum, integer ? Math.round(value) : value),
  );
}

function copyMetadata(value, budget, ancestors, depth = 0) {
  if (--budget.remaining < 0 || depth > 20) return OMIT;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : OMIT;
  if (!value || typeof value !== "object" || ancestors.has(value)) return OMIT;
  if (!Array.isArray(value) && record(value) !== value) return OMIT;
  if (Array.isArray(value) && value.length > budget.remaining) return OMIT;
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = [];
    for (let index = 0; index < value.length; index++) {
      const copied = copyMetadata(
        own(value, String(index)),
        budget,
        ancestors,
        depth + 1,
      );
      result.push(copied === OMIT ? null : copied);
    }
  } else {
    const keys = Object.keys(value);
    result = {};
    for (const key of keys.slice(0, 512)) {
      if (!safeKey(key) || budget.remaining <= 0) continue;
      const copied = copyMetadata(
        own(value, key),
        budget,
        ancestors,
        depth + 1,
      );
      if (copied !== OMIT) result[key] = copied;
    }
  }
  ancestors.delete(value);
  return result;
}

function extras(source, reserved) {
  const result = {};
  const budget = { remaining: 10_000 };
  const ancestors = new WeakSet([source]);
  for (const key of Object.keys(source).slice(0, 512)) {
    if (reserved.has(key) || !safeKey(key) || budget.remaining <= 0) continue;
    const value = copyMetadata(own(source, key), budget, ancestors);
    if (value !== OMIT) result[key] = value;
  }
  return result;
}

function normalizeTests(value) {
  if (!Array.isArray(value)) return [];
  const used = new Set();
  const suffixes = new Map();
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const item = record(own(value, String(index)));
    const input = own(item, "input");
    if (typeof input !== "string") continue;
    const requested = own(item, "id");
    const base = safeKey(requested) ? requested : `case-${index + 1}`;
    let id = base;
    if (used.has(id)) {
      let suffix = suffixes.get(base) || 2;
      do {
        const ending = `-${suffix++}`;
        id = base.slice(0, 200 - ending.length) + ending;
      } while (used.has(id));
      suffixes.set(base, suffix);
    }
    used.add(id);
    result.push({
      id,
      input,
      shouldMatch: boolean(own(item, "shouldMatch"), true),
    });
  }
  return result;
}

function completedLessons(value) {
  const source = record(value);
  const result = {};
  for (const key of Object.keys(source))
    if (safeKey(key) && own(source, key) === true) result[key] = true;
  return result;
}

/** Normalize optional project UI state; valid unrelated JSON metadata remains reusable. */
export function normalizeWorkspaceState(value) {
  const source = record(value);
  const culture = own(source, "culture");
  return {
    ...extras(source, workspaceKeys),
    inputMode: choice(own(source, "inputMode"), ["matches", "edit"], "matches"),
    inputOperation: choice(
      own(source, "inputOperation"),
      ["matches", "replace", "split"],
      "matches",
    ),
    codeStyle: choice(
      own(source, "codeStyle"),
      ["runtime", "generated"],
      "runtime",
    ),
    autoRun: boolean(own(source, "autoRun"), true),
    timeoutMs: number(own(source, "timeoutMs"), 1, 10_000, 250, true),
    maxMatches: number(own(source, "maxMatches"), 1, 100_000, 5_000, true),
    maxSteps: number(own(source, "maxSteps"), 100, 100_000, 10_000, true),
    culture: typeof culture === "string" ? culture.trim().slice(0, 100) : "",
    sidebarMode: choice(
      own(source, "sidebarMode"),
      ["patterns", "data", "projects"],
      "patterns",
    ),
    tests: normalizeTests(own(source, "tests")),
    completedLessons: completedLessons(own(source, "completedLessons")),
  };
}

/** Repair malformed docking metadata without undoing valid tab moves or empty zones. */
export function normalizePanelLayout(value) {
  const source = record(value);
  const dock = record(own(source, "dock"));
  const requestedZones = record(own(dock, "zones"));
  const requestedActive = record(own(dock, "active"));
  const seen = new Set();
  const zones = { bottom: [], right: [] };
  for (const zone of ["bottom", "right"]) {
    const requested = own(requestedZones, zone);
    if (!Array.isArray(requested)) continue;
    // Only nine panels exist. Bound malformed lists with thousands of duplicates.
    for (let index = 0; index < Math.min(requested.length, 256); index++) {
      const id = own(requested, String(index));
      if (typeof id !== "string" || !panelIds.has(id) || seen.has(id)) continue;
      zones[zone].push(id);
      seen.add(id);
    }
  }
  for (const zone of ["bottom", "right"]) {
    for (const id of defaultZones[zone])
      if (!seen.has(id)) {
        zones[zone].push(id);
        seen.add(id);
      }
  }
  const active = {};
  for (const zone of ["bottom", "right"]) {
    const id = own(requestedActive, zone);
    active[zone] = zones[zone].includes(id) ? id : (zones[zone][0] ?? null);
  }
  return {
    ...extras(source, layoutKeys),
    sidebarWidth: number(own(source, "sidebarWidth"), 180, 480, 222),
    inspectorWidth: number(own(source, "inspectorWidth"), 180, 480, 292),
    patternHeight: number(own(source, "patternHeight"), 146, 700, 188),
    resultsHeight: number(own(source, "resultsHeight"), 180, 900, 292),
    showSidebar: boolean(own(source, "showSidebar"), true),
    showInspector: boolean(own(source, "showInspector"), true),
    dock: { zones, active },
  };
}

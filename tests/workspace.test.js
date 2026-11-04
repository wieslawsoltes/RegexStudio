import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkspaceState,
  normalizePanelLayout,
} from "../src/state/workspace.js";
import {
  createProject,
  serializeProject,
  deserializeProject,
} from "../src/state/projects.js";

const allPanels = [
  "matches",
  "compare",
  "steps",
  "graph",
  "code",
  "tests",
  "explain",
  "build",
  "reference",
];

test("missing or incorrectly typed optional workspace/layout data gets usable defaults", () => {
  const workspace = {
    inputMode: "matches",
    inputOperation: "matches",
    codeStyle: "runtime",
    autoRun: true,
    timeoutMs: 250,
    maxMatches: 5000,
    maxSteps: 10000,
    culture: "",
    sidebarMode: "patterns",
    tests: [],
    completedLessons: {},
  };
  const layout = {
    sidebarWidth: 222,
    inspectorWidth: 292,
    patternHeight: 188,
    resultsHeight: 292,
    showSidebar: true,
    showInspector: true,
    dock: {
      zones: {
        bottom: ["matches", "compare", "steps", "graph", "code", "tests"],
        right: ["explain", "build", "reference"],
      },
      active: { bottom: "matches", right: "explain" },
    },
  };
  for (const invalid of [undefined, null, false, 42, "invalid", []]) {
    assert.deepEqual(normalizeWorkspaceState(invalid), workspace);
    assert.deepEqual(normalizePanelLayout(invalid), layout);
  }
});

test("an imported project with malformed engine/UI state is repaired without losing valid metadata", () => {
  const imported = JSON.parse(`{
    "inputMode":"<script>","inputOperation":{},"codeStyle":"eval","autoRun":"false",
    "timeoutMs":-99,"maxMatches":999999,"maxSteps":2,"culture":" tr-TR ","sidebarMode":[],
    "tests":[null,{},42,{"id":"same","input":"Ada","shouldMatch":false},{"id":"same","input":"Grace","shouldMatch":true},{"id":"__proto__","input":"safe"},{"id":"wrong","input":{}},{"input":""}],
    "completedLessons":{"first-match":true,"unfinished":false,"truthy":"true","__proto__":true,"constructor":true},
    "__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},
    "custom":{"zoom":1.25,"tabs":["guide",null,true],"__proto__":{"polluted":true}}
  }`);
  const workspace = normalizeWorkspaceState(imported);
  assert.equal(workspace.inputMode, "matches");
  assert.equal(workspace.inputOperation, "matches");
  assert.equal(workspace.codeStyle, "runtime");
  assert.equal(workspace.autoRun, true);
  assert.equal(workspace.timeoutMs, 1);
  assert.equal(workspace.maxMatches, 100000);
  assert.equal(workspace.maxSteps, 100);
  assert.equal(workspace.culture, "tr-TR");
  assert.equal(workspace.sidebarMode, "patterns");
  assert.equal(workspace.tests.length, 4);
  assert.deepEqual(
    workspace.tests.map((item) => item.input),
    ["Ada", "Grace", "safe", ""],
  );
  assert.equal(workspace.tests[0].shouldMatch, false);
  assert.equal(new Set(workspace.tests.map((item) => item.id)).size, 4);
  assert.equal(
    workspace.tests.some((item) => item.id === "__proto__"),
    false,
  );
  assert.deepEqual(workspace.completedLessons, { "first-match": true });
  assert.deepEqual(workspace.custom, {
    zoom: 1.25,
    tabs: ["guide", null, true],
  });
  assert.equal(Object.hasOwn(workspace, "__proto__"), false);
  assert.equal(Object.hasOwn(workspace, "constructor"), false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(normalizeWorkspaceState(workspace), workspace);
});

test("workspace numbers stay finite and integral, and invalid types cannot become engine limits", () => {
  const workspace = normalizeWorkspaceState({
    timeoutMs: Infinity,
    maxMatches: NaN,
    maxSteps: "100000",
    culture: "x".repeat(101),
    autoRun: false,
  });
  assert.equal(workspace.timeoutMs, 250);
  assert.equal(workspace.maxMatches, 5000);
  assert.equal(workspace.maxSteps, 10000);
  assert.equal(workspace.culture.length, 100);
  assert.equal(workspace.autoRun, false);
  const rounded = normalizeWorkspaceState({
    timeoutMs: 99999,
    maxMatches: 10.6,
    maxSteps: 100.2,
  });
  assert.equal(rounded.timeoutMs, 10000);
  assert.equal(rounded.maxMatches, 11);
  assert.equal(rounded.maxSteps, 100);
});

test("normalizing data does not invoke getters, toJSON hooks or retain executable/cyclic metadata", () => {
  const accessed = [];
  const value = {
    custom: {
      valid: 1,
      action() {
        accessed.push("action");
      },
      toJSON() {
        accessed.push("toJSON");
        return {};
      },
    },
  };
  Object.defineProperty(value, "inputMode", {
    enumerable: true,
    get() {
      accessed.push("inputMode");
      return "edit";
    },
  });
  Object.defineProperty(value.custom, "secret", {
    enumerable: true,
    get() {
      accessed.push("secret");
      return "value";
    },
  });
  value.custom.cycle = value.custom;
  value.notJson = new Date("2026-01-01");
  value.infinite = Infinity;
  value.symbol = Symbol("metadata");
  const result = normalizeWorkspaceState(value);
  assert.equal(result.inputMode, "matches");
  assert.deepEqual(result.custom, { valid: 1 });
  assert.equal(Object.hasOwn(result, "notJson"), false);
  assert.equal(Object.hasOwn(result, "infinite"), false);
  assert.equal(Object.hasOwn(result, "symbol"), false);
  assert.deepEqual(accessed, []);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("layout repairs invalid panel IDs, duplicate locations, dimensions and active tabs", () => {
  const layout = normalizePanelLayout(
    JSON.parse(`{
    "sidebarWidth":"480px;display:none","inspectorWidth":99999,"patternHeight":-5,"resultsHeight":2000,
    "showSidebar":false,"showInspector":"false",
    "dock":{"zones":{"bottom":["code","code",null,"<script>","__proto__","explain"],"right":["code","build","reference",42],"outside":["matches"]},"active":{"bottom":"missing","right":"code"}},
    "custom":{"density":"compact"}
  }`),
  );
  assert.equal(layout.sidebarWidth, 222);
  assert.equal(layout.inspectorWidth, 480);
  assert.equal(layout.patternHeight, 146);
  assert.equal(layout.resultsHeight, 900);
  assert.equal(layout.showSidebar, false);
  assert.equal(layout.showInspector, true);
  assert.deepEqual(layout.dock.zones.bottom, [
    "code",
    "explain",
    "matches",
    "compare",
    "steps",
    "graph",
    "tests",
  ]);
  assert.deepEqual(layout.dock.zones.right, ["build", "reference"]);
  assert.deepEqual(layout.dock.active, { bottom: "code", right: "build" });
  assert.deepEqual(
    [...layout.dock.zones.bottom, ...layout.dock.zones.right].sort(),
    [...allPanels].sort(),
  );
  assert.deepEqual(layout.custom, { density: "compact" });
});

test("a valid moved-tab workspace survives project export/import with an intentionally empty dock", () => {
  for (const destination of ["bottom", "right"]) {
    const other = destination === "bottom" ? "right" : "bottom";
    const layout = {
      sidebarWidth: 245.5,
      inspectorWidth: 310,
      patternHeight: 221,
      resultsHeight: 420,
      showSidebar: false,
      showInspector: true,
      dock: {
        zones: { [destination]: [...allPanels].reverse(), [other]: [] },
        active: { [destination]: "steps", [other]: null },
      },
    };
    const workspace = {
      inputMode: "edit",
      inputOperation: "replace",
      codeStyle: "generated",
      autoRun: false,
      timeoutMs: 900,
      maxMatches: 12000,
      maxSteps: 4000,
      culture: "pl-PL",
      sidebarMode: "data",
      tests: [
        {
          id: "edge-case",
          input: "data\nwith a line break",
          shouldMatch: false,
        },
      ],
      completedLessons: { "named-captures": true },
      futurePreference: { highlightWhitespace: true },
    };
    const exported = serializeProject(
      createProject({ name: "Moved panels", layout, workspace }),
    );
    const imported = deserializeProject(exported);
    assert.deepEqual(normalizePanelLayout(imported.layout), layout);
    assert.deepEqual(normalizeWorkspaceState(imported.workspace), workspace);
    assert.deepEqual(
      normalizePanelLayout(normalizePanelLayout(layout)),
      layout,
    );
  }
});

test("partial or damaged dock zones recover all tools exactly once without mutating the input", () => {
  const source = {
    dock: {
      zones: { bottom: "matches", right: ["steps", "graph"] },
      active: { right: "graph" },
    },
  };
  const original = JSON.stringify(source);
  const result = normalizePanelLayout(source);
  assert.deepEqual(result.dock.zones.bottom, [
    "matches",
    "compare",
    "code",
    "tests",
  ]);
  assert.deepEqual(result.dock.zones.right, [
    "steps",
    "graph",
    "explain",
    "build",
    "reference",
  ]);
  assert.equal(result.dock.active.right, "graph");
  result.dock.zones.right.push("sentinel");
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(
    normalizePanelLayout({ dock: { zones: null, active: [] } }).dock.zones
      .bottom,
    ["matches", "compare", "steps", "graph", "code", "tests"],
  );
});

import { icon } from "./ui/icons.js";
import {
  escapeHtml as h,
  el,
  els,
  debounce,
  preserveFocus,
  formatBytes,
  highlightText,
  copyText,
  downloadText,
} from "./ui/dom.js";
import { DockLayout, PanelDock } from "./ui/dock.js";
import { panelMeta, renderPanel, emptyState } from "./ui/panels.js";
import { RegexEngine } from "./engine/client.js";
import { analyzePattern } from "./regex/analyze.js";
import { generateCSharp, generateCsproj } from "./regex/codegen.js";
import { renderRailroad } from "./regex/diagram.js";
import {
  examples,
  lessons,
  builderBlocks,
  buildPattern,
  evaluateLesson,
} from "./regex/learning.js";
import {
  parseData,
  selectData,
  getDataColumns,
  fetchData,
  exportXlsx,
  exportWorkbook,
  downloadFile,
} from "./data/index.js";
import {
  normalizeWorkspaceState,
  normalizePanelLayout,
} from "./state/workspace.js";
import {
  createProject,
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  serializeProject,
  deserializeProject,
  saveDataset,
  listDatasets,
  loadDataset,
  deleteDataset,
} from "./state/projects.js";
const COLORS = [
  "#167d6d",
  "#7961c6",
  "#cb7c37",
  "#427ec6",
  "#c15479",
  "#759331",
];
const uid = () => crypto.randomUUID();
const sampleText =
  "Product team · contact directory\n──────────────────────────────────────\nAlex Chen      alex.chen@studio.design\nSara Miller    sara+work@example.com\nNoah Williams  noah@northstar.io\nEmma Davis     emma.davis@studio.design\n\nA few edge cases to explore\nhello@localhost\nnot-an-email\nname@example.travel\n";
const initialPatterns = [
  {
    id: uid(),
    name: "Email addresses",
    pattern: "(?<name>[\\w.+-]+)@(?<domain>[\\w.-]+\\.[A-Za-z]{2,})",
    color: COLORS[0],
    options: 0,
    enabled: true,
    replacement: "${name} at ${domain}",
  },
  {
    id: uid(),
    name: "Just the domain",
    pattern: "(?<=@)[\\w.-]+\\.[A-Za-z]{2,}",
    color: COLORS[1],
    options: 0,
    enabled: true,
    replacement: "",
  },
  {
    id: uid(),
    name: "Studio teammates",
    pattern: "[\\w.+-]+@studio\\.design",
    color: COLORS[2],
    options: 1,
    enabled: true,
    replacement: "",
  },
];
const initialDataset = {
  id: uid(),
  name: "team-contacts.txt",
  format: "text",
  text: sampleText,
  columns: [],
  rows: [],
  warnings: [],
};
let project = {
  id: uid(),
  name: "Exploring email patterns",
  version: 1,
  patterns: initialPatterns,
  datasets: [initialDataset],
  activePatternId: initialPatterns[0].id,
  activeDatasetId: initialDataset.id,
  layout: {},
  workspace: {
    tests: [
      { id: uid(), input: "hello@example.com", shouldMatch: true },
      { id: uid(), input: "not-an-email", shouldMatch: false },
      { id: uid(), input: "sara+work@example.com", shouldMatch: true },
    ],
  },
};
let results = {},
  testResults = {},
  trace = null,
  traceIndex = 0,
  playing = false,
  playSpeed = 250,
  playTimer = null,
  runGeneration = 0,
  traceGeneration = 0,
  testGeneration = 0,
  stateRevision = 0,
  tracing = false,
  busy = false,
  selectedMatch = 0,
  analysis = null,
  sidebarMode = "patterns",
  inputMode = "matches",
  inputOperation = "matches",
  codeStyle = "runtime",
  graphZoom = 1,
  builderSearch = "",
  patternCaret = { start: 0, end: 0 },
  autoRun = true,
  showReplace = false,
  selectedTokenId = null,
  sourceController = null,
  uiController = null,
  switchingProject = false,
  saved = true,
  projects = [],
  savedDatasets = [],
  lesson = null,
  runCount = 0;
let maxMatches = 5000,
  timeoutMs = 250,
  maxSteps = 10000,
  culture = "",
  panelDock,
  dock,
  theme = "light";
const engine = new RegexEngine();
const pat = () =>
  project.patterns.find((p) => p.id === project.activePatternId) ||
  project.patterns[0];
const data = () =>
  project.datasets.find((d) => d.id === project.activeDatasetId) ||
  project.datasets[0];
const input = () => data()?.text || "";
const request = (p = pat(), text = input()) => ({
  pattern: p.pattern,
  input: text,
  options: p.options || 0,
  timeoutMs,
  culture,
  replacement: p.replacement || "",
  maxMatches,
  maxSteps,
  operation: inputOperation,
});
const activeResult = () => results[pat()?.id];
function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.setAttribute("role", "status");
  node.innerHTML = `${icon(type === "error" ? "alert" : type === "success" ? "check" : "info", 17)}<span>${h(message)}</span>`;
  el("#toasts").append(node);
  setTimeout(() => node.remove(), 5000);
}
function synchronizeProject() {
  project.workspace = {
    ...project.workspace,
    inputMode,
    inputOperation,
    codeStyle,
    autoRun,
    timeoutMs,
    maxMatches,
    maxSteps,
    culture,
    sidebarMode,
  };
  project.layout = { ...dock?.layout, dock: panelDock?.snapshot() };
  return project;
}
let saveQueue = Promise.resolve();
function persistCurrent() {
  const target = synchronizeProject(),
    snapshot = structuredClone(target),
    revision = stateRevision;
  const operation = saveQueue.then(async () => {
    const record = await saveProject(snapshot);
    target.createdAt = record.createdAt;
    target.updatedAt = record.updatedAt;
    if (project === target) {
      try {
        localStorage.setItem("regexstudio.last-project", target.id);
      } catch {}
      if (revision === stateRevision) saved = true;
      renderStatus();
    }
    return record;
  });
  saveQueue = operation.catch(() => {});
  return operation;
}
const autosave = debounce(async () => {
  try {
    await persistCurrent();
    projects = await listProjects();
    if (sidebarMode === "projects") renderSidebar();
  } catch (e) {
    saved = false;
    renderStatus();
    toast(`Could not save in this browser: ${e.message}`, "error");
  }
}, 650);
function changed({ invalidate = true } = {}) {
  stateRevision++;
  saved = false;
  if (invalidate) {
    runGeneration++;
    testGeneration++;
    busy = false;
    results = {};
    testResults = {};
    invalidateTrace();
  }
  renderStatus();
  autosave();
}
function invalidateTrace() {
  traceGeneration++;
  trace = null;
  tracing = false;
  stopPlaying();
}
const queueRun = debounce(() => {
  if (autoRun && engine.ready && input().length <= 1000000)
    runAll({ automatic: true });
}, 420);
function context() {
  return {
    project,
    pattern: pat(),
    patterns: project.patterns,
    input: input(),
    result: activeResult(),
    results,
    analysis,
    selectedMatch,
    busy,
    trace,
    traceIndex,
    tracing,
    playing,
    playSpeed,
    engineReady: engine.ready,
    request: request(),
    codeStyle,
    graphZoom,
    builderSearch,
    selectedTokenId,
    tests: project.workspace.tests || [],
    testResults,
    completedLessons: project.workspace.completedLessons || {},
  };
}
function syntax(pattern) {
  const tokens = (analysis?.tokens || [])
    .filter((t) => t.end > t.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "",
    pos = 0;
  for (const t of tokens) {
    if (t.start < pos) continue;
    out += h(pattern.slice(pos, t.start));
    out += `<span class="syntax-${h(t.kind || t.type || "literal")}">${h(pattern.slice(t.start, t.end))}</span>`;
    pos = t.end;
  }
  return out + h(pattern.slice(pos)) + "\n";
}
function analyze() {
  try {
    analysis = analyzePattern(pat().pattern, pat().options || 0);
  } catch (e) {
    analysis = {
      tokens: [],
      explanations: [],
      warnings: [e.message],
      summary: "Explore your expression",
    };
  }
}
function shell() {
  el("#app").innerHTML =
    `<header class="app-header"><a class="brand" href="./" aria-label="RegexStudio home"><img src="./public/favicon.svg" alt="" width="30" height="30"><span>Regex<span class="brand-light">Studio</span></span></a><span class="header-divider"></span><button id="project-title" class="project-title" data-action="rename-project" title="Rename project"></button><span id="save-indicator" class="save-indicator"></span><span class="spacer"></span><button class="header-engine" id="engine-indicator" data-action="engine-info"></button><div class="header-actions"><button class="icon-button" data-action="open-projects" title="Open projects (Ctrl+O)" aria-label="Open projects">${icon("folder")}</button><button class="icon-button" data-action="export-project" title="Download project (Ctrl+S)" aria-label="Download project">${icon("save")}</button><button class="icon-button" data-action="theme" title="Switch appearance" aria-label="Switch appearance">${icon("moon")}</button><button class="icon-button" data-action="help" title="Help and keyboard shortcuts" aria-label="Help">${icon("help")}</button><a class="icon-button github-link" href="https://github.com/wieslawsoltes/RegexStudio" target="_blank" rel="noopener" title="View source on GitHub" aria-label="Source on GitHub">${icon("github")}</a></div></header>
 <div class="workspace-toolbar"><div class="workspace-title">${icon("grid", 16)}<span>Playground</span><span class="toolbar-slash">/</span><span class="muted">Understand every match.</span></div><span class="spacer"></span><button class="text-button" data-action="import-data">${icon("upload", 15)}<span>Import data</span></button><button class="text-button" data-action="connect-source">${icon("link", 15)}<span>Connect source</span></button><span class="toolbar-divider"></span><button class="text-button" data-action="layout">${icon("grid", 15)}<span>Layout</span></button><button id="run-button" class="primary-button" data-action="run">${icon("play", 15)} Run all <kbd>⌘ ↵</kbd></button></div>
 <div id="workbench" class="workbench"><nav class="activity-rail" aria-label="Workspace navigation"><button class="rail-button active" data-action="sidebar" data-mode="patterns" title="Patterns" aria-label="Patterns">${icon("code", 21)}</button><button class="rail-button" data-action="sidebar" data-mode="data" title="Data sources" aria-label="Data sources">${icon("data", 21)}</button><button class="rail-button" data-action="sidebar" data-mode="projects" title="Projects" aria-label="Projects">${icon("folder", 21)}</button><span class="rail-line"></span><button class="rail-button" data-action="learn" title="Learn regex" aria-label="Learn regex">${icon("book", 21)}</button><button class="rail-button" data-action="view-compare" title="Compare patterns" aria-label="Compare patterns">${icon("compare", 21)}</button><span class="spacer"></span><button class="rail-button" data-action="options" title="Engine options" aria-label="Engine options">${icon("settings", 21)}</button></nav>
 <aside id="sidebar" class="sidebar"></aside><div class="resize-handle sidebar-resizer" data-resize="sidebarWidth" role="separator" tabindex="0" aria-label="Resize explorer" aria-orientation="vertical"></div>
 <main class="main-workspace"><section id="pattern-panel" class="panel pattern-panel"></section><div class="resize-handle pattern-resizer" data-resize="patternHeight" role="separator" tabindex="0" aria-label="Resize pattern editor" aria-orientation="horizontal"></div><section id="data-panel" class="panel data-panel"></section><div class="resize-handle results-resizer" data-resize="resultsHeight" role="separator" tabindex="0" aria-label="Resize results" aria-orientation="horizontal"></div><section id="bottom-dock" class="panel results-panel" data-dock-zone="bottom"><div class="dock-tabs" id="bottom-tabs"></div><div id="bottom-content" class="dock-content"></div></section></main>
 <div class="resize-handle inspector-resizer" data-resize="inspectorWidth" role="separator" tabindex="0" aria-label="Resize inspector" aria-orientation="vertical"></div><aside id="right-dock" class="panel inspector-panel" data-dock-zone="right"><div class="dock-tabs" id="right-tabs"></div><div id="right-content" class="dock-content"></div></aside></div>
 <footer class="status-bar"><span id="status-engine"></span><span class="footer-divider"></span><span>Private by design · data stays in your browser</span><span class="spacer"></span><span id="status-data"></span><span class="footer-divider"></span><button class="status-button" data-action="help">${icon("keyboard", 13)} Shortcuts</button></footer><div id="toasts" class="toasts" aria-live="polite"></div><dialog id="modal" class="modal"></dialog><input type="file" id="file-input" multiple accept=".txt,.log,.json,.jsonl,.xml,.csv,.tsv,.xlsx,.md,.html" hidden><input type="file" id="project-input" accept=".json,.regexstudio" hidden>`;
  dock = new DockLayout(
    el("#workbench"),
    {
      ...normalizePanelLayout(project.layout),
      ...(innerWidth <= 880 ? { showInspector: false } : {}),
      ...(innerWidth <= 640 ? { showSidebar: false } : {}),
    },
    () => {
      changed({ invalidate: false });
    },
  );
  panelDock = new PanelDock(normalizePanelLayout(project.layout).dock);
  panelDock.bind(el("#workbench"));
  panelDock.addEventListener("change", () => {
    renderDocks();
    changed({ invalidate: false });
  });
  bind();
  renderAll();
}
function renderAll() {
  analyze();
  preserveFocus(() => {
    renderStatus();
    renderSidebar();
    renderPattern();
    renderData();
    renderDocks();
  });
}
function renderStatus() {
  el("#project-title").innerHTML = h(project.name) + icon("down", 13);
  el("#save-indicator").innerHTML = saved
    ? `${icon("check", 12)} Saved in browser`
    : "Saving…";
  el("#engine-indicator").title =
    engine.lastError ||
    engine.loadingDetail ||
    `Actual .NET ${engine.version || "10"} regex engine`;
  el("#engine-indicator").className = `header-engine ${engine.status}`;
  el("#engine-indicator").innerHTML =
    `<span class="status-dot"></span>.NET 10 <span>${engine.ready ? "WebAssembly" : engine.status === "error" ? "Retry engine" : "Loading…"}</span>`;
  el("#status-engine").innerHTML =
    `<span class="status-dot ${engine.status}"></span>${engine.ready ? "Engine ready" : engine.status === "error" ? "Engine unavailable" : engine.loadingDetail || "Starting .NET 10…"}`;
  el("#status-data").textContent =
    `UTF-16 · ${input().length.toLocaleString()} characters · ${input().split("\n").length.toLocaleString()} lines`;
  el("#run-button").innerHTML =
    `${icon(busy ? "stop" : "play", 15)} ${busy ? "Stop" : "Run all"} <kbd>⌘ ↵</kbd>`;
  el("#run-button").disabled = !engine.ready && !busy;
}
function renderSidebar() {
  els(".rail-button[data-mode]").forEach((n) =>
    n.classList.toggle("active", n.dataset.mode === sidebarMode),
  );
  let content = "";
  if (sidebarMode === "patterns")
    content = `<div class="sidebar-heading"><span>EXPLORER</span><button class="icon-button" data-action="new-project" title="New project">${icon("plus", 15)}</button></div><div class="sidebar-project">${icon("folder", 17)}<strong>${h(project.name)}</strong></div><div class="section-label"><span>PATTERNS <b>${project.patterns.length}</b></span><button class="icon-button" data-action="add-pattern" title="Add pattern">${icon("plus", 15)}</button></div><div class="pattern-list">${project.patterns
      .map((p, i) => {
        const r = results[p.id];
        return `<div class="pattern-card ${p.id === project.activePatternId ? "active" : ""} ${p.enabled === false ? "disabled" : ""}" style="--pattern-color:${p.color}"><button class="pattern-select" data-action="select-pattern" data-id="${h(p.id)}"><div><span class="pattern-letter">${String.fromCharCode(65 + (i % 26))}</span><strong>${h(p.name)}</strong><span class="pattern-count ${r?.error ? "error" : ""}">${r?.error ? "!" : r ? (r.matches?.length ?? 0) : "—"}</span></div><code>${h(p.pattern || "Empty pattern")}</code><span class="pattern-subtitle">${r?.error ? "Check expression" : r ? `${r.matches?.length ?? 0} matches · ${Number(r.elapsedMs || 0).toFixed(2)} ms` : "Ready to explore"}</span></button><label class="pattern-enabled" title="Include in comparison"><input type="checkbox" data-pattern-enabled="${h(p.id)}" ${p.enabled !== false ? "checked" : ""}><span></span></label></div>`;
      })
      .join(
        "",
      )}</div><button class="add-pattern-button" data-action="add-pattern">${icon("plus", 15)} Add another pattern</button><div class="section-label data-section-label"><span>TEST DATA <b>${project.datasets.length}</b></span><button class="icon-button" data-action="import-data" title="Import data">${icon("plus", 15)}</button></div>${project.datasets.map((d) => `<button class="dataset-row ${d.id === project.activeDatasetId ? "active" : ""}" data-action="select-dataset" data-id="${h(d.id)}">${icon("file", 16)}<span>${h(d.name)}</span><small>${d.format.toUpperCase()}</small></button>`).join("")}<div class="sidebar-bottom"><div class="tip-card"><span class="tip-icon">${icon("spark", 16)}</span><strong>A little regex, a lot of possibility.</strong><p>Compare patterns, inspect captures, or see every step.</p><button data-action="learn">Explore the field guide ${icon("arrow", 14)}</button></div><button class="local-projects" data-action="open-projects">${icon("folder", 15)} All projects <span>${projects.length}</span></button></div>`;
  if (sidebarMode === "data")
    content = `<div class="sidebar-heading"><span>DATA SOURCES</span><button class="icon-button" data-action="import-data" title="Import data">${icon("plus", 15)}</button></div><div class="sidebar-intro">Bring real data into your playground.</div><div class="source-actions"><button class="secondary-button" data-action="import-data">${icon("upload", 15)} Import files</button><button class="secondary-button" data-action="connect-source">${icon("link", 15)} Connect URL</button><button class="text-button" data-action="new-dataset">${icon("plus", 15)} Empty text</button></div><div class="section-label"><span>IN THIS PROJECT</span></div>${project.datasets.map((d) => `<div class="data-source-card ${d.id === project.activeDatasetId ? "active" : ""}"><button data-action="select-dataset" data-id="${h(d.id)}">${icon("file", 18)}<strong>${h(d.name)}</strong><span>${d.format.toUpperCase()} · ${formatBytes((d.text || "").length)}</span></button><div><button class="text-button" data-action="save-dataset" data-id="${h(d.id)}" title="Save to reusable dataset library">Save dataset</button><button class="icon-button" data-action="delete-dataset" data-id="${h(d.id)}" title="Remove from project">${icon("trash", 13)}</button></div></div>`).join("")}<div class="section-label"><span>SAVED DATASETS</span></div>${savedDatasets.map((d) => `<button class="dataset-row" data-action="load-dataset" data-id="${h(d.id)}">${icon("data", 15)}<span>${h(d.name)}</span></button>`).join("") || '<p class="sidebar-empty">Save any dataset to reuse it in another project.</p>'}<div class="sidebar-bottom"><div class="supported-formats"><span>MADE FOR YOUR DATA</span><div>TXT <i>JSON</i> XML <i>CSV</i> XLSX</div><p>Files stay on this device. Online sources connect directly from your browser.</p></div></div>`;
  if (sidebarMode === "projects")
    content = `<div class="sidebar-heading"><span>YOUR PROJECTS</span><button class="icon-button" data-action="new-project" title="New project">${icon("plus", 15)}</button></div><div class="source-actions"><button class="secondary-button" data-action="new-project">${icon("plus", 15)} New project</button><button class="text-button" data-action="import-project">${icon("upload", 15)} Open project file</button></div><div class="section-label"><span>SAVED IN THIS BROWSER</span></div>${projects.map((p) => `<div class="saved-project ${p.id === project.id ? "active" : ""}"><button data-action="load-project" data-id="${h(p.id)}">${icon("folder", 19)}<strong>${h(p.name)}</strong><span>${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : ""}</span></button><button class="icon-button" data-action="delete-project" data-id="${h(p.id)}" title="Delete saved project">${icon("trash", 14)}</button></div>`).join("") || '<p class="sidebar-empty">Your first project will appear here as you work.</p>'}<div class="sidebar-bottom"><div class="tip-card"><strong>Your workspace travels with you.</strong><p>Download a project to keep a backup or continue in another browser.</p><button data-action="export-project">Download this project ${icon("download", 14)}</button></div></div>`;
  el("#sidebar").innerHTML = content;
}
function renderPattern() {
  const p = pat();
  el("#pattern-panel").innerHTML =
    `<div class="panel-heading"><span class="section-number">01</span><span class="panel-title">PATTERN</span><span class="panel-name"><span class="color-dot" style="background:${p.color}"></span><input id="pattern-name" value="${h(p.name)}" aria-label="Pattern name"></span><span class="spacer"></span><button class="icon-button" data-action="duplicate-pattern" title="Duplicate pattern" aria-label="Duplicate pattern">${icon("copy", 15)}</button><button class="icon-button" data-action="delete-pattern" title="Delete pattern" aria-label="Delete pattern">${icon("trash", 15)}</button></div><div class="pattern-editor-wrap"><span class="pattern-gutter">1</span><div class="pattern-editor-stack"><pre id="pattern-highlight" aria-hidden="true">${syntax(p.pattern)}</pre><textarea id="pattern-editor" aria-label="Regular expression" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" placeholder="Type a regex, or build one with the blocks →">${h(p.pattern)}</textarea></div><span class="engine-chip">.NET</span></div><div class="pattern-options"><div class="flag-buttons">${[
      { v: 1, t: "i", label: "Ignore case" },
      { v: 2, t: "m", label: "Multiline anchors" },
      { v: 16, t: "s", label: "Dot matches newline" },
      { v: 32, t: "x", label: "Ignore pattern whitespace" },
    ]
      .map(
        (f) =>
          `<button class="flag ${p.options & f.v ? "active" : ""}" data-action="flag" data-value="${f.v}" title="${f.label}" aria-pressed="${!!(p.options & f.v)}">${f.t}</button>`,
      )
      .join(
        "",
      )}<button class="text-button options-button" data-action="options">Options ${icon("down", 12)}</button></div><span class="pattern-validation ${activeResult()?.error ? "invalid" : ""}">${activeResult()?.error ? icon("alert", 13) + "Check expression" : activeResult() ? icon("check", 13) + "Valid expression" : "Paste a pattern or start building"}</span><span class="spacer"></span><label class="auto-run"><input type="checkbox" id="auto-run" ${autoRun ? "checked" : ""}><span></span>Live</label></div>`;
}
function renderPatternValidation() {
  const node = el(".pattern-validation");
  if (!node) return;
  node.classList.toggle("invalid", !!activeResult()?.error);
  node.innerHTML = activeResult()?.error
    ? icon("alert", 13) + "Check expression"
    : activeResult()
      ? icon("check", 13) + "Valid expression"
      : "Paste a pattern or start building";
}
function renderDataResults() {
  if (inputMode !== "edit") {
    renderData();
    return;
  }
  const summary = el(".match-summary");
  if (summary)
    summary.innerHTML = `<i style="background:${pat().color}"></i><b>${activeResult()?.matches?.length ?? "—"}</b> matches <span>·</span> ${h(pat().name)}`;
}
function renderData() {
  const d = data();
  el("#data-panel").innerHTML =
    `<div class="panel-heading"><span class="section-number">02</span><span class="panel-title">TEST DATA</span><span class="panel-name data-name">${icon("file", 14)}${h(d.name)}</span><span class="spacer"></span><div class="segmented data-view-switch"><button class="segment ${inputMode === "matches" ? "active" : ""}" data-action="input-mode" data-mode="matches">Highlights</button><button class="segment ${inputMode === "edit" ? "active" : ""}" data-action="input-mode" data-mode="edit">Edit data</button></div><button class="icon-button" data-action="data-tools" title="Select fields and format data" aria-label="Data tools">${icon("settings", 15)}</button><button class="icon-button" data-action="download-data" title="Download dataset" aria-label="Download dataset">${icon("download", 15)}</button></div><div class="data-content">${
      inputMode === "edit"
        ? `<div class="line-numbers" aria-hidden="true">${input()
            .split("\n")
            .slice(0, 5000)
            .map((_, i) => i + 1)
            .join(
              "\n",
            )}</div><textarea id="data-editor" aria-label="Test data" spellcheck="false" autocapitalize="off" wrap="off">${h(input())}</textarea>`
        : `<div class="line-numbers" aria-hidden="true">${input()
            .slice(0, 180000)
            .split("\n")
            .slice(0, 5000)
            .map((_, i) => i + 1)
            .join(
              "\n",
            )}</div><pre id="data-highlights" tabindex="0" aria-label="Test data with matches highlighted">${highlightText(input(), activeResult()?.matches || [], { selected: selectedMatch, color: pat().color })}</pre>`
    }</div>${showReplace ? `<div class="replacement-box"><label for="replacement-input">Replace with</label><input id="replacement-input" class="mono" value="${h(pat().replacement || "")}" placeholder="Use $1 or \${groupName}"><button class="primary-button small" data-action="run-replace">Preview</button><button class="icon-button" data-action="toggle-replace" title="Close replacement">${icon("close", 14)}</button></div>${activeResult()?.replacement !== undefined ? `<div class="replacement-preview"><div><span>REPLACEMENT PREVIEW</span><button class="text-button" data-action="copy-replacement">${icon("copy", 13)} Copy</button></div><pre>${h(activeResult().replacement)}</pre></div>` : ""}` : ""}<div class="data-footer"><span class="match-summary"><i style="background:${pat().color}"></i><b>${activeResult()?.matches?.length ?? "—"}</b> matches <span>·</span> ${h(pat().name)}</span><span class="spacer"></span><button class="text-button ${showReplace ? "active" : ""}" data-action="toggle-replace">Replace</button><button class="text-button" data-action="run-split">Split</button><span class="data-format">${h(d.format.toUpperCase())}</span></div>`;
  if (lesson) {
    el("#data-panel").insertAdjacentHTML(
      "afterbegin",
      `<div class="lesson-banner"><span>${icon("book", 16)}<b>${h(lesson.title)}</b> ${h(lesson.challenge || lesson.description)}</span><button class="text-button" data-action="check-lesson">Check answer</button><button class="text-button" data-action="lesson-hint">Hint</button><button class="text-button" data-action="lesson-solution">Solution</button><button class="icon-button" data-action="close-lesson" title="Close lesson">${icon("close", 14)}</button></div>`,
    );
  }
}
function renderDocks() {
  const c = context();
  for (const zone of ["bottom", "right"]) {
    const tabs = panelDock.zones[zone];
    el(`#${zone}-tabs`).innerHTML =
      tabs
        .map(
          (id) =>
            `<button class="dock-tab ${panelDock.active[zone] === id ? "active" : ""}" draggable="true" data-dock-tab="${id}" data-action="dock-select" data-zone="${zone}" data-panel="${id}" role="tab" aria-selected="${panelDock.active[zone] === id}">${icon(panelMeta[id].icon, 15)}<span>${panelMeta[id].title}</span>${id === "matches" && activeResult() ? `<b>${activeResult()?.matches?.length || 0}</b>` : ""}</button>`,
        )
        .join("") +
      `<span class="spacer"></span><button class="dock-menu icon-button" data-action="dock-menu" data-zone="${zone}" title="Panel options and docking" aria-label="Panel options">${icon("more", 15)}</button>`;
    el(`#${zone}-content`).innerHTML = panelDock.active[zone]
      ? renderPanel(panelDock.active[zone], c)
      : emptyState(
          "grid",
          "Dock a panel here",
          "Drag a panel tab into this area.",
        );
  }
}
function showPanel(id) {
  const zone =
    Object.keys(panelDock.zones).find((z) => panelDock.zones[z].includes(id)) ||
    "bottom";
  if (zone === "right" && !dock.layout.showInspector) dock.toggle("inspector");
  panelDock.select(zone, id);
}
async function runAll({ automatic = false } = {}) {
  queueRun.cancel();
  if (busy) {
    if (automatic) return;
    engine.cancel();
    return;
  }
  if (!engine.ready) {
    toast("The .NET engine is still loading.");
    return;
  }
  const generation = ++runGeneration;
  runCount++;
  busy = true;
  selectedMatch = 0;
  renderStatus();
  try {
    for (const p of project.patterns.filter((p) => p.enabled !== false)) {
      const result = await engine.run({ ...request(p), operation: "matches" });
      if (generation !== runGeneration) return;
      engine.version = result.version || engine.version;
      results[p.id] = result;
      renderSidebar();
      if (p.id === pat().id) {
        preserveFocus(() => {
          renderDataResults();
          renderDocks();
        });
      }
    }
  } catch (e) {
    if (e.name !== "AbortError" && generation === runGeneration)
      toast(e.message, "error");
  } finally {
    if (generation === runGeneration) {
      busy = false;
      renderStatus();
      preserveFocus(() => {
        renderPatternValidation();
        renderDocks();
      });
    }
  }
}
async function runSingle(operation) {
  queueRun.cancel();
  inputOperation = operation;
  if (!engine.ready) return toast("Wait for the .NET engine to load.");
  const generation = runGeneration,
    patternId = pat().id,
    projectId = project.id,
    snapshot = request();
  const current = () =>
    generation === runGeneration &&
    project.id === projectId &&
    pat().id === patternId &&
    inputOperation === snapshot.operation &&
    (pat().replacement || "") === snapshot.replacement;
  try {
    const result = await engine.run(snapshot);
    if (!current()) return;
    results[patternId] = result;
    preserveFocus(() => {
      renderData();
      renderDocks();
      renderSidebar();
    });
    if (operation === "split") {
      if (result.error)
        toast(
          typeof result.error === "string"
            ? result.error
            : result.error.message,
          "error",
        );
      else
        openModal(
          "Split result",
          `<p class="modal-description">${result.splits?.length ?? 0} pieces returned by .NET Regex.Split.</p><pre class="modal-code">${h(JSON.stringify(result.splits || [], null, 2))}</pre>`,
          [{ text: "Download JSON", action: "download-split", primary: true }],
        );
    }
  } catch (e) {
    if (current()) toast(e.message, "error");
  }
  if (current()) autosave();
}
async function recordTrace() {
  queueRun.cancel();
  if (!engine.ready) return;
  stopPlaying();
  const generation = ++traceGeneration;
  tracing = true;
  trace = null;
  showPanel("steps");
  try {
    const response = await engine.trace({ ...request(), operation: "matches" });
    if (generation !== traceGeneration) return;
    trace = response;
    traceIndex = 0;
  } catch (e) {
    if (generation === traceGeneration) trace = { error: e.message };
  } finally {
    if (generation === traceGeneration) {
      tracing = false;
      renderDocks();
    }
  }
}
function stopPlaying() {
  playing = false;
  clearTimeout(playTimer);
}
function playStep() {
  if (!playing) return;
  traceIndex = Math.min((trace?.events?.length || 1) - 1, traceIndex + 1);
  if (traceIndex >= (trace?.events?.length || 1) - 1) playing = false;
  renderTraceView();
  if (playing) playTimer = setTimeout(playStep, playSpeed);
}
function stepTo(index) {
  stopPlaying();
  traceIndex = Math.max(0, Math.min((trace?.events?.length || 1) - 1, index));
  renderTraceView();
}
function insertPattern(text) {
  const p = pat(),
    start = patternCaret.start,
    end = patternCaret.end;
  p.pattern = p.pattern.slice(0, start) + text + p.pattern.slice(end);
  patternCaret = { start: start + text.length, end: start + text.length };
  changed();
  analyze();
  renderPattern();
  renderDocks();
  const editor = el("#pattern-editor");
  editor.focus();
  editor.setSelectionRange(patternCaret.start, patternCaret.end);
  queueRun();
}
function addPattern(preset = {}) {
  const p = {
    id: uid(),
    name: `Pattern ${project.patterns.length + 1}`,
    pattern: "",
    color: COLORS[project.patterns.length % COLORS.length],
    options: 0,
    enabled: true,
    replacement: "",
    ...preset,
  };
  project.patterns.push(p);
  project.activePatternId = p.id;
  changed();
  renderAll();
  el("#pattern-editor").focus();
}
function activatePattern(id) {
  if (!project.patterns.some((p) => p.id === id)) return;
  project.activePatternId = id;
  testGeneration++;
  testResults = {};
  selectedMatch = 0;
  invalidateTrace();
  changed({ invalidate: false });
  renderAll();
}
async function importFiles(files) {
  const projectId = project.id;
  for (const file of files) {
    try {
      const d = await parseData(file);
      if (project.id !== projectId || switchingProject) return;
      d.id ||= uid();
      project.datasets.push(d);
      project.activeDatasetId = d.id;
      toast(
        `Imported ${d.name}${d.sheets?.length ? ` · ${d.sheets.length} worksheets` : ""}`,
        "success",
      );
      if (d.warnings?.length) toast(d.warnings.join(" "));
    } catch (e) {
      toast(`${file.name}: ${e.message}`, "error");
    }
  }
  inputMode = "matches";
  changed();
  renderAll();
  queueRun();
  if (
    data().columns?.length ||
    data().format === "xml" ||
    ["json", "jsonl"].includes(data().format)
  )
    openDataTools();
}
function openModal(title, body, actions = []) {
  sourceController?.abort();
  sourceController = null;
  const modal = el("#modal");
  modal.innerHTML = `<div class="modal-heading"><h2>${h(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon("close", 19)}</button></div><div class="modal-body">${body}</div>${actions.length ? `<div class="modal-actions"><button class="secondary-button" data-action="close-modal">Cancel</button>${actions.map((a) => `<button class="${a.primary ? "primary" : "secondary"}-button" data-action="${a.action}">${h(a.text)}</button>`).join("")}</div>` : ""}`;
  if (!modal.open) modal.showModal();
}
function closeModal() {
  sourceController?.abort();
  sourceController = null;
  el("#modal").close();
}
function openDataTools() {
  const d = data(),
    columns = getDataColumns(d);
  openModal(
    "Prepare your data",
    `<p class="modal-description">Choose exactly what your patterns should see. The original imported data is retained.</p><label class="field-label">Dataset name<input id="dataset-name" value="${h(d.name)}"></label>${d.sheets?.length ? `<label class="field-label">Worksheet<select id="dataset-sheet">${d.sheets.map((s, i) => `<option value="${i}" ${d.selection?.sheet === i ? "selected" : ""}>${h(s.name)}</option>`).join("")}</select></label>` : ""}${columns?.length ? `<label class="field-label">Column<select id="dataset-column"><option value="">All columns</option>${columns.map((col, i) => `<option value="${i}" ${d.selection?.column === i ? "selected" : ""}>${h(col || `Column ${i + 1}`)}</option>`).join("")}</select></label>` : ""}${["json", "jsonl"].includes(d.format) ? `<label class="field-label">JSON Pointer <span>Optional · wildcard supported</span><input id="dataset-path" value="${h(d.selection?.path || "")}" placeholder="/users/*/email"></label>` : ""}${d.format === "xml" ? `<label class="field-label">XPath <span>Optional</span><input id="dataset-xpath" value="${h(d.selection?.xpath || "")}" placeholder="//email/text()"></label>` : ""}<div class="data-info-grid"><div><small>Format</small><strong>${h(d.format.toUpperCase())}</strong></div><div><small>Characters</small><strong>${d.text.length.toLocaleString()}</strong></div><div><small>Rows</small><strong>${d.rows?.length || "—"}</strong></div></div>${d.warnings?.length ? `<div class="warning-card">${h(d.warnings.join(" "))}</div>` : ""}<p class="modal-note">Switch to “Edit data” to work directly with text. Selecting a field replaces the current playground input with that field’s values.</p>`,
    [{ text: "Apply to playground", action: "apply-data", primary: true }],
  );
}
function openOptions() {
  const p = pat(),
    flags = [
      {
        value: 1,
        title: "Ignore case",
        detail: "Treat uppercase and lowercase as equal.",
      },
      {
        value: 2,
        title: "Multiline",
        detail: "^ and $ match line boundaries.",
      },
      {
        value: 16,
        title: "Singleline",
        detail: "The dot also matches newline characters.",
      },
      {
        value: 32,
        title: "Ignore pattern whitespace",
        detail: "Allow whitespace and # comments outside classes.",
      },
      {
        value: 4,
        title: "Explicit capture",
        detail: "Capture only groups with an explicit name or number.",
      },
      {
        value: 64,
        title: "Right to left",
        detail: "Search from the end of the input.",
      },
      {
        value: 256,
        title: "ECMAScript compatibility",
        detail: "Use the .NET ECMAScript option (not a JavaScript engine).",
      },
      {
        value: 512,
        title: "Culture invariant",
        detail: "Use invariant case matching.",
      },
    ];
  openModal(
    "Matching options",
    `<p class="modal-description">These are the actual .NET RegexOptions. Invalid combinations are reported by .NET.</p><label class="field-label">Engine<select id="engine-choice"><option value="0" ${!(p.options & 1024) ? "selected" : ""}>Backtracking interpreter · step-by-step tracing</option><option value="1024" ${p.options & 1024 ? "selected" : ""}>Non-backtracking · linear-time matching</option></select></label><div class="options-grid">${flags.map((f) => `<label class="option-toggle"><input type="checkbox" data-option="${f.value}" ${p.options & f.value ? "checked" : ""}><span><strong>${f.title}</strong><small>${f.detail}</small></span></label>`).join("")}</div><div class="settings-grid"><label class="field-label">Culture<input id="engine-culture" value="${h(culture)}" placeholder="Invariant (empty), en-US, tr-TR…"></label><label class="field-label">Timeout (ms)<input id="engine-timeout" type="number" min="1" max="10000" value="${timeoutMs}"></label><label class="field-label">Match limit<input id="engine-max-matches" type="number" min="1" max="100000" value="${maxMatches}"></label><label class="field-label">Trace step limit<input id="engine-max-steps" type="number" min="100" max="100000" value="${maxSteps}"></label></div><p class="modal-note">Non-backtracking results use .NET’s symbolic engine; instruction tracing is available for the backtracking interpreter. Timeouts and a separate worker keep the workspace responsive.</p>`,
    [{ text: "Apply options", action: "apply-options", primary: true }],
  );
}
function openSource() {
  openModal(
    "Connect an online source",
    `<p class="modal-description">Load a URL directly into your playground. The source must permit browser requests with CORS.</p><div class="source-samples"><span>Try a sample</span><button class="text-button" data-action="source-sample" data-file="contacts.json">JSON contacts</button><button class="text-button" data-action="source-sample" data-file="orders.csv">CSV orders</button><button class="text-button" data-action="source-sample" data-file="catalog.xml">XML catalog</button></div><label class="field-label">Source URL<input id="source-url" type="url" placeholder="https://api.example.com/data.json" autocomplete="off"></label><div class="settings-grid"><label class="field-label">Format<select id="source-format"><option value="">Detect automatically</option><option value="json">JSON</option><option value="text">Text</option><option value="csv">CSV</option><option value="xml">XML</option><option value="xlsx">Excel (.xlsx)</option></select></label><label class="field-label">Dataset name<input id="source-name" placeholder="Optional name"></label></div><details class="source-headers"><summary>Request headers (optional)</summary><p>Headers are used for this request only and are never saved in projects.</p><textarea id="source-headers" rows="4" spellcheck="false" placeholder='{"Authorization":"Bearer …"}'></textarea></details><div id="source-status" role="status"></div><p class="modal-note">The request goes directly to the source. There is no proxy or server upload. CORS and authentication rules are controlled by that source.</p>`,
    [{ text: "Load data", action: "load-source", primary: true }],
  );
}
async function withWorkspaceTransition(action) {
  if (switchingProject) return;
  switchingProject = true;
  const app = el("#app");
  app.inert = true;
  autosave.cancel();
  queueRun.cancel();
  sourceController?.abort();
  sourceController = null;
  try {
    return await action();
  } finally {
    switchingProject = false;
    app.inert = false;
  }
}
async function loadProjectById(id) {
  try {
    await withWorkspaceTransition(async () => {
      await persistCurrent();
      const loaded = await loadProject(id);
      if (!loaded) throw new Error("Project not found.");
      await applyProject(loaded);
      toast(`Opened ${project.name}`, "success");
    });
  } catch (e) {
    toast(e.message, "error");
  }
}
async function applyProject(loaded) {
  sourceController?.abort();
  sourceController = null;
  queueRun.cancel();
  runGeneration++;
  testGeneration++;
  invalidateTrace();
  project = createProject(loaded);
  project.workspace = normalizeWorkspaceState(project.workspace);
  project.layout = normalizePanelLayout(project.layout);
  project.patterns ||= [];
  project.datasets ||= [];
  if (!project.patterns.length)
    project.patterns = [
      {
        id: uid(),
        name: "Pattern 1",
        pattern: "",
        options: 0,
        color: COLORS[0],
        enabled: true,
        replacement: "",
      },
    ];
  project.patterns.forEach((p, i) => {
    p.color ||= COLORS[i % COLORS.length];
    p.id ||= uid();
  });
  if (!project.datasets.length)
    project.datasets = [
      {
        id: uid(),
        name: "Untitled.txt",
        format: "text",
        text: "",
        rows: [],
        columns: [],
      },
    ];
  project.activePatternId ||= project.patterns[0].id;
  project.activeDatasetId ||= project.datasets[0].id;
  project.workspace ||= {};
  results = {};
  testResults = {};
  selectedMatch = 0;
  busy = false;
  lesson = null;
  const w = project.workspace;
  inputMode = w.inputMode || "matches";
  inputOperation = w.inputOperation || "matches";
  codeStyle = w.codeStyle || "runtime";
  autoRun = w.autoRun !== false;
  timeoutMs = w.timeoutMs || 250;
  maxMatches = w.maxMatches || 5000;
  maxSteps = w.maxSteps || 10000;
  culture = w.culture || "";
  sidebarMode = w.sidebarMode || "patterns";
  shell();
  changed({ invalidate: false });
  if (engine.ready) queueRun();
}
async function runTests() {
  queueRun.cancel();
  const generation = runGeneration,
    testVersion = ++testGeneration,
    patternId = pat().id,
    projectId = project.id,
    snapshot = request(),
    cases = structuredClone(project.workspace.tests || []);
  const current = () =>
    generation === runGeneration &&
    testVersion === testGeneration &&
    project.id === projectId &&
    pat().id === patternId;
  testResults = {};
  for (const t of cases) {
    try {
      const r = await engine.run({
        ...snapshot,
        input: t.input,
        operation: "matches",
        maxMatches: 1,
      });
      if (!current()) return;
      testResults[t.id] = {
        pass: !r.error && !!r.matches?.length === (t.shouldMatch !== false),
        error: r.error
          ? typeof r.error === "string"
            ? r.error
            : r.error.message
          : null,
      };
    } catch (e) {
      if (!current()) return;
      testResults[t.id] = { pass: false, error: e.message };
    }
  }
  if (current()) renderDocks();
}
function renderTraceView() {
  const c = context();
  for (const zone of ["bottom", "right"]) {
    if (panelDock.active[zone] !== "steps") continue;
    const host = el(`#${zone}-content`),
      template = document.createElement("template");
    template.innerHTML = renderPanel("steps", c);
    const fresh = template.content;
    if (
      !host.querySelector(".simulator-toolbar") ||
      !fresh.querySelector(".simulator-toolbar")
    ) {
      host.innerHTML = renderPanel("steps", c);
      continue;
    }
    for (const selector of [".simulator-body", ".panel-note", ".step-count"]) {
      const old = host.querySelector(selector),
        next = fresh.querySelector(selector);
      if (old && next) old.replaceWith(next);
    }
    const slider = host.querySelector("#step-slider");
    if (slider) slider.value = traceIndex;
    const play = host.querySelector('[data-action="step-play"]');
    if (play) play.innerHTML = icon(playing ? "pause" : "play", 16);
  }
}
function bind() {
  uiController?.abort();
  uiController = new AbortController();
  const uiSignal = uiController.signal;
  el("#app").onclick = async (e) => {
    const button = e.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const a = button.dataset.action;
    try {
      switch (a) {
        case "run":
          await runAll();
          break;
        case "sidebar":
          sidebarMode = button.dataset.mode;
          if (!dock.layout.showSidebar) dock.toggle("sidebar");
          renderSidebar();
          autosave();
          break;
        case "learn":
          showPanel("reference");
          break;
        case "view-compare":
          showPanel("compare");
          break;
        case "open-projects":
          sidebarMode = "projects";
          projects = await listProjects();
          if (!dock.layout.showSidebar) dock.toggle("sidebar");
          renderSidebar();
          break;
        case "rename-project":
          openModal(
            "Name your project",
            `<label class="field-label">Project name<input id="rename-value" maxlength="160" value="${h(project.name)}"></label>`,
            [
              {
                text: "Save name",
                action: "apply-project-name",
                primary: true,
              },
            ],
          );
          el("#rename-value").select();
          break;
        case "apply-project-name":
          project.name = el("#rename-value").value.trim() || "Untitled project";
          changed({ invalidate: false });
          closeModal();
          renderStatus();
          renderSidebar();
          break;
        case "new-project":
          openModal(
            "A fresh playground",
            `<label class="field-label">Project name<input id="new-project-name" placeholder="Untitled project"></label><p class="modal-note">Your current project is saved in this browser.</p>`,
            [
              {
                text: "Create project",
                action: "create-project",
                primary: true,
              },
            ],
          );
          break;
        case "create-project": {
          const name =
            el("#new-project-name").value.trim() || "Untitled project";
          await withWorkspaceTransition(async () => {
            await persistCurrent();
            closeModal();
            await applyProject({
              id: uid(),
              name,
              version: 1,
              patterns: [],
              datasets: [],
              workspace: { tests: [] },
              layout: {},
            });
          });
          break;
        }
        case "load-project":
          await loadProjectById(button.dataset.id);
          break;
        case "delete-project":
          openModal(
            "Delete saved project?",
            `<p>This removes the project from this browser. Download a backup first if you need it.</p><input id="delete-project-id" hidden value="${h(button.dataset.id)}">`,
            [
              {
                text: "Delete project",
                action: "confirm-delete-project",
                primary: true,
              },
            ],
          );
          break;
        case "confirm-delete-project": {
          const id = el("#delete-project-id").value;
          await withWorkspaceTransition(async () => {
            const deletingCurrent = id === project.id;
            if (deletingCurrent) await saveQueue;
            else await persistCurrent();
            await deleteProject(id);
            projects = await listProjects();
            closeModal();
            if (deletingCurrent) {
              const next = projects.length
                ? await loadProject(projects[0].id)
                : createProject();
              await applyProject(next);
            }
            renderSidebar();
            toast("Saved project removed.");
          });
          break;
        }
        case "export-project": {
          const content = serializeProject(synchronizeProject());
          downloadText(
            `${safeName(project.name)}.regexstudio`,
            typeof content === "string"
              ? content
              : JSON.stringify(content, null, 2),
            "application/json",
          );
          toast("Project downloaded.", "success");
          autosave();
          break;
        }
        case "import-project":
          el("#project-input").click();
          break;
        case "add-pattern":
          addPattern();
          break;
        case "duplicate-pattern":
          addPattern({
            ...pat(),
            id: uid(),
            name: pat().name + " copy",
            color: COLORS[project.patterns.length % COLORS.length],
          });
          break;
        case "delete-pattern":
          if (project.patterns.length === 1)
            toast("Keep at least one pattern in the workspace.");
          else {
            project.patterns = project.patterns.filter(
              (p) => p.id !== pat().id,
            );
            project.activePatternId = project.patterns[0].id;
            changed();
            renderAll();
            queueRun();
          }
          break;
        case "select-pattern":
          activatePattern(button.dataset.id);
          break;
        case "flag":
          pat().options ^= Number(button.dataset.value);
          changed();
          renderAll();
          queueRun();
          break;
        case "options":
          openOptions();
          break;
        case "apply-options": {
          pat().options = els("[data-option]", el("#modal")).reduce(
            (n, x) => n + (x.checked ? Number(x.dataset.option) : 0),
            Number(el("#engine-choice").value),
          );
          culture = el("#engine-culture").value.trim();
          timeoutMs = Math.max(
            1,
            Math.min(10000, Number(el("#engine-timeout").value) || 250),
          );
          maxMatches = Math.max(
            1,
            Math.min(100000, Number(el("#engine-max-matches").value) || 5000),
          );
          maxSteps = Math.max(
            100,
            Math.min(100000, Number(el("#engine-max-steps").value) || 10000),
          );
          closeModal();
          changed();
          renderAll();
          queueRun();
          break;
        }
        case "use-interpreter":
          pat().options &= ~1024;
          changed();
          renderAll();
          await recordTrace();
          break;
        case "import-data":
          el("#file-input").click();
          break;
        case "connect-source":
          openSource();
          break;
        case "source-sample":
          el("#source-url").value = new URL(
            "./public/samples/" + button.dataset.file,
            document.baseURI,
          ).href;
          el("#source-format").value = button.dataset.file.split(".").at(-1);
          el("#source-name").value = button.dataset.file;
          break;
        case "load-source": {
          const url = el("#source-url").value.trim(),
            projectId = project.id;
          let headers = {};
          try {
            headers = JSON.parse(el("#source-headers")?.value || "{}");
          } catch {
            throw new Error("Request headers must be a JSON object.");
          }
          sourceController?.abort();
          const controller = new AbortController();
          sourceController = controller;
          button.disabled = true;
          el("#source-status").innerHTML = "<p>Connecting to the source…</p>";
          try {
            const d = await fetchData(url, {
              headers,
              signal: controller.signal,
              format: el("#source-format").value || undefined,
              name: el("#source-name").value.trim() || undefined,
            });
            if (controller.signal.aborted || project.id !== projectId) return;
            d.id ||= uid();
            project.datasets.push(d);
            project.activeDatasetId = d.id;
            sourceController = null;
            closeModal();
            changed();
            renderAll();
            queueRun();
            toast("Online data loaded.", "success");
          } catch (e) {
            if (!controller.signal.aborted && el("#source-status")) {
              el("#source-status").innerHTML =
                `<p class="error-text">${h(e.message)}</p>`;
              button.disabled = false;
            }
          }
          break;
        }
        case "select-dataset":
          project.activeDatasetId = button.dataset.id;
          changed();
          renderAll();
          queueRun();
          break;
        case "new-dataset": {
          const d = {
            id: uid(),
            name: `Untitled ${project.datasets.length + 1}.txt`,
            format: "text",
            text: "",
            rows: [],
            columns: [],
          };
          project.datasets.push(d);
          project.activeDatasetId = d.id;
          inputMode = "edit";
          changed();
          renderAll();
          el("#data-editor").focus();
          break;
        }
        case "delete-dataset":
          if (project.datasets.length === 1)
            toast("Keep at least one dataset in the project.");
          else {
            project.datasets = project.datasets.filter(
              (d) => d.id !== button.dataset.id,
            );
            if (!project.datasets.some((d) => d.id === project.activeDatasetId))
              project.activeDatasetId = project.datasets[0].id;
            changed();
            renderAll();
            queueRun();
          }
          break;
        case "save-dataset":
          await saveDataset(
            project.datasets.find((d) => d.id === button.dataset.id),
          );
          savedDatasets = await listDatasets();
          renderSidebar();
          toast("Dataset saved for reuse.", "success");
          break;
        case "load-dataset": {
          const d = await loadDataset(button.dataset.id);
          if (d) {
            d.id = uid();
            project.datasets.push(d);
            project.activeDatasetId = d.id;
            changed();
            renderAll();
            queueRun();
          }
          break;
        }
        case "data-tools":
          openDataTools();
          break;
        case "apply-data": {
          const d = data(),
            opts = {};
          if (el("#dataset-sheet"))
            opts.sheet = Number(el("#dataset-sheet").value);
          if (el("#dataset-column")?.value !== "")
            opts.column = el("#dataset-column")
              ? Number(el("#dataset-column").value)
              : undefined;
          if (el("#dataset-path")?.value) opts.path = el("#dataset-path").value;
          if (el("#dataset-xpath")?.value)
            opts.xpath = el("#dataset-xpath").value;
          const selected = selectData(d, opts);
          selected.textEdited = false;
          selected.name = el("#dataset-name").value.trim() || d.name;
          project.datasets[project.datasets.indexOf(d)] = selected;
          closeModal();
          changed();
          renderAll();
          queueRun();
          break;
        }
        case "input-mode":
          inputMode = button.dataset.mode;
          renderData();
          autosave();
          if (inputMode === "edit") el("#data-editor").focus();
          break;
        case "download-data":
          openModal(
            "Save your data",
            `<p class="modal-description">Download the current playground text or export a structured dataset.</p><div class="layout-options"><button class="secondary-button" data-action="download-data-text">${icon("file", 16)} Current input as text (.txt)</button><button class="secondary-button" data-action="download-data-json">${icon("code", 16)} Data rows as JSON (.json)</button><button class="secondary-button" data-action="download-data-xlsx">${icon("table", 16)} Data rows as Excel (.xlsx)</button>${data().sheets?.length ? '<button class="secondary-button" data-action="download-workbook">All original worksheets (.xlsx)</button>' : ""}</div>`,
          );
          break;
        case "download-data-text":
          downloadText(
            safeName(data().name.replace(/\.[^.]+$/, "")) + ".txt",
            input(),
          );
          closeModal();
          break;
        case "download-data-json": {
          const table = exportTable();
          downloadText(
            safeName(data().name.replace(/\.[^.]+$/, "")) + ".json",
            JSON.stringify(
              table.rows.map((r) =>
                Object.fromEntries(table.columns.map((c, i) => [c, r[i]])),
              ),
              null,
              2,
            ),
            "application/json",
          );
          closeModal();
          break;
        }
        case "download-data-xlsx": {
          const table = exportTable();
          downloadFile(
            await exportXlsx(table.rows, { columns: table.columns }),
            safeName(data().name.replace(/\.[^.]+$/, "")) + ".xlsx",
          );
          closeModal();
          break;
        }
        case "download-workbook":
          downloadFile(
            await exportWorkbook(data().sheets),
            safeName(data().name.replace(/\.[^.]+$/, "")) + ".xlsx",
          );
          closeModal();
          break;
        case "toggle-replace":
          showReplace = !showReplace;
          renderData();
          break;
        case "run-replace":
          await runSingle("replace");
          break;
        case "run-split":
          await runSingle("split");
          break;
        case "copy-replacement":
          if (await copyText(activeResult()?.replacement || ""))
            toast("Replacement copied.", "success");
          else toast("Clipboard access was denied.", "error");
          break;
        case "download-split":
          downloadText(
            "split-result.json",
            JSON.stringify(activeResult()?.splits || [], null, 2),
            "application/json",
          );
          break;
        case "select-match":
          selectedMatch = Number(button.dataset.index);
          preserveFocus(() => {
            renderData();
            renderDocks();
          });
          el(`mark[data-match="${selectedMatch}"]`)?.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
          break;
        case "export-matches": {
          const matches = activeResult()?.matches || [],
            rows = matches.map((m, i) => ({
              match: i + 1,
              value: m.value,
              index: m.index,
              length: m.length,
              ...Object.fromEntries(
                (m.groups || [])
                  .filter((g) => g.name !== "0")
                  .map((g) => [`group:${g.name}`, g.value]),
              ),
            })),
            columns = [...new Set(rows.flatMap(Object.keys))];
          if (button.dataset.format === "json")
            downloadText(
              "regex-matches.json",
              JSON.stringify(
                {
                  pattern: pat().pattern,
                  options: pat().options,
                  engine: activeResult()?.engine,
                  version: activeResult()?.version,
                  matches,
                },
                null,
                2,
              ),
              "application/json",
            );
          else if (button.dataset.format === "xlsx")
            downloadFile(
              await exportXlsx(
                rows.map((r) => columns.map((k) => r[k] ?? "")),
                { columns, sheetName: "Regex matches" },
              ),
              "regex-matches.xlsx",
            );
          else {
            const quote = (v) =>
              '"' + String(v ?? "").replaceAll('"', '""') + '"';
            downloadText(
              "regex-matches.csv",
              [
                columns.map(quote).join(","),
                ...rows.map((r) => columns.map((k) => quote(r[k])).join(",")),
              ].join("\r\n"),
              "text/csv",
            );
          }
          break;
        }
        case "dock-select":
          panelDock.select(button.dataset.zone, button.dataset.panel);
          break;
        case "dock-menu": {
          const zone = button.dataset.zone,
            active = panelDock.active[zone],
            other = zone === "right" ? "bottom" : "right";
          openModal(
            "Arrange your workspace",
            `<p class="modal-description">Drag a panel tab between the inspector and results area, or move it here.</p><button class="secondary-button full-width" data-action="move-panel" data-panel="${active || ""}" data-zone="${other}">${icon("arrow", 15)} Move ${h(panelMeta[active]?.title || "panel")} to ${other === "right" ? "inspector" : "results"}</button><button class="secondary-button full-width" data-action="maximize-panel" data-zone="${zone}">${icon("expand", 15)} Focus this panel</button><button class="text-button full-width" data-action="reset-layout">Restore default layout</button>`,
          );
          break;
        }
        case "move-panel":
          panelDock.move(button.dataset.panel, button.dataset.zone);
          closeModal();
          break;
        case "maximize-panel":
          closeModal();
          el(`#${button.dataset.zone}-dock`).classList.toggle("maximized");
          break;
        case "layout":
          openModal(
            "Make room for your workflow",
            `<div class="layout-options"><button class="secondary-button" data-action="toggle-sidebar">${icon("folder", 18)} ${dock.layout.showSidebar ? "Hide" : "Show"} explorer</button><button class="secondary-button" data-action="toggle-inspector">${icon("spark", 18)} ${dock.layout.showInspector ? "Hide" : "Show"} inspector</button><button class="secondary-button" data-action="reset-layout">${icon("refresh", 18)} Reset workspace</button></div><p class="modal-note">Drag the dividers to resize panels. Drag tabs between the results area and the inspector to dock them. Your layout is saved with the project.</p>`,
          );
          break;
        case "toggle-sidebar":
          dock.toggle("sidebar");
          closeModal();
          break;
        case "toggle-inspector":
          dock.toggle("inspector");
          closeModal();
          break;
        case "reset-layout":
          dock.reset();
          panelDock.zones = {
            bottom: ["matches", "compare", "steps", "graph", "code", "tests"],
            right: ["explain", "build", "reference"],
          };
          panelDock.active = { bottom: "matches", right: "explain" };
          els(".maximized").forEach((n) => n.classList.remove("maximized"));
          renderDocks();
          closeModal();
          changed({ invalidate: false });
          break;
        case "select-token":
          selectSource(
            Number(button.dataset.start),
            Number(button.dataset.end),
          );
          break;
        case "insert-block": {
          const b = builderBlocks.find((b) => b.id === button.dataset.id);
          if (!b) break;
          if (b.parameter) {
            const param = b.parameter;
            openModal(
              b.label,
              `<p class="modal-description">${h(b.description)}</p><input type="hidden" id="block-id" value="${h(b.id)}"><label class="field-label">${h(param.label)}<input id="block-value" type="${param.type === "number" ? "number" : "text"}" min="0" value="${h(param.default)}"></label>${b.id === "capture" ? `<label class="field-label">Expression to capture<input id="block-content" class="mono" value="${h(pat().pattern.slice(patternCaret.start, patternCaret.end) || "\\w+")}" spellcheck="false"></label>` : ""}`,
              [{ text: "Insert block", action: "apply-block", primary: true }],
            );
          } else if (b.id === "between") {
            openModal(
              "Repeat a range",
              `<p class="modal-description">Apply a repetition range to the expression immediately before your cursor.</p><div class="settings-grid"><label class="field-label">At least<input id="repeat-min" type="number" min="0" value="2"></label><label class="field-label">At most<input id="repeat-max" type="number" min="0" value="4" placeholder="Leave blank for no maximum"></label></div><label class="option-toggle"><input id="repeat-lazy" type="checkbox"><span><strong>Prefer fewer repetitions</strong></span></label>`,
              [
                {
                  text: "Insert repetition",
                  action: "apply-repeat",
                  primary: true,
                },
              ],
            );
          } else insertPattern(b.pattern);
          break;
        }
        case "apply-block": {
          const b = builderBlocks.find((b) => b.id === el("#block-id").value),
            param = b.parameter,
            raw = el("#block-value").value,
            step = {
              id: b.id,
              [param.name]: param.type === "number" ? Number(raw) : raw,
            };
          if (b.id === "capture") step.pattern = el("#block-content").value;
          const source = buildPattern([step]);
          closeModal();
          insertPattern(source);
          break;
        }
        case "apply-repeat": {
          const source =
            buildPattern([
              {
                id: "between",
                min: Number(el("#repeat-min").value),
                max:
                  el("#repeat-max").value === ""
                    ? null
                    : Number(el("#repeat-max").value),
              },
            ]) + (el("#repeat-lazy").checked ? "?" : "");
          closeModal();
          insertPattern(source);
          break;
        }

        case "insert-literal":
          insertPattern(
            (el("#literal-text")?.value || "")
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
              .replaceAll(" ", "\\ ")
              .replaceAll("#", "\\#"),
          );
          break;
        case "load-example": {
          const ex = examples.find((x) => x.id === button.dataset.id);
          if (ex) loadExample(ex);
          break;
        }
        case "load-lesson": {
          const l = lessons.find((x) => x.id === button.dataset.id);
          if (l) {
            loadExample(l);
            lesson = l;
            renderData();
            showPanel("explain");
          }
          break;
        }
        case "check-lesson": {
          queueRun.cancel();
          if (!lesson || !engine.ready) break;
          const currentLesson = lesson,
            generation = runGeneration,
            patternId = pat().id,
            result = await engine.run({ ...request(), operation: "matches" });
          if (
            generation !== runGeneration ||
            pat().id !== patternId ||
            lesson !== currentLesson
          )
            break;
          results[patternId] = result;
          const assessment = evaluateLesson(currentLesson, result);
          if (assessment.passed) {
            project.workspace.completedLessons ||= {};
            project.workspace.completedLessons[currentLesson.id] = true;
            changed({ invalidate: false });
          }
          renderData();
          renderDocks();
          openModal(
            assessment.passed ? "Challenge complete" : "Keep exploring",
            `<p class="modal-description">${h(assessment.message)}</p><div class="lesson-checks">${assessment.checks.map((check) => `<div class="${check.passed ? "passed" : ""}">${icon(check.passed ? "check" : "close", 16)}<span>${h(check.label)}</span></div>`).join("")}</div><p class="modal-note">${h(currentLesson.hint)}</p>`,
          );
          break;
        }
        case "lesson-hint":
          toast(
            lesson?.hint || "Try building the pattern one piece at a time.",
          );
          break;
        case "lesson-solution":
          if (lesson?.solution) {
            pat().pattern = lesson.solution;
            changed();
            renderAll();
            queueRun();
          }
          break;
        case "close-lesson":
          lesson = null;
          renderData();
          break;
        case "graph-zoom":
          graphZoom = Math.min(
            2.5,
            Math.max(0.4, graphZoom + Number(button.dataset.delta)),
          );
          renderDocks();
          break;
        case "export-graph":
          downloadText(
            "regex-pattern-map.svg",
            renderRailroad(analysis, {}),
            "image/svg+xml",
          );
          break;
        case "trace":
          await recordTrace();
          break;
        case "export-trace":
          downloadText(
            "regex-execution-trace.json",
            JSON.stringify(trace, null, 2),
            "application/json",
          );
          break;
        case "step-event": {
          const kind = el("#step-event-kind")?.value || "backtrack",
            next = (trace?.events || []).findIndex(
              (event, i) => i > traceIndex && event.kind === kind,
            );
          if (next >= 0) stepTo(next);
          else toast("No later " + kind + " event in this trace.");
          break;
        }
        case "step-first":
          stepTo(0);
          break;
        case "step-prev":
          stepTo(traceIndex - 1);
          break;
        case "step-next":
          stepTo(traceIndex + 1);
          break;
        case "step-last":
          stepTo((trace?.events?.length || 1) - 1);
          break;
        case "step-to":
          stepTo(Number(button.dataset.index));
          break;
        case "step-play":
          if (playing) {
            stopPlaying();
            renderTraceView();
          } else {
            if (traceIndex >= (trace?.events?.length || 1) - 1) traceIndex = 0;
            playing = true;
            renderTraceView();
            playTimer = setTimeout(playStep, playSpeed);
          }
          break;
        case "code-style":
          codeStyle = button.dataset.style;
          renderDocks();
          autosave();
          break;
        case "copy-code":
          if (await copyText(generateCSharp(request(), { style: codeStyle })))
            toast("C# code copied.", "success");
          else
            toast(
              "Clipboard access was denied. Download the .cs file instead.",
              "error",
            );
          break;
        case "download-code":
          downloadText(
            "Program.cs",
            generateCSharp(request(), { style: codeStyle }),
          );
          break;
        case "download-csproj":
          downloadText("RegexExample.csproj", generateCsproj());
          break;
        case "add-test":
          testGeneration++;
          project.workspace.tests ||= [];
          project.workspace.tests.push({
            id: uid(),
            input: "",
            shouldMatch: true,
          });
          changed({ invalidate: false });
          renderDocks();
          break;
        case "remove-test":
          testGeneration++;
          project.workspace.tests = project.workspace.tests.filter(
            (t) => t.id !== button.dataset.id,
          );
          changed({ invalidate: false });
          renderDocks();
          break;
        case "run-tests":
          await runTests();
          break;
        case "theme":
          theme = theme === "light" ? "dark" : "light";
          document.documentElement.dataset.theme = theme;
          try {
            localStorage.setItem("regexstudio.theme", theme);
          } catch {}
          break;
        case "engine-info":
          if (!engine.ready) {
            engine.retry();
            toast("Restarting the .NET engine…");
          } else
            openModal(
              "The real .NET engine, in your browser",
              `<div class="engine-info-mark">${icon("check", 25)} .NET ${h(engine.version)}</div><p>Matching, groups, capture histories, replacements and splitting run on <code>System.Text.RegularExpressions</code> from .NET 10, inside an isolated WebAssembly worker.</p><p>Patterns and data stay in your browser. RegexStudio never substitutes JavaScript regex results.</p><p>The simulator instruments the .NET backtracking interpreter. The non-backtracking engine returns exact matches, but its symbolic execution is not represented as interpreter steps.</p><p class="modal-note">The engine applies the selected culture explicitly. Match indexes and lengths are UTF-16 code units, just as in .NET strings.</p>`,
            );
          break;
        case "help":
          openModal(
            "Welcome to your regex playground",
            `<p class="modal-description">Paste a pattern, bring some data, and follow your curiosity.</p><div class="help-steps"><div><span>01</span><strong>Explore a pattern</strong><p>Paste an expression. Plain-language explanations and a pattern map help make sense of it.</p></div><div><span>02</span><strong>See every match</strong><p>Edit test data, inspect named groups and capture history, or compare several patterns side by side.</p></div><div><span>03</span><strong>Understand why</strong><p>Use the simulator to browse interpreter instructions, backtracking and captures one step at a time.</p></div></div><div class="shortcut-grid"><span>Run all patterns</span><kbd>Ctrl / ⌘ + Enter</kbd><span>Download project</span><kbd>Ctrl / ⌘ + S</kbd><span>Open projects</span><kbd>Ctrl / ⌘ + O</kbd><span>Step simulator</span><kbd>← / →</kbd><span>Leave focus mode</span><kbd>Escape</kbd></div><p class="modal-note">Projects autosave in this browser. Download a .regexstudio file for a portable backup. Drag panel tabs to dock them where you need them.</p>`,
          );
          break;
        case "close-modal":
          closeModal();
          break;
      }
    } catch (err) {
      toast(err.message || String(err), "error");
    }
  };
  el("#app").oninput = (e) => {
    const target = e.target;
    if (target.id === "pattern-editor") {
      pat().pattern = target.value;
      patternCaret = { start: target.selectionStart, end: target.selectionEnd };
      changed();
      analyze();
      el("#pattern-highlight").innerHTML = syntax(target.value);
      renderDocks();
      renderSidebar();
      queueRun();
    } else if (target.id === "pattern-name") {
      pat().name = target.value;
      changed({ invalidate: false });
      renderSidebar();
    } else if (target.id === "data-editor") {
      data().text = target.value;
      data().textEdited = true;
      changed();
      renderDocks();
      renderStatus();
      const lines = target.parentNode.querySelector(".line-numbers");
      if (lines)
        lines.textContent = target.value
          .split("\n")
          .slice(0, 5000)
          .map((_, i) => i + 1)
          .join("\n");
      queueRun();
    } else if (target.id === "replacement-input") {
      pat().replacement = target.value;
      changed({ invalidate: false });
    } else if (target.id === "step-slider") {
      stepTo(Number(target.value));
    } else if (target.id === "builder-search") {
      builderSearch = target.value;
      preserveFocus(renderDocks);
    } else if (target.dataset.testInput) {
      testGeneration++;
      const t = project.workspace.tests.find(
        (t) => t.id === target.dataset.testInput,
      );
      if (t) t.input = target.value;
      delete testResults[target.dataset.testInput];
      changed({ invalidate: false });
    }
  };
  el("#app").onchange = (e) => {
    const t = e.target;
    if (t.id === "auto-run") {
      autoRun = t.checked;
      autosave();
      if (autoRun) queueRun();
    } else if (t.dataset.patternEnabled) {
      project.patterns.find((p) => p.id === t.dataset.patternEnabled).enabled =
        t.checked;
      changed({ invalidate: false });
      renderSidebar();
      renderDocks();
      queueRun();
    } else if (t.id === "code-operation") {
      inputOperation = t.value;
      renderDocks();
      autosave();
    } else if (t.id === "step-speed") {
      playSpeed = Number(t.value);
    } else if (t.dataset.testExpect) {
      testGeneration++;
      const test = project.workspace.tests.find(
        (x) => x.id === t.dataset.testExpect,
      );
      if (test) test.shouldMatch = t.value === "true";
      delete testResults[t.dataset.testExpect];
      changed({ invalidate: false });
    } else if (t.id === "dataset-sheet") {
      const d = data(),
        sheet = d.sheets?.[Number(t.value)];
      if (sheet && el("#dataset-column"))
        el("#dataset-column").innerHTML =
          '<option value="">All columns</option>' +
          sheet.columns
            .map(
              (col, i) =>
                `<option value="${i}">${h(col || `Column ${i + 1}`)}</option>`,
            )
            .join("");
    }
  };
  el("#app").addEventListener(
    "focusout",
    (e) => {
      if (e.target.id === "pattern-editor")
        patternCaret = {
          start: e.target.selectionStart,
          end: e.target.selectionEnd,
        };
    },
    { signal: uiSignal },
  );
  el("#app").addEventListener(
    "scroll",
    (e) => {
      if (e.target.id === "pattern-editor") {
        el("#pattern-highlight").scrollLeft = e.target.scrollLeft;
        el("#pattern-highlight").scrollTop = e.target.scrollTop;
      }
      if (e.target.id === "data-editor" || e.target.id === "data-highlights") {
        const n = e.target.parentNode.querySelector(".line-numbers");
        if (n) n.scrollTop = e.target.scrollTop;
      }
    },
    { capture: true, signal: uiSignal },
  );
  el("#file-input").onchange = async (e) => {
    await importFiles([...e.target.files]);
    e.target.value = "";
  };
  el("#project-input").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (file) {
        const loaded = deserializeProject(await file.text(), { newId: true });
        await withWorkspaceTransition(async () => {
          await persistCurrent();
          await applyProject(loaded);
          toast("Project imported.", "success");
        });
      }
    } catch (err) {
      toast(err.message, "error");
    }
    e.target.value = "";
  };
  el("#modal").onclick = (e) => {
    if (e.target === el("#modal")) closeModal();
  };
  el("#modal").addEventListener("cancel", () => {
    sourceController?.abort();
    sourceController = null;
  });
  el("#app").addEventListener(
    "click",
    (e) => {
      const mark = e.target.closest("[data-match]");
      if (mark) {
        selectedMatch = Number(mark.dataset.match);
        renderDocks();
      }
      const node = e.target.closest("[data-node-id][data-start]");
      if (node) {
        selectedTokenId = node.dataset.nodeId;
        selectSource(Number(node.dataset.start), Number(node.dataset.end));
      }
    },
    { signal: uiSignal },
  );
  el("#app").addEventListener(
    "dragover",
    (e) => {
      if ([...e.dataTransfer.types].includes("Files")) {
        e.preventDefault();
        el("#workbench").classList.add("file-drag");
      }
    },
    { signal: uiSignal },
  );
  el("#app").addEventListener(
    "dragleave",
    (e) => {
      if (!e.relatedTarget) el("#workbench").classList.remove("file-drag");
    },
    { signal: uiSignal },
  );
  el("#app").addEventListener(
    "drop",
    (e) => {
      el("#workbench").classList.remove("file-drag");
      if (e.dataTransfer.files?.length) {
        e.preventDefault();
        importFiles([...e.dataTransfer.files]);
      }
    },
    { signal: uiSignal },
  );
}
function selectSource(start, end) {
  const editor = el("#pattern-editor");
  editor.focus();
  editor.setSelectionRange(start, end);
  patternCaret = { start, end };
}
function exportTable() {
  const d = data();
  return !d.textEdited &&
    Array.isArray(d.rows) &&
    (d.columns?.length || d.format !== "text" || d.rows.length)
    ? { columns: d.columns || [], rows: d.rows }
    : {
        columns: ["Text"],
        rows: input()
          .split("\n")
          .map((t) => [t]),
      };
}
function safeName(name) {
  return (
    name.replace(/[^a-z\d._-]+/gi, "-").replace(/^-|-$/g, "") || "RegexStudio"
  );
}
function loadExample(ex) {
  const p = {
    id: uid(),
    name: ex.title || ex.name,
    pattern: ex.pattern,
    options: ex.options || 0,
    color: COLORS[project.patterns.length % COLORS.length],
    replacement: ex.replacement || "",
    enabled: true,
  };
  project.patterns.push(p);
  if (ex.comparison)
    project.patterns.push({
      id: uid(),
      name: ex.comparison.title,
      pattern: ex.comparison.pattern,
      options: ex.comparison.options || 0,
      color: COLORS[project.patterns.length % COLORS.length],
      replacement: "",
      enabled: true,
    });
  project.activePatternId = p.id;
  const d = {
    id: uid(),
    name: `${safeName(ex.title || ex.name)}.txt`,
    format: "text",
    text: ex.input || "",
    columns: [],
    rows: [],
  };
  project.datasets.push(d);
  project.activeDatasetId = d.id;
  lesson = null;
  changed();
  renderAll();
  queueRun();
}
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    runAll();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    el('[data-action="export-project"]').click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
    e.preventDefault();
    el('[data-action="open-projects"]').click();
  }
  if (e.key === "Escape") {
    els(".maximized").forEach((n) => n.classList.remove("maximized"));
    stopPlaying();
  }
  if (
    !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) &&
    !el("#modal")?.open
  ) {
    if (e.key === "ArrowRight" && trace) {
      e.preventDefault();
      stepTo(traceIndex + 1);
    }
    if (e.key === "ArrowLeft" && trace) {
      e.preventDefault();
      stepTo(traceIndex - 1);
    }
    if (e.key === "Enter" && e.target.matches('[data-action][role="button"]'))
      e.target.click();
    if (e.key === "Enter" && e.target.matches("[data-node-id]"))
      selectSource(
        Number(e.target.dataset.start),
        Number(e.target.dataset.end),
      );
  }
});
engine.addEventListener("status", () => {
  if (!el("#engine-indicator")) return;
  renderStatus();
  renderDocks();
  if (engine.ready && autoRun && runCount === 0 && input().length <= 1000000)
    runAll({ automatic: true });
  if (engine.status === "error") {
    busy = false;
    renderStatus();
    toast(engine.lastError, "error");
  }
});
async function initialize() {
  try {
    theme = localStorage.getItem("regexstudio.theme") || "light";
    document.documentElement.dataset.theme = theme;
  } catch {}
  try {
    projects = await listProjects();
    savedDatasets = await listDatasets();
    const last = localStorage.getItem("regexstudio.last-project");
    if (last) {
      const loaded = await loadProject(last);
      if (loaded) {
        await applyProject(loaded);
        engine.start();
        return;
      }
    }
  } catch {}
  shell();
  autosave();
  engine.start();
}
initialize().catch((e) => {
  console.error(e);
  document.querySelector("#app").innerHTML =
    `<div class="boot-screen"><strong>Could not open RegexStudio</strong><p>${h(e.message)}</p><button onclick="location.reload()">Reload workspace</button></div>`;
});

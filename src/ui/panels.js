import { icon } from "./icons.js";
import { escapeHtml as h, highlightText } from "./dom.js";
import { renderRailroad } from "../regex/diagram.js";
import { generateCSharp } from "../regex/codegen.js";
import { builderBlocks, lessons, examples } from "../regex/learning.js";
export const panelMeta = {
  matches: { title: "Matches", icon: "table" },
  compare: { title: "Compare", icon: "compare" },
  steps: { title: "Simulator", icon: "play" },
  graph: { title: "Pattern map", icon: "graph" },
  code: { title: "C# code", icon: "code" },
  tests: { title: "Tests", icon: "checklist" },
  explain: { title: "Explain", icon: "spark" },
  build: { title: "Build", icon: "plus" },
  reference: { title: "Learn", icon: "book" },
};
export function emptyState(iconName, title, description, action = "") {
  return `<div class="empty-state">${icon(iconName, 28)}<strong>${h(title)}</strong><p>${h(description)}</p>${action}</div>`;
}
export function renderPanel(id, ctx) {
  return (
    {
      matches: renderMatches,
      compare: renderCompare,
      steps: renderSteps,
      graph: renderGraph,
      code: renderCode,
      tests: renderTests,
      explain: renderExplain,
      build: renderBuilder,
      reference: renderReference,
    }[id] || (() => "")
  )(ctx);
}
export function renderMatches(c) {
  const result = c.result;
  if (result?.error)
    return `<div class="error-card">${icon("alert")}<div><strong>${h(typeof result.error === "string" ? result.error : result.error.message || "Invalid pattern")}</strong><p>The .NET engine could not evaluate this pattern. Edit the expression or change its options.</p></div></div>`;
  if (!result)
    return emptyState(
      "search",
      c.busy ? "Finding your matches…" : "Ready when you are",
      "Run your patterns against the test data. Every result is evaluated locally by .NET 10.",
    );
  const matches = result.matches || [],
    selected = matches[c.selectedMatch] || matches[0];
  if (!matches.length)
    return emptyState(
      "search",
      "No matches this time",
      "Try a broader expression, check the test data, or step through the simulator to see where the match fails.",
    );
  return `<div class="panel-tools"><span><b>${matches.length.toLocaleString()}</b> matches ${result.truncated ? '<span class="warning-text">· limit reached</span>' : ""}<span class="muted"> · ${Number(result.elapsedMs || 0).toFixed(2)} ms</span></span><span class="spacer"></span><button class="text-button" data-action="export-matches" data-format="csv">${icon("download", 14)} CSV</button><button class="text-button" data-action="export-matches" data-format="json">JSON</button><button class="text-button" data-action="export-matches" data-format="xlsx">XLSX</button></div><div class="match-layout"><div class="match-list"><table><thead><tr><th>#</th><th>Match</th><th>Position</th><th>Length</th></tr></thead><tbody>${matches
    .slice(0, 500)
    .map(
      (m, i) =>
        `<tr tabindex="0" role="button" aria-label="Select match ${i + 1}" class="${i === (c.selectedMatch || 0) ? "selected" : ""}" data-action="select-match" data-index="${i}"><td><span class="match-number">${i + 1}</span></td><td class="mono">${m.length ? h(m.value) : '<span class="muted">empty match</span>'}</td><td>${m.index}</td><td>${m.length}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table>${matches.length > 500 ? '<div class="panel-note">Showing the first 500 matches. Export includes every returned match.</div>' : ""}</div><div class="capture-inspector"><div class="eyebrow">CAPTURE INSPECTOR</div><div class="capture-title">Match ${(c.selectedMatch || 0) + 1}<span class="muted">${selected.index} → ${selected.index + selected.length}</span></div>${(selected.groups || []).map((g) => `<details class="capture-group" ${g.name === "0" || g.number === 0 ? "" : "open"}><summary><span class="group-chip">${h(g.name ?? g.number)}</span><code>${g.success ? h(g.value) : '<span class="muted">not captured</span>'}</code><span class="count">${g.captures?.length || 0}</span></summary><div class="capture-values">${(g.captures || []).map((cap, i) => `<div><span>${i + 1}</span><code>${h(cap.value)}</code><small>${cap.index}:${cap.length}</small></div>`).join("")}</div></details>`).join("")}</div></div>`;
}
export function renderCompare(c) {
  const active = c.patterns.filter((p) => p.enabled !== false),
    sets = active.map((p) => ({ p, r: c.results[p.id] }));
  return `<div class="panel-tools"><span>One dataset. <b>${active.length} perspectives.</b></span><span class="spacer"></span><button class="text-button" data-action="add-pattern">${icon("plus", 14)} Add pattern</button></div><div class="compare-grid">${sets
    .map(
      ({ p, r }) =>
        `<button class="compare-card ${p.id === c.pattern.id ? "active" : ""}" data-action="select-pattern" data-id="${h(p.id)}" style="--pattern-color:${p.color}"><div class="compare-heading"><span class="color-dot"></span><strong>${h(p.name)}</strong>${p.id === c.pattern.id ? icon("check", 14) : ""}</div><code>${h(p.pattern)}</code><div class="compare-metrics"><div><strong>${r?.error ? "—" : r ? (r.matches?.length ?? 0) : "—"}</strong><small>${r?.error ? "error" : "matches"}</small></div><div><strong>${r ? Number(r.elapsedMs || 0).toFixed(2) : "—"}</strong><small>milliseconds</small></div><div><strong>${r && c.input.length ? Math.min(100, ((r.matches || []).reduce((n, m) => n + m.length, 0) / c.input.length) * 100).toFixed(0) : "0"}<span>%</span></strong><small>coverage</small></div></div><div class="mini-coverage">${(
          r?.matches || []
        )
          .slice(0, 600)
          .map(
            (m) =>
              `<i style="left:${c.input.length ? (m.index / c.input.length) * 100 : 0}%;width:${Math.max(0.3, c.input.length ? (m.length / c.input.length) * 100 : 0)}%"></i>`,
          )
          .join("")}</div><div class="compare-preview">${
          r?.error
            ? h(typeof r.error === "string" ? r.error : r.error.message)
            : (r?.matches || [])
                .slice(0, 3)
                .map((m) => `<span>${h(m.value) || "∅"}</span>`)
                .join("") || '<span class="muted">Run to compare</span>'
        }</div></button>`,
    )
    .join("")}</div>${sets.length > 1 ? renderOverlap(sets) : ""}`;
}
function renderOverlap(sets) {
  if (!sets.every((x) => x.r && !x.r.error)) return "";
  const maps = sets.map(
    (x) => new Set((x.r.matches || []).map((m) => `${m.index}:${m.length}`)),
  );
  const all = new Set(maps.flatMap((s) => [...s]));
  const common = [...all].filter((k) => maps.every((s) => s.has(k))).length;
  return `<div class="comparison-summary">${icon("compare", 16)} <strong>${common}</strong> identical match spans across all patterns <span class="divider-dot">·</span> <strong>${all.size - common}</strong> spans differ <span class="muted">· timings include browser and runtime variance</span></div>`;
}
export function renderExplain(c) {
  const a = c.analysis;
  if (!c.pattern.pattern)
    return emptyState(
      "spark",
      "Start with an idea",
      "Type a pattern or choose a building block. Its meaning will appear here.",
    );
  const explanations = a.explanations || a.tokens || [];
  return `<div class="inspector-intro"><span class="eyebrow">IN PLAIN LANGUAGE</span><h2>${h(typeof a.summary === "string" ? a.summary : a.summary?.text || "A closer look at your pattern")}</h2><p>Click any part to find it in your expression.</p></div><div class="explanation-list">${explanations.map((t, i) => `<button class="explanation-item" data-action="select-token" data-start="${t.start ?? t.span?.start ?? 0}" data-end="${t.end ?? t.span?.end ?? 0}"><span class="token-index">${String(i + 1).padStart(2, "0")}</span><div><code class="token-code token-${h(t.kind || t.type || "literal")}">${h(t.text ?? t.raw ?? t.value ?? t.label ?? "")}</code><strong>${h(t.label || t.title || t.kind || "Expression")}</strong><p>${h(t.description || t.explanation || "")}</p></div></button>`).join("")}</div>${(a.warnings || []).map((w) => `<div class="warning-card">${icon("info", 15)}<span>${h(typeof w === "string" ? w : w.message || w.description)}</span></div>`).join("")}<div class="inspector-footnote">${icon("shield", 14)}Explanations are a learning aid. .NET 10 validates and executes your expression.</div>`;
}
export function renderGraph(c) {
  let diagram;
  try {
    diagram = renderRailroad(c.analysis, {
      selectedId: c.selectedTokenId,
      fit: false,
      zoom: 1,
    });
  } catch (e) {
    return emptyState("graph", "Pattern map unavailable", e.message);
  }
  return `<div class="panel-tools"><span>${icon("graph", 15)} Follow your expression from start to finish</span><span class="spacer"></span><button class="text-button" data-action="export-graph">${icon("download", 14)} SVG</button><button class="icon-button" data-action="graph-zoom" data-delta="-.15" title="Zoom out">−</button><span class="muted">${Math.round((c.graphZoom || 1) * 100)}%</span><button class="icon-button" data-action="graph-zoom" data-delta=".15" title="Zoom in">+</button></div><div class="graph-surface"><div class="graph-zoom" style="transform:scale(${c.graphZoom || 1});transform-origin:top left">${diagram}</div></div><div class="panel-note">Branches show alternatives; loops show repetition. Select a token to inspect its source. This map describes pattern structure.</div>`;
}
export function renderSteps(c) {
  const t = c.trace;
  if (!t)
    return `<div class="simulator-welcome"><div class="simulator-mark">${icon("steps", 26)}</div><div><h3>See the engine think.</h3><p>Follow .NET’s interpreter one instruction at a time. Watch the input cursor, captures, and backtracking stack change as your pattern runs.</p><button class="primary-button" data-action="trace" ${!c.engineReady || c.tracing ? "disabled" : ""}>${icon("play", 15)} ${c.tracing ? "Recording execution…" : "Start simulation"}</button></div></div>`;
  if (t.error || t.unsupported)
    return `<div class="error-card">${icon("info")}<div><strong>${h(typeof t.error === "string" ? t.error : t.error?.message || t.reason || "This engine does not expose an interpreter trace")}</strong><p>Exact match results remain available. Select the backtracking engine to inspect its instruction stream.</p><button class="text-button" data-action="use-interpreter">Use backtracking interpreter</button></div></div>`;
  const events = t.events || [],
    step = Math.max(0, Math.min(c.traceIndex || 0, events.length - 1)),
    ev = events[step];
  if (!ev)
    return emptyState(
      "steps",
      "No instructions recorded",
      "Try a pattern with test data, then record again.",
    );
  const position = ev.position ?? 0,
    start = Math.max(0, position - 8),
    end = Math.min(c.input.length, position + 44),
    tape = c.input.slice(start, end);
  return `<div class="simulator-toolbar"><div class="segmented step-controls"><button class="icon-button" data-action="step-first" title="First step">${icon("first", 16)}</button><button class="icon-button" data-action="step-prev" title="Previous step (←)">${icon("back", 16)}</button><button class="icon-button play-control" data-action="step-play" title="Play or pause">${icon(c.playing ? "pause" : "play", 16)}</button><button class="icon-button" data-action="step-next" title="Next step (→)">${icon("chevron", 16)}</button><button class="icon-button" data-action="step-last" title="Last step">${icon("last", 16)}</button></div><span class="step-count">Step <b>${step + 1}</b> / ${events.length}</span><input id="step-slider" type="range" min="0" max="${events.length - 1}" value="${step}" aria-label="Execution step"><select id="step-speed" class="compact-select" aria-label="Playback speed"><option value="700" ${c.playSpeed === 700 ? "selected" : ""}>Slow</option><option value="250" ${!c.playSpeed || c.playSpeed === 250 ? "selected" : ""}>Normal</option><option value="60" ${c.playSpeed === 60 ? "selected" : ""}>Fast</option></select><button class="icon-button" data-action="trace" title="Record again">${icon("refresh", 16)}</button></div><div class="simulator-body"><div class="simulator-main"><div class="input-tape-label"><span>INPUT CURSOR</span><span>position ${position} · UTF-16</span></div><div class="input-tape">${[...tape.split(""), ...(end === c.input.length ? ["EOF"] : [])].map((ch, i) => `<div class="tape-cell ${start + i === position ? "current" : ""}"><small>${start + i}</small><span>${ch === "\n" ? "↵" : ch === "\r" ? "␍" : ch === "\t" ? "⇥" : ch === " " ? "·" : h(ch)}</span></div>`).join("")}</div><div class="current-instruction ${ev.kind === "backtrack" ? "backtracking" : ""}"><span class="instruction-icon">${icon(ev.kind === "backtrack" ? "undo" : ev.kind === "match" ? "check" : "arrow", 19)}</span><div><div class="instruction-heading"><span class="event-kind">${h(ev.kind || "execute")}</span><code>${h(ev.opcode || "")}</code></div><p>${h(ev.description || "Execute the current instruction.")}</p></div></div><div class="trace-stats"><div><small>INSTRUCTION</small><b>${ev.codePosition ?? "—"}</b></div><div><small>BACKTRACK STACK</small><b>${ev.trackDepth ?? 0}</b></div><div><small>WORK STACK</small><b>${ev.stackDepth ?? 0}</b></div><div><small>CAPTURE STACK</small><b>${ev.captureDepth ?? 0}</b></div></div><details class="execution-details"><summary>Stacks & active captures</summary><div><span>Backtrack stack (top 64)</span><code>${h((ev.track || []).join(", ") || "empty")}</code><span>Work stack (top 64)</span><code>${h((ev.stack || []).join(", ") || "empty")}</code>${(ev.captures || []).map((cap) => `<span>Group ${h(cap.name)} [${cap.index}..${cap.index + cap.length})</span><code>${h(c.input.slice(cap.index, cap.index + cap.length))}</code>`).join("")}</div></details>${t.truncated ? '<div class="warning-card">Trace step limit reached. The match result is independent of this trace limit.</div>' : ""}</div><div class="event-list"><div class="eyebrow">EXECUTION HISTORY</div>${events
    .slice(Math.max(0, step - 4), Math.min(events.length, step + 8))
    .map((event, j) => {
      const n = Math.max(0, step - 4) + j;
      return `<button class="event-row ${n === step ? "active" : ""}" data-action="step-to" data-index="${n}"><span>${n + 1}</span><i class="event-dot ${h(event.kind)}"></i><code>${h(event.opcode || event.kind)}</code><small>@${event.position}</small></button>`;
    })
    .join(
      "",
    )}</div></div><div class="panel-note trace-footer"><span>${t.resultsVerified === true ? "✓ Results verified against .NET · " : ""}${h(t.kind || "dotnet-interpreter")} · ${t.matches?.length ?? 0} matches. Optimized instructions may consume multiple characters.</span><button class="text-button" data-action="export-trace">${icon("download", 13)} Trace</button></div>`;
}
export function renderCode(c) {
  let code;
  try {
    code = generateCSharp(c.request, { style: c.codeStyle || "runtime" });
  } catch (e) {
    code = "// " + e.message;
  }
  return `<div class="panel-tools"><div class="segmented"><button class="segment ${c.codeStyle !== "generated" ? "active" : ""}" data-action="code-style" data-style="runtime">Regex API</button><button class="segment ${c.codeStyle === "generated" ? "active" : ""}" data-action="code-style" data-style="generated">GeneratedRegex</button></div><select id="code-operation" class="compact-select" aria-label="Code operation"><option value="matches" ${c.request.operation === "matches" ? "selected" : ""}>Find matches</option><option value="replace" ${c.request.operation === "replace" ? "selected" : ""}>Replace</option><option value="split" ${c.request.operation === "split" ? "selected" : ""}>Split</option></select><span class="spacer"></span><span class="language-badge">C# · .NET 10</span><button class="text-button" data-action="copy-code">${icon("copy", 14)} Copy</button><button class="text-button" data-action="download-code">${icon("download", 14)} .cs</button><button class="text-button" data-action="download-csproj" title="Download .NET 10 project">.csproj</button></div><pre class="code-output"><code>${syntaxCSharp(code)}</code></pre>`;
}
function syntaxCSharp(code) {
  return h(code).replace(
    /(\/\/[^\n]*|&quot;(?:[^&]|&(?!quot;))*?&quot;|\b(?:using|var|new|foreach|in|class|static|partial|public|private|return|try|finally|const|void|if|else|false|true)\b)/g,
    (m) =>
      `<span class="${m.startsWith("//") ? "code-comment" : m.startsWith("&quot;") ? "code-string" : "code-keyword"}">${m}</span>`,
  );
}
export function renderTests(c) {
  const tests = c.tests || [],
    results = c.testResults || {};
  return `<div class="panel-tools"><span>Keep your edge cases close.</span><span class="spacer"></span><button class="text-button" data-action="add-test">${icon("plus", 14)} Add case</button><button class="primary-button small" data-action="run-tests" ${!c.engineReady ? "disabled" : ""}>${icon("play", 14)} Run tests</button></div><div class="test-list">${tests.length ? tests.map((test, i) => `<div class="test-case"><span class="test-status ${results[test.id]?.pass ? "pass" : results[test.id] ? "fail" : ""}">${icon(results[test.id]?.pass ? "check" : results[test.id] ? "close" : "checklist", 16)}</span><input aria-label="Test case ${i + 1} input" data-test-input="${h(test.id)}" value="${h(test.input)}" placeholder="Input to test"><select aria-label="Test case expectation" data-test-expect="${h(test.id)}"><option value="true" ${test.shouldMatch !== false ? "selected" : ""}>Should match</option><option value="false" ${test.shouldMatch === false ? "selected" : ""}>Should not match</option></select><span class="test-result">${results[test.id] ? (results[test.id].pass ? "Passed" : "Failed") : "Not run"}</span><button class="icon-button" data-action="remove-test" data-id="${h(test.id)}" title="Remove test">${icon("close", 14)}</button>${results[test.id]?.error ? `<small class="error-text">${h(results[test.id].error)}</small>` : ""}</div>`).join("") : emptyState("checklist", "Make every change with confidence", "Add examples that should match and examples that should not. Tests run against the selected pattern.")}<div class="panel-note">Tests use the active pattern’s .NET options, culture, and timeout. Cases are saved with your project.</div></div>`;
}
export function renderBuilder(c) {
  const blocks = Array.isArray(builderBlocks)
    ? builderBlocks
    : Object.values(builderBlocks);
  return `<div class="inspector-intro"><span class="eyebrow">BUILD WITHOUT GUESSING</span><h2>One piece at a time.</h2><p>Insert a building block at your cursor, then customize it.</p></div><div class="builder-search"><input id="builder-search" type="search" placeholder="Find a building block…" aria-label="Find a building block" value="${h(c.builderSearch || "")}"></div><div class="builder-list">${blocks
    .filter(
      (b) =>
        !c.builderSearch ||
        `${b.label || b.title} ${b.description || ""} ${b.category || ""}`
          .toLowerCase()
          .includes(c.builderSearch.toLowerCase()),
    )
    .map(
      (b) =>
        `<button class="builder-block" data-action="insert-block" data-id="${h(b.id)}"><span><code>${h(b.pattern || b.source || b.regex || "")}</code>${icon("plus", 14)}</span><strong>${h(b.label || b.title || b.name)}</strong><small>${h(b.description || "")}</small></button>`,
    )
    .join(
      "",
    )}</div><div class="custom-builder"><span class="eyebrow">MATCH LITERAL TEXT</span><input id="literal-text" placeholder="Text, e.g. $19.99" aria-label="Literal text"><button class="secondary-button" data-action="insert-literal">Escape & insert text</button><p>Special regex characters are escaped for you.</p></div>`;
}
export function renderReference(c) {
  return `<div class="inspector-intro"><span class="eyebrow">YOUR REGEX FIELD GUIDE</span><h2>A little clarity goes a long way.</h2><p>Start with a working example or explore a lesson.</p></div><div class="reference-section"><h3>Recipes to explore</h3>${examples.map((e) => `<button class="recipe-row" data-action="load-example" data-id="${h(e.id)}"><span class="recipe-icon">${icon(e.icon || "code", 17)}</span><span><strong>${h(e.title || e.name)}</strong><small>${h(e.description || e.summary || "")}</small></span>${icon("chevron", 14)}</button>`).join("")}</div><div class="reference-section"><h3>Learn by doing</h3>${lessons.map((l, i) => `<button class="lesson-row" data-action="load-lesson" data-id="${h(l.id)}"><span>${c.completedLessons?.[l.id] ? icon("check", 14) : String(i + 1).padStart(2, "0")}</span><div><strong>${h(l.title)}</strong><small>${h(l.description || l.summary || "")}</small></div>${icon("chevron", 14)}</button>`).join("")}</div><div class="reference-section"><h3>.NET reference</h3><a class="reference-link" href="https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-language-quick-reference" target="_blank" rel="noopener">Regex language reference ${icon("arrow", 14)}</a><a class="reference-link" href="https://learn.microsoft.com/dotnet/standard/base-types/regular-expression-options" target="_blank" rel="noopener">Options & matching behavior ${icon("arrow", 14)}</a></div>`;
}

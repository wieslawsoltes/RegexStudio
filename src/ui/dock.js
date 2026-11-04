import { normalizePanelLayout } from "../state/workspace.js";
export class DockLayout {
  constructor(root, layout = {}, onChange = () => {}) {
    this.root = root;
    this.layout = normalizePanelLayout(layout);
    this.onChange = onChange;
    this.dragging = null;
    this.setup();
    this.apply();
  }
  apply() {
    const s = this.root.style;
    for (const [key, value] of Object.entries({
      sidebarWidth: this.layout.showSidebar ? this.layout.sidebarWidth : 0,
      inspectorWidth: this.layout.showInspector
        ? this.layout.inspectorWidth
        : 0,
      patternHeight: this.layout.patternHeight,
      resultsHeight: this.layout.resultsHeight,
    }))
      s.setProperty(
        "--" + key.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase()),
        `${value}px`,
      );
    this.root.classList.toggle("sidebar-hidden", !this.layout.showSidebar);
    this.root.classList.toggle("inspector-hidden", !this.layout.showInspector);
  }
  setup() {
    this.root.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-resize]");
      if (!handle) return;
      const key = handle.dataset.resize;
      const start = { x: e.clientX, y: e.clientY, value: this.layout[key] };
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("resizing");
      const move = (ev) => {
        const vertical = key.endsWith("Height");
        const delta = vertical ? ev.clientY - start.y : ev.clientX - start.x;
        const direction = ["inspectorWidth", "resultsHeight"].includes(key)
          ? -1
          : 1;
        const min = key === "patternHeight" ? 146 : 180,
          max = key.endsWith("Width") ? 480 : Math.max(220, innerHeight * 0.65);
        this.layout[key] = Math.max(
          min,
          Math.min(max, start.value + delta * direction),
        );
        this.apply();
      };
      const up = () => {
        document.body.classList.remove("resizing");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        this.onChange({ ...this.layout });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    this.root.addEventListener("keydown", (e) => {
      const handle = e.target.closest("[data-resize]");
      if (
        !handle ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      )
        return;
      e.preventDefault();
      const key = handle.dataset.resize;
      const delta = ["ArrowRight", "ArrowDown"].includes(e.key) ? 20 : -20;
      this.layout[key] = Math.max(
        key === "patternHeight" ? 146 : 180,
        Math.min(
          480,
          this.layout[key] +
            delta *
              (["inspectorWidth", "resultsHeight"].includes(key) ? -1 : 1),
        ),
      );
      this.apply();
      this.onChange({ ...this.layout });
    });
  }
  toggle(which) {
    const key = which === "sidebar" ? "showSidebar" : "showInspector";
    this.layout[key] = !this.layout[key];
    this.apply();
    this.onChange({ ...this.layout });
  }
  reset() {
    this.layout = {
      sidebarWidth: 222,
      inspectorWidth: 292,
      patternHeight: 188,
      resultsHeight: 292,
      showSidebar: true,
      showInspector: true,
    };
    this.apply();
    this.onChange({ ...this.layout });
  }
}
export class PanelDock extends EventTarget {
  constructor(layout = {}) {
    super();
    const normalized = normalizePanelLayout({ dock: layout }).dock;
    this.zones = normalized.zones;
    this.active = normalized.active;
  }
  move(panel, zone, index) {
    if (
      !Object.hasOwn(this.zones, zone) ||
      !Object.values(this.zones).some((ids) => ids.includes(panel))
    )
      return;
    for (const ids of Object.values(this.zones)) {
      const old = ids.indexOf(panel);
      if (old !== -1) ids.splice(old, 1);
    }
    this.zones[zone].splice(index ?? this.zones[zone].length, 0, panel);
    this.active[zone] = panel;
    for (const key of Object.keys(this.zones))
      if (!this.zones[key].includes(this.active[key]))
        this.active[key] = this.zones[key][0];
    this.dispatchEvent(new Event("change"));
  }
  select(zone, panel) {
    if (!this.zones[zone]?.includes(panel)) return;
    this.active[zone] = panel;
    this.dispatchEvent(new Event("change"));
  }
  snapshot() {
    return { zones: this.zones, active: this.active };
  }
  bind(root) {
    root.addEventListener("dragstart", (e) => {
      const tab = e.target.closest("[data-dock-tab]");
      if (tab) {
        e.dataTransfer.setData(
          "application/regexstudio-panel",
          tab.dataset.dockTab,
        );
        e.dataTransfer.effectAllowed = "move";
        root.classList.add("docking");
      }
    });
    root.addEventListener("dragend", () => root.classList.remove("docking"));
    root.addEventListener("dragover", (e) => {
      const zone = e.target.closest("[data-dock-zone]");
      if (
        zone &&
        [...e.dataTransfer.types].includes("application/regexstudio-panel")
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    });
    root.addEventListener("drop", (e) => {
      const zone = e.target.closest("[data-dock-zone]"),
        panel = e.dataTransfer.getData("application/regexstudio-panel");
      if (zone && panel) {
        e.preventDefault();
        root.classList.remove("docking");
        this.move(
          panel,
          zone.dataset.dockZone,
          e.target.closest("[data-dock-tab]")
            ? this.zones[zone.dataset.dockZone].indexOf(
                e.target.closest("[data-dock-tab]").dataset.dockTab,
              )
            : undefined,
        );
      }
    });
  }
}

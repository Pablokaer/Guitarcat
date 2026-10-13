import { describe, expect, it } from "vitest";
import {
  applyLayoutCommand,
  DEFAULT_LAYOUT,
  effectiveLayout,
  loadLayout,
  parseLayout,
  saveLayout,
  type LayoutCommand,
  type LayoutState,
} from "../src/layout";

const run = (s: LayoutState, ...cmds: LayoutCommand[]) => cmds.reduce(applyLayoutCommand, s);

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("panel commands", () => {
  it("toggles each panel independently", () => {
    const s = run(DEFAULT_LAYOUT, "tools");
    expect(s).toMatchObject({ tools: false, nav: "expanded", player: "expanded", toolbar: true });
    const t = run(s, "toolbar", "nav");
    expect(t).toMatchObject({ tools: false, toolbar: false, nav: "hidden", player: "expanded" });
  });

  it("supports every combination, including all hidden", () => {
    const allHidden = run(DEFAULT_LAYOUT, "player-hide", "nav", "tools", "toolbar");
    expect(allHidden).toMatchObject({ player: "hidden", nav: "hidden", tools: false, toolbar: false, focus: false });
    const playerOnly = run(DEFAULT_LAYOUT, "nav", "tools", "toolbar");
    expect(playerOnly).toMatchObject({ player: "expanded", nav: "hidden", tools: false, toolbar: false });
  });

  it("nav: expanded -> compact -> expanded, and hide/show keeps the last width", () => {
    const compact = run(DEFAULT_LAYOUT, "nav-compact");
    expect(compact.nav).toBe("compact");
    expect(run(compact, "nav-compact").nav).toBe("expanded");
    const hidden = run(compact, "nav");
    expect(hidden.nav).toBe("hidden");
    expect(run(hidden, "nav").nav).toBe("compact");
    expect(run(hidden, "nav-compact").nav).toBe("compact");
  });

  it("player: expanded <-> collapsed, hide/show keeps the last state", () => {
    const collapsed = run(DEFAULT_LAYOUT, "player");
    expect(collapsed.player).toBe("collapsed");
    const hidden = run(collapsed, "player-hide");
    expect(hidden.player).toBe("hidden");
    expect(run(hidden, "player-hide").player).toBe("collapsed");
    expect(run(hidden, "player").player).toBe("expanded");
  });
});

describe("Focus Mode", () => {
  const custom = run(DEFAULT_LAYOUT, "player", "nav-compact", "tools");

  it("hides every panel and restores the previous configuration", () => {
    const focused = run(custom, "focus");
    expect(focused).toMatchObject({ focus: true, player: "hidden", nav: "hidden", tools: false, toolbar: false });
    const back = run(focused, "focus");
    expect(back).toMatchObject({ focus: false, player: "collapsed", nav: "compact", tools: false, toolbar: true });
    expect(run(focused, "exit-focus")).toEqual(back);
  });

  it("exit-focus outside Focus Mode changes nothing", () => {
    expect(run(custom, "exit-focus")).toEqual(custom);
  });

  it("toggling a panel while focused leaves Focus Mode from the focused layout", () => {
    const s = run(custom, "focus", "tools");
    expect(s).toMatchObject({ focus: false, beforeFocus: null, tools: true, nav: "hidden", player: "hidden" });
    // Remembered widths survive, so showing the nav brings back the compact one.
    expect(run(s, "nav").nav).toBe("compact");
  });
});

describe("effectiveLayout", () => {
  it("compacts an expanded nav on medium windows without touching stored state", () => {
    expect(effectiveLayout(DEFAULT_LAYOUT, 1400).nav).toBe("expanded");
    expect(effectiveLayout(DEFAULT_LAYOUT, 1000).nav).toBe("compact");
    expect(DEFAULT_LAYOUT.nav).toBe("expanded");
  });

  it("never shows a panel the user hid, at any width", () => {
    const s = run(DEFAULT_LAYOUT, "nav", "tools");
    for (const w of [400, 800, 1200, 2000]) {
      expect(effectiveLayout(s, w)).toMatchObject({ nav: "hidden", tools: false });
    }
    expect(effectiveLayout(s, 600).narrow).toBe(true);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const store = memoryStorage();
    const s = run(DEFAULT_LAYOUT, "player", "nav-compact", "focus");
    saveLayout(s, store);
    expect(loadLayout(store)).toEqual(s);
  });

  it("falls back to defaults for missing or corrupt data", () => {
    expect(loadLayout(memoryStorage())).toEqual(DEFAULT_LAYOUT);
    const bad = memoryStorage();
    bad.setItem("tabsync.layout", "{not json");
    expect(loadLayout(bad)).toEqual(DEFAULT_LAYOUT);
  });

  it("validates each field", () => {
    const s = parseLayout({ player: "sideways", nav: "compact", tools: "yes", toolbar: false, focus: true });
    expect(s).toMatchObject({ player: "expanded", nav: "compact", tools: true, toolbar: false, focus: true });
    // Focus without a saved layout still has something to restore.
    expect(s.beforeFocus).not.toBeNull();
    expect(parseLayout({ focus: false, beforeFocus: { nav: "hidden" } }).beforeFocus).toBeNull();
  });
});

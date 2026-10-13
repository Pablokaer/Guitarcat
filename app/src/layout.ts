/**
 * Visibility of the panels around the Songsterr viewer. One plain object, changed
 * only through the pure functions below, persisted in localStorage.
 *
 * The viewer itself is never part of this state: it is always laid out, so the
 * embedded page keeps its size and is never reloaded by a layout change.
 */
export type PlayerState = "expanded" | "collapsed" | "hidden";
export type NavState = "expanded" | "compact" | "hidden";

export interface PanelLayout {
  player: PlayerState;
  nav: NavState;
  tools: boolean;
  toolbar: boolean;
}

export interface LayoutState extends PanelLayout {
  /** Focus Mode: everything around the viewer hidden. */
  focus: boolean;
  /** Panels to restore when Focus Mode ends. */
  beforeFocus: PanelLayout | null;
  /** Width the nav returns to when shown again after being hidden. */
  navShown: "expanded" | "compact";
  /** State the player returns to when shown again after being hidden. */
  playerShown: "expanded" | "collapsed";
}

export type LayoutCommand =
  | "focus"
  | "exit-focus"
  | "nav"
  | "nav-compact"
  | "player"
  | "player-hide"
  | "tools"
  | "toolbar";

export const DEFAULT_LAYOUT: LayoutState = {
  player: "expanded",
  nav: "expanded",
  tools: true,
  toolbar: true,
  focus: false,
  beforeFocus: null,
  navShown: "expanded",
  playerShown: "expanded",
};

const FOCUS_PANELS: PanelLayout = { player: "hidden", nav: "hidden", tools: false, toolbar: false };

function panels(s: LayoutState): PanelLayout {
  return { player: s.player, nav: s.nav, tools: s.tools, toolbar: s.toolbar };
}

/** Changing any panel while in Focus Mode leaves Focus Mode from the focused layout. */
function leaveFocus(s: LayoutState): LayoutState {
  return s.focus ? { ...s, focus: false, beforeFocus: null } : s;
}

function setNav(s: LayoutState, nav: NavState): LayoutState {
  return { ...s, nav, navShown: nav === "hidden" ? s.navShown : nav };
}

function setPlayer(s: LayoutState, player: PlayerState): LayoutState {
  return { ...s, player, playerShown: player === "hidden" ? s.playerShown : player };
}

export function applyLayoutCommand(state: LayoutState, cmd: LayoutCommand): LayoutState {
  switch (cmd) {
    case "focus":
      return state.focus ? exitFocus(state) : enterFocus(state);
    case "exit-focus":
      return exitFocus(state);
  }
  const s = leaveFocus(state);
  switch (cmd) {
    case "nav": // show/hide, keeping the last width
      return setNav(s, s.nav === "hidden" ? s.navShown : "hidden");
    case "nav-compact": // expanded <-> compact; a hidden nav comes back compact
      return setNav(s, s.nav === "compact" ? "expanded" : "compact");
    case "player": // expanded <-> collapsed (shows it if hidden)
      return setPlayer(s, s.player === "expanded" ? "collapsed" : "expanded");
    case "player-hide":
      return setPlayer(s, s.player === "hidden" ? s.playerShown : "hidden");
    case "tools":
      return { ...s, tools: !s.tools };
    case "toolbar":
      return { ...s, toolbar: !s.toolbar };
  }
}

export function enterFocus(s: LayoutState): LayoutState {
  if (s.focus) return s;
  return { ...s, ...FOCUS_PANELS, focus: true, beforeFocus: panels(s) };
}

export function exitFocus(s: LayoutState): LayoutState {
  if (!s.focus) return s;
  return { ...s, ...(s.beforeFocus ?? panels(DEFAULT_LAYOUT)), focus: false, beforeFocus: null };
}

/** Window widths below which panels give way to the viewer. */
export const BREAKPOINTS = { compactNav: 1080, narrow: 760 } as const;

/**
 * What is actually rendered at a given window width. The stored state is left
 * alone, so widening the window brings back what the user chose.
 */
export function effectiveLayout(s: LayoutState, width: number): PanelLayout & { narrow: boolean } {
  // Only widths shrink here; nothing is hidden behind the user's back, so every
  // toggle still has a visible effect at any size.
  const nav = s.nav === "expanded" && width < BREAKPOINTS.compactNav ? "compact" : s.nav;
  return { player: s.player, nav, tools: s.tools, toolbar: s.toolbar, narrow: width < BREAKPOINTS.narrow };
}

const KEY = "tabsync.layout";
const PLAYER: PlayerState[] = ["expanded", "collapsed", "hidden"];
const NAV: NavState[] = ["expanded", "compact", "hidden"];

/** Validates stored JSON field by field, so a bad value never breaks the shell. */
export function parseLayout(raw: unknown): LayoutState {
  const d = DEFAULT_LAYOUT;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const panelsOf = (v: unknown): PanelLayout | null => {
    if (!v || typeof v !== "object") return null;
    const p = v as Record<string, unknown>;
    return {
      player: pick(p.player, PLAYER, d.player),
      nav: pick(p.nav, NAV, d.nav),
      tools: bool(p.tools, d.tools),
      toolbar: bool(p.toolbar, d.toolbar),
    };
  };
  const state: LayoutState = {
    ...(panelsOf(r) ?? panels(d)),
    focus: bool(r.focus, false),
    beforeFocus: panelsOf(r.beforeFocus),
    navShown: pick(r.navShown, ["expanded", "compact"] as const, d.navShown),
    playerShown: pick(r.playerShown, ["expanded", "collapsed"] as const, d.playerShown),
  };
  if (state.focus && !state.beforeFocus) state.beforeFocus = panels(d);
  if (!state.focus) state.beforeFocus = null;
  return state;
}

export function loadLayout(storage: Pick<Storage, "getItem"> = localStorage): LayoutState {
  try {
    const raw = storage.getItem(KEY);
    return parseLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(s: LayoutState, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the layout lasts for this session only */
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The embedded Songsterr page must survive layout changes: only open() and
 * reload() may create a webview; hiding, showing and re-aligning must not.
 */
const created: FakeWebview[] = [];

class FakeWebview {
  closed = false;
  hidden = false;
  positions: unknown[] = [];
  sizes: unknown[] = [];
  constructor(_win: unknown, public label: string, public opts: { url: string }) {
    created.push(this);
  }
  once(event: string, cb: () => void) {
    if (event === "tauri://created") queueMicrotask(cb);
    return Promise.resolve(() => {});
  }
  async close() { this.closed = true; }
  async hide() { this.hidden = true; }
  async show() { this.hidden = false; }
  async setPosition(p: unknown) { this.positions.push(p); }
  async setSize(s: unknown) { this.sizes.push(s); }
}

vi.mock("@tauri-apps/api/webview", () => ({
  Webview: FakeWebview,
  getCurrentWebview: () => ({ setAutoResize: async () => {} }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class { constructor(public x: number, public y: number) {} },
  LogicalSize: class { constructor(public width: number, public height: number) {} },
}));

let observer: (() => void) | null = null;
vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { observer = cb; } observe() {} });
vi.stubGlobal("window", { addEventListener: () => {} });
vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));

const { EmbeddedPage } = await import("../src/embed");

let rect = { left: 300, top: 120, width: 800, height: 600 };
const area = { getBoundingClientRect: () => rect } as unknown as HTMLElement;
const flush = () => new Promise((r) => setTimeout(r, 5));

describe("EmbeddedPage", () => {
  beforeEach(() => {
    created.length = 0;
    rect = { left: 300, top: 120, width: 800, height: 600 };
  });

  it("follows layout changes without recreating the page", async () => {
    const page = new EmbeddedPage(area);
    await page.open("https://www.songsterr.com/a/wa/song?id=1");
    expect(created).toHaveLength(1);
    const view = created[0];

    // Sidebar collapses: the area grows and moves.
    rect = { left: 64, top: 120, width: 1036, height: 600 };
    observer!();
    page.track(20);
    await flush();
    await flush();
    expect(view.positions.at(-1)).toMatchObject({ x: 64, y: 120 });
    expect(view.sizes.at(-1)).toMatchObject({ width: 1036, height: 600 });

    // Pages covering it hide and show it, also without reloading.
    await page.hide("page");
    await page.hide("local");
    await page.show("page");
    expect(view.hidden).toBe(true); // still hidden for "local"
    await page.show("local");
    expect(view.hidden).toBe(false);

    expect(created).toHaveLength(1);
    expect(view.closed).toBe(false);
    expect(page.url).toBe("https://www.songsterr.com/a/wa/song?id=1");
  });

  it("opens new pages hidden while something covers the viewer", async () => {
    const page = new EmbeddedPage(area);
    await page.hide("page");
    await page.open("https://x/2");
    expect(created.at(-1)!.hidden).toBe(true);
  });

  it("reload is the only way to load the same page again", async () => {
    const page = new EmbeddedPage(area);
    await page.open("https://x/3");
    await page.reload();
    expect(created).toHaveLength(2);
    expect(created[0].closed).toBe(true);
    expect(created[1].opts.url).toBe("https://x/3");
  });
});

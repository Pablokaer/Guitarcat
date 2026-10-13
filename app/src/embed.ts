import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebview, Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Shows an external page (Songsterr) inside the main window.
 *
 * Songsterr refuses to be framed (X-Frame-Options: DENY), so an <iframe> stays
 * blank. Instead this creates a native child webview and keeps it positioned over
 * `area`. Needs Tauri's `unstable` feature; desktop only.
 *
 * A native webview always draws above the page's DOM, so anything that should
 * appear on top of it (dialogs) must call hide() first.
 */
export class EmbeddedPage {
  private view: Webview | null = null;
  private seq = 0;
  private hiddenByUs = false;

  constructor(private area: HTMLElement) {
    new ResizeObserver(() => void this.sync()).observe(area);
    window.addEventListener("resize", () => void this.sync());
  }

  /** Child webviews exist on desktop Tauri only (not Android, not a plain browser). */
  static supported(): boolean {
    return isTauri() && !/android/i.test(navigator.userAgent);
  }

  get isOpen(): boolean {
    return this.view !== null;
  }

  private bounds() {
    const r = this.area.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
  }

  /** Opens `url`, replacing any page already shown. The area must be visible. */
  async open(url: string): Promise<void> {
    await this.close();
    // Once a window hosts several webviews, the main one must be told to keep
    // following the window size.
    await getCurrentWebview().setAutoResize(true);

    const view = new Webview(getCurrentWindow(), `embed-${++this.seq}`, { url, ...this.bounds() });
    await new Promise<void>((resolve, reject) => {
      void view.once("tauri://created", () => resolve());
      void view.once<string>("tauri://error", (e) => reject(new Error(String(e.payload))));
    });
    this.view = view;
    this.hiddenByUs = false;
    await this.sync();
  }

  async close(): Promise<void> {
    const view = this.view;
    this.view = null;
    if (view) await view.close().catch((e) => console.warn("closing embedded page failed", e));
  }

  /** Temporarily hides the page, e.g. while a dialog is open. */
  async hide(): Promise<void> {
    if (!this.view) return;
    this.hiddenByUs = true;
    await this.view.hide();
  }

  async show(): Promise<void> {
    if (!this.view || !this.hiddenByUs) return;
    this.hiddenByUs = false;
    await this.view.show();
    await this.sync();
  }

  /** Moves the native webview to match the area's current position and size. */
  private async sync(): Promise<void> {
    if (!this.view) return;
    const b = this.bounds();
    await Promise.all([
      this.view.setPosition(new LogicalPosition(b.x, b.y)),
      this.view.setSize(new LogicalSize(b.width, b.height)),
    ]).catch((e) => console.warn("positioning embedded page failed", e));
  }
}

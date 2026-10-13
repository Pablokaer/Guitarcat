/** Per-device settings, kept in the webview's localStorage. */
export interface Settings {
  serverUrl: string;
  spotifyFallback: boolean;
  followOffsetSec: number;
  follow: boolean;
  zoom: number;
  /** Keep the in-app Songsterr panel open, following each new song (desktop). */
  songsterrPanel: boolean;
}

const KEY = "tabsync.settings";

function defaultServerUrl(): string {
  // Android emulator reaches the host machine through 10.0.2.2.
  return /android/i.test(navigator.userAgent) ? "http://10.0.2.2:8787" : "http://127.0.0.1:8787";
}

export function loadSettings(): Settings {
  const defaults: Settings = {
    serverUrl: defaultServerUrl(),
    spotifyFallback: true,
    followOffsetSec: 0,
    follow: true,
    zoom: 1,
    songsterrPanel: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

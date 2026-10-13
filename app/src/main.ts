import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearCachedLookup, TabApi, trackKey } from "./api";
import { Detector } from "./detector";
import { EmbeddedPage } from "./embed";
import { loadSettings, saveSettings } from "./settings";
import "./styles.css";
import type { Song, SongsterrResult, TabInfo, Track } from "./types";
import { TabViewer } from "./viewer";

const POLL_MS = 1000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  title: $("np-title"),
  artist: $("np-artist"),
  source: $("np-source"),
  time: $("np-time"),
  progress: $("np-progress"),
  matchInfo: $("match-info"),
  tabSelect: $<HTMLSelectElement>("tab-select"),
  follow: $<HTMLButtonElement>("btn-follow"),
  wrong: $<HTMLButtonElement>("btn-wrong"),
  songsterr: $<HTMLButtonElement>("btn-songsterr"),
  embed: $("embed"),
  embedArea: $("embed-area"),
  embedTitle: $("embed-title"),
  embedBrowser: $<HTMLButtonElement>("btn-embed-browser"),
  embedClose: $<HTMLButtonElement>("btn-embed-close"),
  settingsBtn: $<HTMLButtonElement>("btn-settings"),
  banner: $("banner"),
  scroll: $("scroll"),
  panel: $("panel"),
  tab: $("tab"),
  dialog: $<HTMLDialogElement>("settings"),
  setServer: $<HTMLInputElement>("set-server"),
  setFallback: $<HTMLInputElement>("set-fallback"),
  setOffset: $<HTMLInputElement>("set-offset"),
  setOffsetOut: $<HTMLOutputElement>("set-offset-out"),
  setZoom: $<HTMLInputElement>("set-zoom"),
  setZoomOut: $<HTMLOutputElement>("set-zoom-out"),
  spotifyStatus: $("spotify-status"),
  spotifyBtn: $<HTMLButtonElement>("btn-spotify"),
  testBtn: $<HTMLButtonElement>("btn-test"),
};

const settings = loadSettings();
const api = new TabApi(settings.serverUrl);
api.setBaseUrl(settings.serverUrl);
const detector = new Detector(api, { fallbackEnabled: () => settings.spotifyFallback });
const viewer = new TabViewer(el.tab, el.scroll, settings.zoom);
const embed = EmbeddedPage.supported() ? new EmbeddedPage(el.embedArea) : null;

// ---- State -------------------------------------------------------------------
let current: Track | null = null; // last detector reading
let currentKey: string | null = null; // identity of the track we looked up
let currentSong: Song | null = null;
let songsterrBest: SongsterrResult | null = null; // best Songsterr match for the current track
let embedUrl: string | null = null; // page shown in the in-app panel, if open
let readAt = performance.now(); // when `current` was read, for smooth progress
let lookupSeq = 0; // discards stale lookups when tracks change quickly

// ---- Helpers -----------------------------------------------------------------
function fmt(ms?: number | null): string {
  if (ms == null || ms < 0) return "–:––";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function livePosition(): number | null {
  if (!current || current.positionMs == null) return null;
  const extra = current.isPlaying ? performance.now() - readAt : 0;
  return current.positionMs + extra;
}

function showBanner(html: string | null, kind: "info" | "warn" = "info") {
  el.banner.hidden = !html;
  el.banner.className = `banner ${kind}`;
  el.banner.innerHTML = html ?? "";
}

function showPanel(content: HTMLElement | null) {
  el.panel.replaceChildren(...(content ? [content] : []));
  el.panel.hidden = !content;
}

async function openExternal(url: string) {
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank");
}

/** Spotify titles carry noise ("- Remastered 2011", "(feat. X)") that hurts Songsterr's search. */
function songsterrQuery(t: Track): string {
  const title = t.title.replace(/\s+-\s+.*$/, "").replace(/\s*[([].*?[)\]]/g, "").trim();
  const artist = t.artist.split(/,|&| feat\. /i)[0].trim();
  return `${artist} ${title || t.title}`;
}

/** Songsterr's own search page, for tracks its search API didn't match. */
function songsterrSearchPage(track: Track): SongsterrResult {
  const q = songsterrQuery(track);
  return {
    songId: 0,
    title: `search “${q}”`,
    artist: "",
    instruments: [],
    url: `https://www.songsterr.com/?pattern=${encodeURIComponent(q)}`,
  };
}

/** Records the Songsterr match for `track` (null while searching). */
function setSongsterr(best: SongsterrResult | null, track: Track | null) {
  songsterrBest = best ?? (track ? songsterrSearchPage(track) : null);
  // On desktop the button toggles the panel, so it stays visible.
  el.songsterr.hidden = !embed && !best;
  el.songsterr.title = best ? `Show “${best.artist} – ${best.title}” from Songsterr` : "Search Songsterr";
  // Keep the open panel on the song that's playing.
  if (track && settings.songsterrPanel && embed && songsterrBest && songsterrBest.url !== embedUrl) {
    void openSongsterr(songsterrBest);
  }
}

/** Shows a Songsterr page inside the app (desktop) or in the browser (Android). */
async function openSongsterr(r: SongsterrResult) {
  if (!embed) return openExternal(r.url);
  if (!settings.songsterrPanel) {
    settings.songsterrPanel = true;
    saveSettings(settings);
  }
  embedUrl = r.url;
  el.embedTitle.textContent = `Songsterr · ${r.artist ? `${r.artist} – ${r.title}` : r.title}`;
  el.scroll.hidden = true;
  el.embed.hidden = false;
  el.songsterr.setAttribute("aria-pressed", "true");
  try {
    await embed.open(r.url);
  } catch (e) {
    await closeSongsterr();
    showBanner(`Could not show Songsterr in the app, opening the browser instead. <small>${escapeHtml(String(e))}</small>`, "warn");
    await openExternal(r.url);
  }
}

async function closeSongsterr() {
  settings.songsterrPanel = false;
  saveSettings(settings);
  embedUrl = null;
  await embed?.close();
  el.embed.hidden = true;
  el.scroll.hidden = false;
  el.songsterr.setAttribute("aria-pressed", "false");
  el.songsterr.hidden = !embed && !songsterrBest;
}

function songsterrList(results: SongsterrResult[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "candidates songsterr";
  wrap.innerHTML = `<h3>On Songsterr</h3>`;
  const list = document.createElement("ul");
  for (const r of results) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.innerHTML = `<strong>${escapeHtml(r.title)}</strong> <span class="muted">${escapeHtml(r.artist)}</span> <span class="score">↗</span><br /><small class="muted">${escapeHtml(r.instruments.slice(0, 4).join(" · "))}</small>`;
    b.onclick = () => void openSongsterr(r);
    li.appendChild(b);
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---- Rendering ---------------------------------------------------------------
function renderNowPlaying() {
  if (!current) {
    el.title.textContent = "Waiting for Spotify…";
    el.artist.textContent = "Play a song in Spotify on this device";
    el.source.hidden = true;
    el.time.textContent = "";
    el.progress.style.width = "0%";
    return;
  }
  el.title.textContent = current.title;
  el.artist.textContent = current.artist + (current.isPlaying ? "" : "  ·  paused");
  el.source.hidden = false;
  el.source.textContent = current.source === "os" ? "Device" : "Spotify API";
  el.source.title = current.player;
}

function tick() {
  const pos = livePosition();
  const dur = current?.durationMs ?? null;
  if (current && pos != null) {
    el.time.textContent = `${fmt(pos)} / ${fmt(dur)}`;
    el.progress.style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : "0%";
    if (settings.follow && currentSong && current.isPlaying) {
      viewer.follow(pos + settings.followOffsetSec * 1000);
    }
  }
  requestAnimationFrame(tick);
}

function candidateList(track: Track, songs: Song[], heading: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "candidates";
  wrap.innerHTML = `<h3>${escapeHtml(heading)}</h3>`;

  const list = document.createElement("ul");
  const fill = (items: Song[]) => {
    list.replaceChildren();
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No songs found.";
      list.appendChild(li);
    }
    for (const s of items) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.innerHTML = `<strong>${escapeHtml(s.title)}</strong> <span class="muted">${escapeHtml(s.artist)}</span>${
        s.score != null ? ` <span class="score">${Math.round(s.score * 100)}%</span>` : ""
      }${s.tabs.length === 0 ? ` <span class="muted">(no tabs yet)</span>` : ""}`;
      b.onclick = async () => {
        try {
          await api.confirm(track, s);
        } catch (e) {
          console.warn("confirm failed", e);
        }
        await openSong(s, "picked");
      };
      li.appendChild(b);
      list.appendChild(li);
    }
  };
  fill(songs);

  const form = document.createElement("form");
  form.className = "search";
  form.innerHTML = `<input type="search" placeholder="Search our tabs…" value="${escapeHtml(track.title)}" /><button>Search</button>`;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const q = (form.querySelector("input") as HTMLInputElement).value;
    try {
      fill((await api.search(q)).results);
    } catch (e) {
      showBanner(`Search failed: ${escapeHtml(String(e))}`, "warn");
    }
  };

  wrap.append(form, list);
  return wrap;
}

function fillTabSelect(tabs: TabInfo[], selected: number) {
  el.tabSelect.replaceChildren(
    ...tabs.map((t, i) => {
      const o = document.createElement("option");
      o.value = String(t.id);
      o.textContent = `${t.instrument} v${t.version}${t.isPlaceholder ? " (placeholder)" : ""}`;
      o.selected = i === selected;
      return o;
    }),
  );
  el.tabSelect.hidden = tabs.length < 2;
}

async function openTab(tab: TabInfo) {
  const { format, data } = await api.tab(tab);
  viewer.load(format, data);
}

async function openSong(song: Song, how: string) {
  currentSong = song;
  showPanel(null);
  const pct = how === "picked" ? "" : ` · ${how}`;
  el.matchInfo.textContent = `${song.artist} – ${song.title}${pct}`;
  if (song.tabs.length === 0) {
    viewer.clear();
    showBanner("This song has no tabs yet. Add one with <code>npm run import</code> on the server.");
    return;
  }
  const first = song.tabs[0];
  fillTabSelect(song.tabs, 0);
  showBanner(
    first.isPlaceholder
      ? "Showing a <b>placeholder exercise</b>, not the real tab. Use <b>Songsterr</b> to see the real one, or import your own tab."
      : null,
  );
  try {
    await openTab(first);
  } catch (e) {
    showBanner(`Could not load tab: ${escapeHtml(String(e))}`, "warn");
  }
}

// ---- Track changes -----------------------------------------------------------
async function onTrackChanged(track: Track) {
  const seq = ++lookupSeq;
  currentSong = null;
  viewer.hideHighlight();
  el.tabSelect.hidden = true;
  el.matchInfo.textContent = "Looking up tab…";
  showPanel(null);
  setSongsterr(null, null);
  const songsterr = api.songsterrSearch(songsterrQuery(track)).catch((e) => {
    console.warn("songsterr search failed", e);
    return [] as SongsterrResult[];
  });
  void songsterr.then((rs) => {
    if (seq === lookupSeq) setSongsterr(rs[0] ?? null, track);
  });
  try {
    const r = await api.lookup(track);
    if (seq !== lookupSeq) return; // a newer track arrived meanwhile
    if (r.match) {
      const how = r.method === "fuzzy" ? `fuzzy ${Math.round(r.confidence * 100)}%` : r.method;
      await openSong(r.match, how);
    } else {
      viewer.clear();
      el.matchInfo.textContent = "No confident match";
      showBanner(null);
      const panel = document.createElement("div");
      panel.appendChild(
        candidateList(track, r.candidates, r.candidates.length ? "Is it one of these?" : "Not in our catalogue yet. Search:"),
      );
      showPanel(panel);
      const rs = await songsterr;
      if (seq === lookupSeq && rs.length) panel.appendChild(songsterrList(rs));
    }
  } catch (e) {
    if (seq !== lookupSeq) return;
    el.matchInfo.textContent = "";
    showBanner(
      `Can't reach the tab server at <code>${escapeHtml(settings.serverUrl)}</code>. Check Settings. <small>${escapeHtml(String(e))}</small>`,
      "warn",
    );
    currentKey = null; // retry on the next poll
  }
}

async function poll() {
  const track = await detector.read();
  current = track;
  readAt = performance.now();
  renderNowPlaying();

  if (detector.status.kind === "error") {
    showBanner(`Detector: ${escapeHtml(detector.status.message)}`, "warn");
  }

  if (track) {
    const key = trackKey(track);
    if (key !== currentKey) {
      currentKey = key;
      void onTrackChanged(track);
    }
  }
}

// ---- Permission (Android) ----------------------------------------------------
async function ensurePermission(): Promise<void> {
  if (await detector.checkPermission()) return;
  const box = document.createElement("div");
  box.className = "candidates";
  box.innerHTML = `<h3>Allow TabSync to see what's playing</h3>
    <p>Android only shares the current song with apps that have <b>Notification access</b>.
    Tap the button, enable <b>TabSync</b>, then come back.</p>`;
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Open settings";
  btn.onclick = () => detector.requestPermission();
  box.appendChild(btn);
  showPanel(box);

  // Re-check when the user returns to the app.
  await new Promise<void>((resolve) => {
    const check = async () => {
      if (document.visibilityState === "visible" && (await detector.checkPermission())) {
        document.removeEventListener("visibilitychange", check);
        showPanel(null);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", check);
  });
}

// ---- Settings dialog ----------------------------------------------------------
async function refreshSpotifyStatus() {
  try {
    const s = await api.spotifyStatus();
    el.spotifyStatus.textContent = !s.configured
      ? "Spotify: not configured on server"
      : s.connected
        ? "Spotify: connected"
        : "Spotify: not connected";
    el.spotifyBtn.disabled = !s.configured;
  } catch {
    el.spotifyStatus.textContent = "Spotify: server unreachable";
  }
}

function bindSettings() {
  el.setServer.value = settings.serverUrl;
  el.setFallback.checked = settings.spotifyFallback;
  el.setOffset.value = String(settings.followOffsetSec);
  el.setOffsetOut.textContent = `${settings.followOffsetSec.toFixed(1)} s`;
  el.setZoom.value = String(settings.zoom);
  el.setZoomOut.textContent = `${Math.round(settings.zoom * 100)}%`;
  el.follow.setAttribute("aria-pressed", String(settings.follow));

  el.settingsBtn.onclick = () => {
    void embed?.hide();
    el.dialog.showModal();
    void refreshSpotifyStatus();
  };
  el.setServer.onchange = () => {
    settings.serverUrl = el.setServer.value.trim().replace(/\/+$/, "");
    api.setBaseUrl(settings.serverUrl);
    saveSettings(settings);
    currentKey = null; // look the current song up again on the new server
    void refreshSpotifyStatus();
  };
  el.setFallback.onchange = () => {
    settings.spotifyFallback = el.setFallback.checked;
    saveSettings(settings);
  };
  el.setOffset.oninput = () => {
    settings.followOffsetSec = Number(el.setOffset.value);
    el.setOffsetOut.textContent = `${settings.followOffsetSec.toFixed(1)} s`;
    saveSettings(settings);
  };
  el.setZoom.onchange = () => {
    settings.zoom = Number(el.setZoom.value);
    el.setZoomOut.textContent = `${Math.round(settings.zoom * 100)}%`;
    saveSettings(settings);
    viewer.setZoom(settings.zoom);
  };
  el.spotifyBtn.onclick = () => openExternal(api.spotifyLoginUrl());
  if (embed) {
    el.songsterr.classList.add("toggle");
    el.songsterr.setAttribute("aria-pressed", "false");
    el.songsterr.textContent = "Songsterr";
  }
  el.songsterr.onclick = () => {
    if (embedUrl) void closeSongsterr();
    else if (songsterrBest) void openSongsterr(songsterrBest);
  };
  el.embedClose.onclick = () => void closeSongsterr();
  el.embedBrowser.onclick = () => {
    if (embedUrl) void openExternal(embedUrl);
  };
  // The native Songsterr view draws above the DOM, so get it out of the dialog's way.
  el.dialog.addEventListener("close", () => void embed?.show());
  el.testBtn.onclick = async () => {
    try {
      await api.health();
      el.testBtn.textContent = "Server OK ✓";
    } catch {
      el.testBtn.textContent = "Unreachable ✗";
    }
    setTimeout(() => (el.testBtn.textContent = "Test server"), 2500);
  };

  el.follow.onclick = () => {
    settings.follow = !settings.follow;
    el.follow.setAttribute("aria-pressed", String(settings.follow));
    if (!settings.follow) viewer.hideHighlight();
    saveSettings(settings);
  };
  el.wrong.onclick = async () => {
    if (!current) return;
    clearCachedLookup(current);
    showPanel(candidateList(current, [], "Pick the right song"));
    try {
      const r = await api.search(current.title);
      showPanel(candidateList(current, r.results, "Pick the right song"));
    } catch {
      /* keep the empty list with its search box */
    }
  };
  el.tabSelect.onchange = async () => {
    const tab = currentSong?.tabs.find((t) => String(t.id) === el.tabSelect.value);
    if (tab) await openTab(tab);
  };
}

// ---- Boot --------------------------------------------------------------------
async function main() {
  bindSettings();
  requestAnimationFrame(tick);
  if (!isTauri()) {
    showBanner("Running in a browser: device detection is off, only the Spotify Web API fallback works.");
  }
  await ensurePermission();
  await poll();
  setInterval(() => void poll(), POLL_MS);
}

void main();

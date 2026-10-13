/**
 * Optional Spotify Web API fallback.
 *
 * The OS-level detectors on each device are the primary source. This module is only
 * used when the device sees nothing locally, e.g. when Spotify plays on another
 * device via Spotify Connect. Login happens once, in a browser on the machine that
 * runs this server (Authorization Code + PKCE, no client secret needed), and the
 * tokens are stored server-side so every client (desktop or Android) can use them.
 *
 * MVP limitation: one Spotify account per server (personal use / Development Mode).
 */
import crypto from "node:crypto";
import { deleteSetting, getSetting, setSetting, type Db } from "./db.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = "user-read-currently-playing user-read-playback-state";

export interface SpotifyConfig {
  clientId?: string;
  redirectUri: string;
}

/** Same shape the device detectors return, so the client treats both alike. */
export interface NowPlayingTrack {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  positionMs?: number;
  isPlaying: boolean;
  spotifyId?: string;
  source: "os" | "spotify-api";
  player: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

const TOKENS_KEY = "spotify.tokens";
const pendingLogins = new Map<string, { verifier: string; createdAt: number }>();

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildLoginUrl(cfg: SpotifyConfig): string {
  if (!cfg.clientId) throw new Error("SPOTIFY_CLIENT_ID is not set");
  // Drop stale login attempts (older than 10 minutes).
  for (const [k, v] of pendingLogins) if (Date.now() - v.createdAt > 600_000) pendingLogins.delete(k);

  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  pendingLogins.set(state, { verifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    scope: SCOPES,
    redirect_uri: cfg.redirectUri,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens & { refreshToken?: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? "",
    expiresAt: Date.now() + (j.expires_in - 60) * 1000,
  };
}

export async function handleCallback(db: Db, cfg: SpotifyConfig, code: string, state: string): Promise<void> {
  const pending = pendingLogins.get(state);
  if (!pending) throw new Error("Unknown or expired login state. Start the login again.");
  pendingLogins.delete(state);
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId!,
    code_verifier: pending.verifier,
  });
  setSetting(db, TOKENS_KEY, JSON.stringify(t));
}

function loadTokens(db: Db): Tokens | null {
  const raw = getSetting(db, TOKENS_KEY);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}

async function accessToken(db: Db, cfg: SpotifyConfig): Promise<string | null> {
  const t = loadTokens(db);
  if (!t) return null;
  if (Date.now() < t.expiresAt) return t.accessToken;
  const fresh = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: t.refreshToken,
    client_id: cfg.clientId!,
  });
  // Spotify may or may not rotate the refresh token.
  const next: Tokens = { ...fresh, refreshToken: fresh.refreshToken || t.refreshToken };
  setSetting(db, TOKENS_KEY, JSON.stringify(next));
  return next.accessToken;
}

export function isConnected(db: Db): boolean {
  return loadTokens(db) !== null;
}

export function disconnect(db: Db): void {
  deleteSetting(db, TOKENS_KEY);
}

// Tiny cache so several clients polling at once only cost one Spotify call.
let cache: { at: number; value: NowPlayingTrack | null } | null = null;
const CACHE_MS = 2_000;

export async function currentlyPlaying(db: Db, cfg: SpotifyConfig): Promise<NowPlayingTrack | null> {
  if (!cfg.clientId) return null;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const token = await accessToken(db, cfg);
  if (!token) return null;

  const res = await fetch(`${API}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let value: NowPlayingTrack | null = null;
  if (res.status === 200) {
    const j = (await res.json()) as {
      is_playing: boolean;
      progress_ms: number | null;
      currently_playing_type: string;
      item: null | {
        id: string;
        name: string;
        duration_ms: number;
        artists?: { name: string }[];
        album?: { name: string };
      };
    };
    // Ads, podcasts and unknown items are ignored.
    if (j.item && j.currently_playing_type === "track") {
      value = {
        title: j.item.name,
        artist: (j.item.artists ?? []).map((a) => a.name).join(", "),
        album: j.item.album?.name,
        durationMs: j.item.duration_ms,
        positionMs: j.progress_ms ?? undefined,
        isPlaying: j.is_playing,
        spotifyId: j.item.id,
        source: "spotify-api",
        player: "Spotify (Web API)",
      };
    }
  } else if (res.status === 401) {
    // Token revoked: force a new login.
    disconnect(db);
  } else if (res.status !== 204) {
    throw new Error(`Spotify API error ${res.status}`);
  }
  cache = { at: Date.now(), value };
  return value;
}

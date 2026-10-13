/** What the detectors report. Same shape for the OS plugin and the Spotify fallback. */
export interface Track {
  title: string;
  artist: string;
  album?: string | null;
  durationMs?: number | null;
  positionMs?: number | null;
  isPlaying: boolean;
  spotifyId?: string | null;
  source: "os" | "spotify-api";
  player: string;
}

export interface TabInfo {
  id: number;
  instrument: string;
  tuning: string | null;
  format: "alphatex" | "gp" | "musicxml";
  version: number;
  rating: number | null;
  isPlaceholder: boolean;
}

export interface Song {
  id: number;
  title: string;
  artist: string;
  durationMs: number | null;
  tabs: TabInfo[];
  score?: number;
}

/** A song in Songsterr's catalogue. Only a link: the tab itself stays on Songsterr. */
export interface SongsterrResult {
  songId: number;
  title: string;
  artist: string;
  instruments: string[];
  url: string;
}

export interface LookupResponse {
  match: Song | null;
  confidence: number;
  method: "external-id" | "exact" | "fuzzy" | "none";
  candidates: Song[];
}

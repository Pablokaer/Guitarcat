import { allSongs, findSongExact, songByExternalId, type Db, type SongRow } from "./db.js";
import { normalizeTitle, similarity, splitArtists } from "./normalize.js";

export interface LookupQuery {
  title: string;
  artist: string;
  durationMs?: number;
  spotifyId?: string;
}

export interface ScoredSong {
  song: SongRow;
  score: number;
}

export interface LookupResult {
  /** Best match when we are confident enough to open it automatically. */
  match: SongRow | null;
  confidence: number;
  method: "external-id" | "exact" | "fuzzy" | "none";
  /** Ranked alternatives, so the user can correct a wrong match. */
  candidates: ScoredSong[];
}

/** Confidence above which the client opens the tab without asking. */
export const AUTO_ACCEPT = 0.82;
/** Candidates below this are not shown at all. */
export const MIN_CANDIDATE = 0.35;

const TITLE_WEIGHT = 0.65;
const ARTIST_WEIGHT = 0.35;

/** Score one stored song against a query, in [0, 1]. */
export function scoreSong(
  song: SongRow,
  q: { titleNorm: string; artists: string[]; durationMs?: number },
): number {
  const titleSim = similarity(q.titleNorm, song.title_norm);
  const artistSim = Math.max(0, ...q.artists.map((a) => similarity(a, song.artist_norm)));
  let score = TITLE_WEIGHT * titleSim + ARTIST_WEIGHT * artistSim;

  // Duration is a tie-breaker: different recordings of the same title by the same
  // artist are common (live, acoustic). Small bonus when close, penalty when far.
  if (q.durationMs && song.duration_ms) {
    const diff = Math.abs(q.durationMs - song.duration_ms);
    if (diff <= 3_000) score += 0.05;
    else if (diff > 30_000) score -= 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

export function lookup(db: Db, q: LookupQuery, limit = 5): LookupResult {
  // 1. Exact external ID (user-confirmed links). Instant and certain.
  if (q.spotifyId) {
    const song = songByExternalId(db, "spotify", q.spotifyId);
    if (song) return { match: song, confidence: 1, method: "external-id", candidates: [{ song, score: 1 }] };
  }

  // 2. Exact normalized title + artist (try each individual artist).
  const artists = splitArtists(q.artist);
  for (const a of artists) {
    const song = findSongExact(db, q.title, a);
    if (song) return { match: song, confidence: 0.97, method: "exact", candidates: [{ song, score: 0.97 }] };
  }

  // 3. Fuzzy over all songs. Fine for an MVP catalogue (tens of thousands of rows).
  //    For a large catalogue, move this to Postgres + pg_trgm (same similarity metric).
  const titleNorm = normalizeTitle(q.title);
  const scored = allSongs(db)
    .map((song) => ({ song, score: scoreSong(song, { titleNorm, artists, durationMs: q.durationMs }) }))
    .filter((s) => s.score >= MIN_CANDIDATE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ ...s, score: Math.round(s.score * 1000) / 1000 }));

  const best = scored[0];
  if (best && best.score >= AUTO_ACCEPT) {
    return { match: best.song, confidence: best.score, method: "fuzzy", candidates: scored };
  }
  return { match: null, confidence: best?.score ?? 0, method: "none", candidates: scored };
}

/** Free-text search for the manual "find the right song" box in the app. */
export function search(db: Db, text: string, limit = 20): ScoredSong[] {
  const qn = normalizeTitle(text);
  if (!qn) return [];
  return allSongs(db)
    .map((song) => {
      const combined = `${song.artist_norm} ${song.title_norm}`;
      const score = Math.max(
        similarity(qn, song.title_norm),
        similarity(qn, song.artist_norm),
        similarity(qn, combined),
        combined.includes(qn) ? 0.9 : 0,
      );
      return { song, score };
    })
    .filter((s) => s.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

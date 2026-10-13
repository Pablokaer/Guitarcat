// Songsterr catalogue search. Songsterr has no official API: this uses the public
// search endpoint their site calls, and only returns links. Tab content stays on
// Songsterr (their terms don't allow copying it), so the app opens it there.

const SEARCH_URL = "https://www.songsterr.com/api/songs";
const TIMEOUT_MS = 5000;

export interface SongsterrResult {
  songId: number;
  title: string;
  artist: string;
  instruments: string[];
  url: string;
}

interface RawSong {
  songId: number;
  title: string;
  artist: string;
  isJunk?: boolean;
  tracks?: { instrument: string }[];
}

/** Stable link: Songsterr redirects it to the song's canonical page. */
export function songUrl(songId: number): string {
  return `https://www.songsterr.com/a/wa/song?id=${songId}`;
}

export async function searchSongsterr(
  query: string,
  fetchImpl: typeof fetch = fetch,
  size = 5,
): Promise<SongsterrResult[]> {
  const url = `${SEARCH_URL}?${new URLSearchParams({ pattern: query, size: String(size) })}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Songsterr search → ${res.status}`);
  const songs = (await res.json()) as RawSong[];
  return songs
    .filter((s) => !s.isJunk)
    .map((s) => ({
      songId: s.songId,
      title: s.title,
      artist: s.artist,
      instruments: [...new Set((s.tracks ?? []).map((t) => t.instrument))],
      url: songUrl(s.songId),
    }));
}

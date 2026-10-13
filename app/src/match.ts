import type { SongsterrResult, Track } from "./types";

/** Spotify titles carry noise ("- Remastered 2011", "(feat. X)") that hurts Songsterr's search. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+-\s+.*$/, "").replace(/\s*[([].*?[)\]]/g, "").trim() || title;
}

export function mainArtist(artist: string): string {
  return artist.split(/,|&| feat\. /i)[0].trim();
}

export function songsterrQuery(t: Pick<Track, "title" | "artist">): string {
  return `${mainArtist(t.artist)} ${cleanTitle(t.title)}`;
}

/** Songsterr's own search page, for tracks its search API didn't match. */
export function songsterrSearchPage(query: string): SongsterrResult {
  return {
    songId: 0,
    title: `search “${query}”`,
    artist: "",
    instruments: [],
    url: `https://www.songsterr.com/?pattern=${encodeURIComponent(query)}`,
  };
}

/** Lowercase, no accents, no punctuation, no leading "the". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");
}

function same(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "Song" vs "Song (Live)" style differences that survived cleaning.
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 4 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`));
}

/**
 * Whether Songsterr's result is the same song as the track: title and one of the
 * track's artists both match. Search order alone is not treated as evidence.
 */
export function isConfidentMatch(track: Pick<Track, "title" | "artist">, r: Pick<SongsterrResult, "title" | "artist" | "songId">): boolean {
  if (r.songId <= 0) return false;
  const artists = track.artist.split(/,|&| feat\. /i).map((a) => a.trim()).filter(Boolean);
  return same(cleanTitle(track.title), r.title) && artists.some((a) => same(a, r.artist));
}

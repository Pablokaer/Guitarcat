/**
 * Seeds the database with a few well-known songs so you can test matching by
 * simply playing one of them on Spotify. Each gets a PLACEHOLDER exercise tab
 * (see seed/placeholder.ts), not the real tab for the song.
 *
 *   npm run seed            # add the demo songs (skips ones already present)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSongExact, insertSong, insertTab, openDb } from "../src/db.js";
import { chordExercise, scaleExercise } from "../seed/placeholder.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_FILE ?? path.join(here, "..", "data", "tabsync.db");

// Titles and artists only. Durations are approximate and only used as a tie-breaker.
const DEMO_SONGS: { title: string; artist: string; durationMs?: number }[] = [
  { title: "Wonderwall", artist: "Oasis", durationMs: 258_000 },
  { title: "Smells Like Teen Spirit", artist: "Nirvana", durationMs: 301_000 },
  { title: "Come As You Are", artist: "Nirvana", durationMs: 219_000 },
  { title: "Seven Nation Army", artist: "The White Stripes", durationMs: 232_000 },
  { title: "Hotel California", artist: "Eagles", durationMs: 391_000 },
  { title: "Knockin' On Heaven's Door", artist: "Bob Dylan", durationMs: 151_000 },
  { title: "Sweet Child O' Mine", artist: "Guns N' Roses", durationMs: 356_000 },
  { title: "Garota de Ipanema", artist: "Tom Jobim", durationMs: 324_000 },
  { title: "Tempo Perdido", artist: "Legião Urbana", durationMs: 302_000 },
  { title: "Wish You Were Here", artist: "Pink Floyd", durationMs: 334_000 },
];

const db = openDb(DB_FILE);
let added = 0;
db.transaction(() => {
  DEMO_SONGS.forEach((s, i) => {
    if (findSongExact(db, s.title, s.artist)) return;
    const song = insertSong(db, s);
    const label = `${s.artist} - ${s.title}`;
    const tex = i % 2 === 0 ? chordExercise(label) : scaleExercise(label);
    insertTab(db, { songId: song.id, format: "alphatex", content: Buffer.from(tex, "utf8"), isPlaceholder: true });
    added++;
  });
})();

console.log(`Seeded ${added} demo song(s) into ${DB_FILE}`);

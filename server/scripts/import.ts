/**
 * Import a tab file for a song.
 *
 *   npm run import -- --artist "Artist" --title "Song" --file ./song.gp
 *   npm run import -- --artist "Artist" --title "Song" --file ./song.alphatex --duration 245000
 *   npm run import -- --artist "Artist" --title "Song" --file ./song.gp --spotify-id 4uLU6hMCjMI75M1A2tKUQC
 *
 * Supported: .gp .gp3 .gp4 .gp5 .gpx .gp7 (Guitar Pro), .alphatex/.atex/.tex (alphaTex),
 * .xml/.musicxml (MusicXML). The song is created if it does not exist yet.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findSongExact, insertSong, insertTab, linkExternalId, openDb, type TabFormat } from "../src/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_FILE ?? path.join(here, "..", "data", "tabsync.db");

const { values } = parseArgs({
  options: {
    artist: { type: "string" },
    title: { type: "string" },
    file: { type: "string" },
    duration: { type: "string" },
    instrument: { type: "string", default: "guitar" },
    tuning: { type: "string" },
    "spotify-id": { type: "string" },
  },
});

if (!values.artist || !values.title || !values.file) {
  console.error('Usage: npm run import -- --artist "Artist" --title "Song" --file ./song.gp [--duration ms] [--spotify-id id]');
  process.exit(1);
}

function formatFor(file: string): TabFormat {
  const ext = path.extname(file).toLowerCase();
  if ([".gp", ".gp3", ".gp4", ".gp5", ".gpx", ".gp7"].includes(ext)) return "gp";
  if ([".alphatex", ".atex", ".tex"].includes(ext)) return "alphatex";
  if ([".xml", ".musicxml"].includes(ext)) return "musicxml";
  throw new Error(`Unsupported file extension: ${ext}`);
}

const db = openDb(DB_FILE);
const format = formatFor(values.file);
const content = fs.readFileSync(values.file);

const song =
  findSongExact(db, values.title, values.artist) ??
  insertSong(db, {
    title: values.title,
    artist: values.artist,
    durationMs: values.duration ? Number(values.duration) : null,
  });

const tabId = insertTab(db, {
  songId: song.id,
  format,
  content,
  instrument: values.instrument,
  tuning: values.tuning ?? null,
});
if (values["spotify-id"]) linkExternalId(db, song.id, "spotify", values["spotify-id"]);

console.log(`Imported ${format} tab #${tabId} for "${song.artist} - ${song.title}" (song #${song.id})`);

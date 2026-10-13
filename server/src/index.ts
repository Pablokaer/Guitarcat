import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8787);
// 0.0.0.0 so an Android phone on the same Wi-Fi can reach the server.
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_FILE = process.env.DB_FILE ?? path.join(here, "..", "data", "tabsync.db");

const db = openDb(DB_FILE);
const app = buildApp({
  db,
  logger: true,
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    // Spotify only allows loopback IP literals (not "localhost") for http redirects.
    redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? `http://127.0.0.1:${PORT}/auth/spotify/callback`,
  },
});

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

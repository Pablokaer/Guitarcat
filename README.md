# TabSync MVP

TabSync runs alongside Spotify. When the song changes, it detects the new track, looks it up in your tab server and shows the tab, scrolling it in time with the song.

| Platform | How it detects the song | Status |
|---|---|---|
| macOS | AppleScript query to the Spotify app (`osascript`) | ✅ |
| Windows | Windows media controls API (SMTC), the API behind the media overlay | ✅ |
| Android | `MediaSessionManager`, after the user grants Notification access | ✅ |
| Any platform (fallback) | Spotify Web API, called through the server | ✅ optional |
| Linux / iOS | — (Linux uses only the Web API fallback; iOS can't read other apps' playback) | ❌ |

```
tabsync/
├── server/                         "Our system": tab lookup API (Node + TypeScript + SQLite)
│   ├── src/normalize.ts            title/artist normalization + trigram similarity
│   ├── src/matching.ts             lookup: external ID → exact → fuzzy
│   ├── src/app.ts                  HTTP API (Fastify)
│   ├── src/spotify.ts              optional Spotify Web API fallback (PKCE, tokens stored server-side)
│   ├── scripts/seed.ts             demo songs with PLACEHOLDER exercise tabs
│   ├── scripts/import.ts           import your own .gp / .alphatex / .musicxml tabs
│   └── test/                       vitest tests
└── app/                            Tauri 2 app (desktop + Android)
    ├── src/                        UI: detector loop, lookup client, alphaTab viewer
    ├── src-tauri/                  Rust app shell
    └── plugins/tauri-plugin-nowplaying/
        ├── src/desktop.rs          macOS (AppleScript) + Windows (SMTC) detectors
        └── android/                Kotlin plugin + NotificationListenerService
```

## How it works

1. **Detect.** The app calls `plugin:nowplaying|get_now_playing` once per second. If the device reports nothing and the fallback is on, it asks the server for `/v1/spotify/now-playing` every 3 seconds.
2. **Identify.** The track is identified by its Spotify ID when available (macOS and Android), otherwise by artist + title. A lookup only runs when that identity changes.
3. **Look up.** The server calls `GET /v1/tabs/lookup?title&artist&durationMs&spotifyId` and tries three steps in order:
   1. a Spotify ID the user has already confirmed;
   2. an exact match on the normalized title and artist (it drops suffixes like "- Remastered 2011", "(feat. X)", "[Live]", accents and a leading "The", and tries each artist separately);
   3. a fuzzy trigram match, with song length as a tie-breaker.

   A score of 82% or higher opens the tab automatically. Below that, the app shows candidates and a search box. When the user picks a song, the Spotify ID is saved, so the next lookup is an exact hit.
4. **Show.** [alphaTab](https://alphatab.net) renders alphaTex, Guitar Pro 3–7 or MusicXML. **Follow** turns the song position into a bar number using the tab's tempo, then highlights that bar and scrolls to it.

## 1. Run the server

Requires Node 20 or later.

```bash
cd server
npm install
npm run seed      # 10 demo songs, each with a PLACEHOLDER exercise tab
npm run dev       # http://0.0.0.0:8787
npm test
```

> The seeded tabs are **generic practice exercises** (open chords and a C major scale). They are *not* the real tabs of those songs; they only let you test the whole flow by playing one of the demo songs on Spotify. Replace them with tabs you have the rights to use.

Import your own tab:

```bash
npm run import -- --artist "Artist" --title "Song" --file ./song.gp
npm run import -- --artist "Artist" --title "Song" --file ./song.alphatex --spotify-id <trackId>
```

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/tabs/lookup?title&artist&durationMs&spotifyId` | Match a track → `{ match, confidence, method, candidates }` |
| GET | `/v1/tabs/:id/content` | Raw tab file (`X-Tab-Format` header) |
| GET | `/v1/songs?q=` | Free-text search |
| POST | `/v1/songs` | Create a song `{ title, artist, durationMs? }` |
| POST | `/v1/songs/:id/tabs?format=gp\|alphatex\|musicxml` | Upload a tab (raw body) |
| POST | `/v1/songs/:id/external-ids` | Confirm a match `{ provider: "spotify", externalId }` |
| GET | `/auth/spotify/login` · `/auth/spotify/status` · `/v1/spotify/now-playing` | Spotify fallback |

## 2. Desktop app (macOS, Windows)

Prerequisites: [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/). That means Rust, plus Xcode Command Line Tools on macOS, or the MSVC Build Tools and WebView2 on Windows.

```bash
cd app
npm install
npm run tauri dev          # development
npm run tauri build        # installer: .dmg/.app (macOS), .msi/.exe (Windows)
```

- **macOS:** the first time TabSync reads Spotify, macOS asks permission to control Spotify. If you click "Don't Allow" by mistake, re-enable it in System Settings → Privacy & Security → Automation. In `tauri dev` the prompt names your terminal app instead of TabSync.
- **Windows:** no setup needed. Works with the Spotify desktop installer and the Microsoft Store version. SMTC doesn't expose the Spotify track ID, so Windows matches by artist and title only.
- In the **Tools** sidebar, the server URL defaults to `http://127.0.0.1:8787`.

## 3. Android app

Prerequisites: Android Studio, an SDK and an NDK, plus the Rust Android targets. See the [Tauri Android setup](https://v2.tauri.app/start/prerequisites/#android).

```bash
cd app
npx tauri android init     # generates src-tauri/gen/android (once)
npm run tauri android dev  # device or emulator
npm run tauri android build
```

- On first launch, the app opens **Notification access**. Turn on *TabSync*, then go back to the app. Android only shares other apps' media sessions with apps that have this access.
- In Settings, set the server URL to your computer's LAN IP (e.g. `http://192.168.1.20:8787`). The emulator uses `http://10.0.2.2:8787`.
- Release builds block plain HTTP by default. Either serve the API over HTTPS, or allow cleartext traffic for your server in the generated Android manifest.
- To use it alongside Spotify, run TabSync in split-screen or as the foreground app. Spotify keeps playing in the background.

## 4. Spotify Web API fallback (optional)

Only used when the device sees nothing, e.g. when you're controlling playback on another device via Spotify Connect.

1. Create an app at <https://developer.spotify.com/dashboard> and select the *Web API*.
2. Add this exact redirect URI: `http://127.0.0.1:8787/auth/spotify/callback`. Spotify requires `127.0.0.1` here; `localhost` won't work.
3. Start the server with your Client ID:
   ```bash
   SPOTIFY_CLIENT_ID=xxxx npm run dev
   ```
4. Open `http://127.0.0.1:8787/auth/spotify/login` in a browser **on the server machine** (or use Settings → *Connect Spotify* from the desktop app). Every client then uses the tokens stored on the server.

Development Mode requires the app owner to have Spotify Premium and allows up to 5 users. This MVP supports one Spotify account per server.

## 5. Songsterr

- On desktop, Songsterr is the main viewer. Each new Spotify song opens its Songsterr page (turn off *Follow Spotify* in the Tools sidebar to keep the current page). "Tablature found" is shown only when Songsterr's title and artist match the song; otherwise the closest result is shown as *No confident match*, and *Wrong tab?* lets you pick another, which is remembered for that song. On Android, Songsterr opens in the browser.
- Around the viewer: the Spotify player (expand, collapse to a strip, or hide), the navigation sidebar (History, Favorites, Recent Tabs; expanded, compact or hidden), the Tools sidebar and the toolbar. Each sidebar has its own hide button; the layout is saved. **Focus Mode** (⌘⇧F, Esc to leave) hides everything but the tab. Shortcuts are listed in the Tools sidebar and in the macOS *Layout* menu.
  - Hiding or resizing panels only moves the native Songsterr view; it never reloads the page.
  - Songsterr blocks iframes, so the panel is a native child webview laid over the window. That needs Tauri's `unstable` feature (enabled in `src-tauri/Cargo.toml`).
  - The server only uses Songsterr's public search; it never downloads or stores their tabs, and the app doesn't modify their page.

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/songsterr/search?q=` | Songsterr search results (links only) |

## 6. CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request: server typecheck and tests, app tests and build, plugin tests on macOS and a compile check on Windows.
- **Release** (`.github/workflows/release.yml`) builds the installable apps and attaches them to a GitHub release: a universal `.dmg` for macOS, `.msi` and `.exe` installers for Windows, and a universal `.apk` for Android.
  1. Set the new version in `app/src-tauri/tauri.conf.json` (and `app/src-tauri/Cargo.toml`).
  2. Push a matching tag: `git tag v0.2.0 && git push origin v0.2.0`. Every build runs, and the release is published when all succeed.
  - You can also run *Release* by hand from the Actions tab. It builds into a **draft** release, and publishes it only if you tick *publish*.
- **Android signing:** add the repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -i release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Without them each release is signed with a one-off key, so updating needs an uninstall first. Create a keystore once with `keytool -genkeypair -v -keystore release.jks -alias tabsync -keyalg RSA -keysize 2048 -validity 10000` and keep it safe: losing it means users must reinstall.
- **macOS signing (optional):** the builds are not notarized, so the first launch needs `xattr -cr /Applications/TabSync.app`. To sign and notarize, add the `APPLE_*` secrets listed in the workflow and pass them to the Tauri step.
- The Android build allows plain HTTP so the app can reach the TabSync server on your LAN.

## Known MVP limitations / next steps

- Follow mode ignores repeats, and tempo changes only take effect at bar boundaries. Use the offset slider to compensate. *Next: a real tempo map, or alphaTab's external-media sync.*
- Fuzzy matching scans every song in memory, which is fine up to a few tens of thousands of songs. *Next: Postgres + `pg_trgm`, which uses the same similarity metric.*
- macOS detection polls `osascript` every second. *Next: listen for Spotify's `com.spotify.client.PlaybackStateChanged` system notification so updates are instant.*
- Windows and Android support only Spotify. Removing the package or app-ID filter would allow other players.
- No authentication on the API. Add it before exposing the server outside your network.
- Tabs are copyrighted works. Only serve tabs you created, tabs licensed to you, or tabs from a licensed provider.

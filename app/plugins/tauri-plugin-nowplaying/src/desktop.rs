//! Desktop detectors. Each call does a fresh, synchronous read; the caller runs it
//! on a blocking thread.

use crate::models::NowPlayingResponse;
use crate::Result;

/// Read the current track from the OS. `track: None` when nothing is playing,
/// Spotify is closed, or an ad is playing.
pub fn read_now_playing() -> Result<NowPlayingResponse> {
    imp::read()
}

// ---------------------------------------------------------------------------
// macOS: AppleScript against the Spotify app.
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod imp {
    use std::process::Command;

    use crate::models::{spotify_track_id, NowPlayingResponse, Track};
    use crate::{Error, Result};

    // `application "Spotify" is running` is checked first so polling never
    // launches Spotify. Fields are separated by the ASCII unit separator (31),
    // which cannot appear in titles. Position is converted to integer ms inside
    // AppleScript so the decimal separator of the user's locale does not matter.
    const SCRIPT: &str = r#"
if application "Spotify" is running then
  tell application "Spotify"
    if player state is stopped then return ""
    set t to current track
    set sep to character id 31
    set pos to ((player position) * 1000) as integer
    return (name of t) & sep & (artist of t) & sep & (album of t) & sep & ((duration of t) as text) & sep & (pos as text) & sep & ((player state) as text) & sep & (id of t)
  end tell
end if
return ""
"#;

    pub fn read() -> Result<NowPlayingResponse> {
        let out = Command::new("/usr/bin/osascript").arg("-e").arg(SCRIPT).output()?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            // -1743: the user denied Automation access to Spotify.
            if err.contains("-1743") {
                return Err(Error::Detector(
                    "Automation access to Spotify was denied. Allow it in System Settings → Privacy & Security → Automation.".into(),
                ));
            }
            return Err(Error::Detector(err.trim().to_string()));
        }
        Ok(NowPlayingResponse { track: parse(&String::from_utf8_lossy(&out.stdout)) })
    }

    pub(super) fn parse(stdout: &str) -> Option<Track> {
        let line = stdout.trim_end_matches(['\n', '\r']);
        if line.is_empty() {
            return None;
        }
        let f: Vec<&str> = line.split('\u{1f}').collect();
        if f.len() < 7 {
            return None;
        }
        let uri = f[6];
        // Ads have URIs like spotify:ad:…; podcasts spotify:episode:…
        if uri.starts_with("spotify:ad:") || f[0].is_empty() {
            return None;
        }
        Some(Track {
            title: f[0].to_string(),
            artist: f[1].to_string(),
            album: Some(f[2].to_string()).filter(|s| !s.is_empty()),
            duration_ms: f[3].trim().parse().ok(),
            position_ms: f[4].trim().parse().ok(),
            is_playing: f[5].trim() == "playing",
            spotify_id: spotify_track_id(uri),
            source: "os".into(),
            player: "Spotify (macOS)".into(),
        })
    }
}

// ---------------------------------------------------------------------------
// Windows: Global System Media Transport Controls.
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod imp {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    use crate::models::{NowPlayingResponse, Track};
    use crate::{Error, Result};

    /// Windows FILETIME epoch (1601-01-01) to Unix epoch, in 100 ns ticks.
    const EPOCH_DIFF_100NS: i64 = 116_444_736_000_000_000;

    fn werr(e: windows::core::Error) -> Error {
        Error::Detector(format!("SMTC: {e}"))
    }

    fn now_unix_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// Prefer a Spotify session; fall back to the session Windows considers current
    /// only if it is Spotify too (MVP is Spotify-focused).
    fn find_spotify(mgr: &Manager) -> Result<Option<Session>> {
        let sessions = mgr.GetSessions().map_err(werr)?;
        for i in 0..sessions.Size().map_err(werr)? {
            let s = sessions.GetAt(i).map_err(werr)?;
            let id = s.SourceAppUserModelId().map_err(werr)?.to_string().to_lowercase();
            // "Spotify.exe" (installer) or "SpotifyAB.SpotifyMusic_…!Spotify" (Store).
            if id.contains("spotify") {
                return Ok(Some(s));
            }
        }
        Ok(None)
    }

    pub fn read() -> Result<NowPlayingResponse> {
        let mgr = Manager::RequestAsync().map_err(werr)?.get().map_err(werr)?;
        let Some(session) = find_spotify(&mgr)? else {
            return Ok(NowPlayingResponse { track: None });
        };

        let props = session.TryGetMediaPropertiesAsync().map_err(werr)?.get().map_err(werr)?;
        let title = props.Title().map_err(werr)?.to_string();
        let artist = props.Artist().map_err(werr)?.to_string();
        // Spotify reports ads with an empty artist (and a title like "Advertisement").
        if title.is_empty() || artist.is_empty() {
            return Ok(NowPlayingResponse { track: None });
        }
        let album = props.AlbumTitle().map(|s| s.to_string()).ok().filter(|s| !s.is_empty());

        let is_playing = session
            .GetPlaybackInfo()
            .and_then(|p| p.PlaybackStatus())
            .map(|s| s == Status::Playing)
            .unwrap_or(false);

        // Timeline values are in 100 ns units. Spotify only refreshes Position on
        // state changes, so extrapolate from LastUpdatedTime while playing.
        let (duration_ms, position_ms) = match session.GetTimelineProperties() {
            Ok(tl) => {
                let end = tl.EndTime().map(|t| t.Duration / 10_000).unwrap_or(0);
                let mut pos = tl.Position().map(|t| t.Duration / 10_000).unwrap_or(0);
                if is_playing {
                    if let Ok(updated) = tl.LastUpdatedTime() {
                        let updated_ms = (updated.UniversalTime - EPOCH_DIFF_100NS) / 10_000;
                        let elapsed = now_unix_ms() - updated_ms;
                        if (0..6 * 60 * 60 * 1000).contains(&elapsed) {
                            pos += elapsed;
                        }
                    }
                }
                if end > 0 {
                    pos = pos.min(end);
                }
                (
                    (end > 0).then_some(end as u64),
                    (pos >= 0).then_some(pos as u64),
                )
            }
            Err(_) => (None, None),
        };

        Ok(NowPlayingResponse {
            track: Some(Track {
                title,
                artist,
                album,
                duration_ms,
                position_ms,
                is_playing,
                // SMTC does not expose the Spotify track ID.
                spotify_id: None,
                source: "os".into(),
                player: "Spotify (Windows)".into(),
            }),
        })
    }
}

// ---------------------------------------------------------------------------
// Other desktops (Linux): not implemented in the MVP. The app falls back to the
// Spotify Web API through the server. MPRIS over D-Bus would go here.
// ---------------------------------------------------------------------------
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use crate::models::NowPlayingResponse;
    use crate::Result;

    pub fn read() -> Result<NowPlayingResponse> {
        Ok(NowPlayingResponse { track: None })
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn parses_osascript_output() {
        let line = "Song\u{1f}Artist\u{1f}Album\u{1f}245000\u{1f}12345\u{1f}playing\u{1f}spotify:track:abc\n";
        let t = super::imp::parse(line).unwrap();
        assert_eq!(t.title, "Song");
        assert_eq!(t.duration_ms, Some(245000));
        assert_eq!(t.position_ms, Some(12345));
        assert!(t.is_playing);
        assert_eq!(t.spotify_id.as_deref(), Some("abc"));
    }

    #[test]
    fn ignores_ads() {
        let line = "Ad\u{1f}\u{1f}\u{1f}30000\u{1f}0\u{1f}playing\u{1f}spotify:ad:xyz";
        assert!(super::imp::parse(line).is_none());
    }
}

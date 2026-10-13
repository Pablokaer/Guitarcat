use serde::{Deserialize, Serialize};

/// The currently playing track, as reported by the OS (or Spotify's Web API).
/// Field names are camelCase on the wire; the Kotlin side uses the same keys.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    /// Playback position at the moment of the read (already extrapolated).
    #[serde(default)]
    pub position_ms: Option<u64>,
    pub is_playing: bool,
    /// Bare Spotify track ID (no `spotify:track:` prefix) when the OS exposes it.
    #[serde(default)]
    pub spotify_id: Option<String>,
    /// "os" for device detectors.
    pub source: String,
    /// Which player reported it, e.g. "Spotify (macOS)".
    pub player: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingResponse {
    #[serde(default)]
    pub track: Option<Track>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub granted: bool,
}

/// `spotify:track:abc` -> `abc`. Returns None for ads/episodes/local files.
pub fn spotify_track_id(uri: &str) -> Option<String> {
    uri.strip_prefix("spotify:track:")
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

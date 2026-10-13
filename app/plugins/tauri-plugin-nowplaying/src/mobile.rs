use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{NowPlayingResponse, PermissionResponse};

#[cfg(target_os = "ios")]
compile_error!("tauri-plugin-nowplaying: iOS is not supported (iOS does not expose other apps' now-playing info).");

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.tabsync.nowplaying";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NowPlaying<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "NowPlayingPlugin")?;
    Ok(NowPlaying(handle))
}

/// Handle to the Kotlin `NowPlayingPlugin`.
pub struct NowPlaying<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NowPlaying<R> {
    pub fn get_now_playing(&self) -> crate::Result<NowPlayingResponse> {
        self.0.run_mobile_plugin("getNowPlaying", ()).map_err(Into::into)
    }

    pub fn check_permission(&self) -> crate::Result<PermissionResponse> {
        self.0.run_mobile_plugin("checkPermission", ()).map_err(Into::into)
    }

    pub fn request_permission(&self) -> crate::Result<PermissionResponse> {
        self.0.run_mobile_plugin("requestPermission", ()).map_err(Into::into)
    }
}

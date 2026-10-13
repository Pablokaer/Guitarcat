const COMMANDS: &[&str] = &["get_now_playing", "check_permission", "request_permission"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}

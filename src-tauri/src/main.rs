// Prevent an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // Local-vault filesystem commands will be registered here later
        // (e.g. .invoke_handler(tauri::generate_handler![...])).
        .run(tauri::generate_context!())
        .expect("error while running the Siddran desktop app");
}

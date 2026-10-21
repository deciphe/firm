// FIRM for Windows: one window running the game page bundled into the binary.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("FIRM failed to start");
}

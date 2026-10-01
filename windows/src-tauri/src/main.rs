// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Windows only: Claude runs `Konscious.exe hook …` for status events. Exit
    // before any UI code loads. (macOS hooks are plain `sh` commands.)
    #[cfg(windows)]
    if let Some(code) = konscious_lib::helper_main() {
        std::process::exit(code);
    }
    konscious_lib::run()
}

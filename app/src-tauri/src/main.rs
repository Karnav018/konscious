// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Hook helper mode (Windows): exit before any UI code loads.
    if let Some(code) = kova_lib::helper_main() {
        std::process::exit(code);
    }
    kova_lib::run()
}

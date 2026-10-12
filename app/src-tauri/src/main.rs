// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Windows only: Claude runs `Konscious.exe hook …` for status events. Exit
    // before any UI code loads. (macOS and Linux hooks are plain `sh` commands.)
    #[cfg(windows)]
    if let Some(code) = konscious_lib::helper_main() {
        std::process::exit(code);
    }
    // Linux: WebKitGTK's DMA-BUF renderer leaves the window blank on many
    // NVIDIA and Wayland setups. Turn it off unless someone chose otherwise.
    // Set before any thread starts, while nothing else reads the environment.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    konscious_lib::run()
}

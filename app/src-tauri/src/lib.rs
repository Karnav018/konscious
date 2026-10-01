mod claude;
mod commands;
mod env;
mod error;
mod git;
mod persistence;
mod session;
mod suggest;
mod sync;
mod terminal;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Wry};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use env::EnvHandle;
use persistence::Store;
use session::manager::{Emitter as SessionEmitter, SessionManager};

pub struct AppState {
    pub env: Arc<EnvHandle>,
    pub sessions: Arc<SessionManager>,
    pub store: Arc<Store>,
    /// False when another instance holds ~/.claude-workspace/.lock.
    pub lock_ok: bool,
}

fn window_flags() -> StateFlags {
    // Not DECORATIONS (fights the overlay title bar) and not VISIBLE (the
    // frontend shows the window after the first themed paint).
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

/// `~/.kova` (override: KOVA_HOME; CLAUDE_WORKSPACE_HOME still honoured).
/// Data from the pre-rename `~/.claude-workspace` is moved over once.
fn base_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("KOVA_HOME").or_else(|| std::env::var_os("CLAUDE_WORKSPACE_HOME")) {
        return PathBuf::from(p);
    }
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()));
    let (kova, legacy) = (home.join(".kova"), home.join(".claude-workspace"));
    if !kova.exists() && legacy.is_dir() {
        let _ = std::fs::rename(&legacy, &kova);
    }
    kova
}

/// GUI apps start with a soft limit of 256 fds; each PTY session uses several.
fn raise_fd_limit() {
    unsafe {
        let mut rl = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut rl) == 0 {
            let target = rl.rlim_max.min(10_240);
            if rl.rlim_cur < target {
                rl.rlim_cur = target;
                libc::setrlimit(libc::RLIMIT_NOFILE, &rl);
            }
        }
    }
}

/// The default macOS menu binds ⌘W to "Close Window", which would end every
/// session. Ours keeps Copy/Paste (xterm needs the native Edit actions) and
/// leaves ⌘A to the frontend so it can select the terminal buffer.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let sep = || PredefinedMenuItem::separator(app);
    let app_menu = Submenu::with_items(
        app,
        "Kova",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Kova"), None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    raise_fd_limit();
    let store = Arc::new(Store::new(base_dir()));
    let lock_ok = store.acquire_lock();
    let env = EnvHandle::new();
    env.resolve_in_background(store.claude_path_override());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(window_flags()).build())
        .setup(move |app| {
            let handle = app.handle().clone();
            let emit: SessionEmitter = Arc::new(move |name, payload| {
                let _ = handle.emit(name, payload);
            });
            let sessions = SessionManager::new(emit, Arc::clone(&env), store.run_dir());
            sessions.start_ticker();
            app.manage(AppState { env, sessions, store, lock_ok });
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_init,
            commands::app_env,
            commands::state_load,
            commands::state_save,
            commands::state_delete_layout,
            commands::session_start,
            commands::session_attach,
            commands::session_list,
            commands::session_stop,
            commands::session_kill,
            commands::session_restart,
            commands::session_new_conversation,
            commands::session_remove,
            commands::usage_snapshot,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_ack,
            commands::git_info,
            commands::fs_subdirs,
            commands::fs_suggest_folders,
            commands::fs_is_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kova");

    app.run(|app, event| {
        // ⌘Q / Dock Quit on macOS deliver only `Exit` (never `ExitRequested`),
        // so all cleanup lives here. `shutdown` is idempotent.
        if let RunEvent::Exit = event {
            let _ = app.save_window_state(window_flags());
            if let Some(state) = app.try_state::<AppState>() {
                state.sessions.shutdown();
            }
        }
    });
}

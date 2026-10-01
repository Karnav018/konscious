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

use std::path::{Path, PathBuf};
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

/// Data folder and app identifier of the previous version. Only read on
/// first launch, to carry existing sessions and the window position over.
const PREVIOUS_DATA_DIR: &str = ".kova";
const PREVIOUS_IDENTIFIER: &str = "dev.karnav.kova";

/// `~/.konscious` (override: KONSCIOUS_HOME; CLAUDE_WORKSPACE_HOME still
/// works). Data from earlier versions is moved over once. If an earlier
/// version is still running (it holds `.lock`), its folder stays where it is
/// and is used as is, so the lock screen shows instead of two apps resuming
/// the same sessions.
fn base_dir() -> PathBuf {
    for var in ["KONSCIOUS_HOME", "CLAUDE_WORKSPACE_HOME"] {
        if let Some(p) = std::env::var_os(var) {
            return PathBuf::from(p);
        }
    }
    data_dir_in(&PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into())))
}

fn data_dir_in(home: &Path) -> PathBuf {
    let current = home.join(".konscious");
    if current.exists() {
        return current;
    }
    for legacy in [home.join(PREVIOUS_DATA_DIR), home.join(".claude-workspace")] {
        if !legacy.is_dir() {
            continue;
        }
        if locked(&legacy) || std::fs::rename(&legacy, &current).is_err() {
            return legacy;
        }
        break;
    }
    current
}

/// True for an earlier version's data folder (it is only still in use while
/// that version runs); the lock screen then asks to quit it.
pub(crate) fn is_previous_data_dir(dir: &Path) -> bool {
    dir.file_name().is_some_and(|n| n == PREVIOUS_DATA_DIR || n == ".claude-workspace")
}

/// True while another running instance holds `<dir>/.lock`.
fn locked(dir: &Path) -> bool {
    std::fs::File::open(dir.join(".lock")).is_ok_and(|f| f.try_lock().is_err())
}

/// The window-state plugin keeps size and position under the app identifier,
/// which changed with the rename; carry the file over once so the window
/// opens where it was.
fn carry_window_state(identifier: &str) {
    // Tauri's app config dir on macOS.
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    let Some(base) = base else { return };
    let file = tauri_plugin_window_state::DEFAULT_FILENAME;
    let (old, new) = (base.join(PREVIOUS_IDENTIFIER).join(file), base.join(identifier).join(file));
    if !new.exists() && old.is_file() {
        let _ = std::fs::create_dir_all(base.join(identifier));
        let _ = std::fs::copy(&old, &new);
    }
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
        "Konscious",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Konscious"), None)?,
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
    let context = tauri::generate_context!();
    carry_window_state(&context.config().identifier);
    let store = Arc::new(Store::new(base_dir()));
    let lock_ok = store.acquire_lock();
    let env = EnvHandle::new();
    env.resolve_in_background(store.claude_path_override());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(window_flags()).build())
        // Background updates: the frontend checks GitHub releases hourly, downloads
        // in the background and restarts when you say so (src/lib/update.ts).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
        .build(context)
        .expect("error while building Konscious");

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

#[cfg(test)]
mod tests {
    use super::*;

    fn dir_with_marker(p: &Path) {
        std::fs::create_dir_all(p).unwrap();
        std::fs::write(p.join("workspaces.json"), "{}").unwrap();
    }

    #[test]
    fn fresh_install_uses_konscious() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(data_dir_in(home.path()), home.path().join(".konscious"));
    }

    #[test]
    fn previous_version_data_moves_over_once() {
        let home = tempfile::tempdir().unwrap();
        dir_with_marker(&home.path().join(PREVIOUS_DATA_DIR));
        let dir = data_dir_in(home.path());
        assert_eq!(dir, home.path().join(".konscious"));
        assert!(dir.join("workspaces.json").is_file(), "sessions came along");
        assert!(!home.path().join(PREVIOUS_DATA_DIR).exists());
        assert_eq!(data_dir_in(home.path()), dir, "second launch: nothing to move");
    }

    #[test]
    fn running_previous_version_keeps_its_folder() {
        let home = tempfile::tempdir().unwrap();
        let old = home.path().join(PREVIOUS_DATA_DIR);
        dir_with_marker(&old);
        let lock = std::fs::File::create(old.join(".lock")).unwrap();
        lock.try_lock().unwrap(); // what a running previous version holds
        assert_eq!(data_dir_in(home.path()), old, "not moved from under a running app");
        assert!(old.join("workspaces.json").is_file());
        drop(lock);
        assert_eq!(data_dir_in(home.path()), home.path().join(".konscious"), "moved once it quits");
    }

    #[test]
    fn recognises_earlier_data_folders() {
        assert!(is_previous_data_dir(&Path::new("/u").join(PREVIOUS_DATA_DIR)));
        assert!(is_previous_data_dir(Path::new("/u/.claude-workspace")));
        assert!(!is_previous_data_dir(Path::new("/u/.konscious")));
    }

    #[test]
    fn existing_konscious_wins_over_legacy() {
        let home = tempfile::tempdir().unwrap();
        dir_with_marker(&home.path().join(".konscious"));
        dir_with_marker(&home.path().join(PREVIOUS_DATA_DIR));
        assert_eq!(data_dir_in(home.path()), home.path().join(".konscious"));
        assert!(home.path().join(PREVIOUS_DATA_DIR).exists(), "never overwrites or merges");
    }
}

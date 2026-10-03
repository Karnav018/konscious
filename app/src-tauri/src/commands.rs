//! Thin async IPC layer. Every command is `async` so none runs on the main
//! thread; anything that can block (spawning, waiting for a process to exit,
//! git) moves to the blocking pool.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::env::EnvInfo;
use crate::error::{AppError, AppResult};
use crate::git::{self, GitInfo};
use crate::persistence::{Snapshot, Target};
use crate::session::model::{Attached, SessionInfo, SessionSpec};
use crate::suggest::{self, Suggestion};
use crate::AppState;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Unavailable(format!("worker failed: {e}")))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitInfo {
    lock_ok: bool,
    base_dir: String,
    /// The data folder belongs to the previous version, which still runs.
    previous_version: bool,
    home: String,
    version: String,
}

#[tauri::command]
pub async fn app_init(state: State<'_, AppState>) -> AppResult<InitInfo> {
    Ok(InitInfo {
        lock_ok: state.lock_ok,
        base_dir: state.store.base().to_string_lossy().into_owned(),
        previous_version: crate::is_previous_data_dir(state.store.base()),
        home: std::env::var("HOME").unwrap_or_default(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

/// Waits (off the main thread) for login-environment resolution.
#[tauri::command]
pub async fn app_env(state: State<'_, AppState>) -> AppResult<EnvInfo> {
    let env = Arc::clone(&state.env);
    blocking(move || {
        env.get(Duration::from_secs(10))
            .map(|e| e.info.clone())
            .ok_or_else(|| AppError::Unavailable("Timed out reading your login shell environment".into()))
    })
    .await
}

#[tauri::command]
pub async fn state_load(state: State<'_, AppState>) -> AppResult<Snapshot> {
    let store = Arc::clone(&state.store);
    blocking(move || Ok(store.load())).await
}

#[tauri::command]
pub async fn state_save(state: State<'_, AppState>, target: String, data: Value) -> AppResult<()> {
    let store = Arc::clone(&state.store);
    blocking(move || store.save(&Target::parse(&target)?, &data)).await
}

#[tauri::command]
pub async fn state_delete_layout(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.store.delete_layout(&id)
}

#[tauri::command]
pub async fn session_start(
    state: State<'_, AppState>,
    spec: SessionSpec,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> AppResult<SessionInfo> {
    let m = Arc::clone(&state.sessions);
    blocking(move || m.start(spec, cols, rows, Some(Box::new(on_output)))).await
}

#[tauri::command]
pub async fn session_attach(
    state: State<'_, AppState>,
    id: String,
    on_output: Channel<InvokeResponseBody>,
) -> AppResult<Attached> {
    let (info, replay_bytes) = state.sessions.attach(&id, Box::new(on_output))?;
    Ok(Attached { info, replay_bytes })
}

#[tauri::command]
pub async fn session_list(state: State<'_, AppState>) -> AppResult<Vec<SessionInfo>> {
    Ok(state.sessions.list())
}

#[tauri::command]
pub async fn session_memory(state: State<'_, AppState>) -> AppResult<Vec<crate::memory::SessionMemory>> {
    let running: Vec<(String, i32)> =
        state.sessions.list().into_iter().filter_map(|s| s.pid.map(|pid| (s.id, pid))).collect();
    Ok(crate::memory::measure(&running))
}

#[tauri::command]
pub async fn session_stop(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.stop(&id)
}

#[tauri::command]
pub async fn session_kill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.kill(&id)
}

#[tauri::command]
pub async fn session_restart(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> AppResult<SessionInfo> {
    let m = Arc::clone(&state.sessions);
    blocking(move || m.restart(&id, cols, rows)).await
}

#[tauri::command]
pub async fn session_new_conversation(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> AppResult<SessionInfo> {
    let m = Arc::clone(&state.sessions);
    blocking(move || m.new_conversation(&id, cols, rows)).await
}

#[tauri::command]
pub async fn session_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.remove(&id)
}

#[tauri::command]
pub async fn usage_snapshot(state: State<'_, AppState>) -> AppResult<Value> {
    Ok(state.sessions.usage_snapshot())
}

#[tauri::command]
pub async fn terminal_write(state: State<'_, AppState>, id: String, data: String) -> AppResult<()> {
    state.sessions.write(&id, data.into_bytes())
}

#[tauri::command]
pub async fn terminal_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> AppResult<()> {
    state.sessions.resize(&id, cols, rows)
}

#[tauri::command]
pub async fn terminal_ack(state: State<'_, AppState>, id: String, bytes: usize) -> AppResult<()> {
    state.sessions.ack(&id, bytes)
}

#[tauri::command]
pub async fn git_info(state: State<'_, AppState>, cwd: String) -> AppResult<Option<GitInfo>> {
    let env = Arc::clone(&state.env);
    blocking(move || {
        let Some(env) = env.get(Duration::from_secs(10)) else { return Ok(None) };
        let Ok(dir) = crate::claude::launcher::validate_cwd(&cwd, &env.info.home) else { return Ok(None) };
        Ok(git::info(&dir, &env.vars))
    })
    .await
}

#[tauri::command]
pub async fn fs_subdirs(path: String) -> AppResult<Vec<String>> {
    blocking(move || Ok(suggest::subdirs(std::path::Path::new(&path), 12))).await
}

#[tauri::command]
pub async fn fs_suggest_folders() -> AppResult<Vec<Suggestion>> {
    blocking(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        Ok(suggest::folders(std::path::Path::new(&home), 6))
    })
    .await
}

/// What ⌘V pastes into a pane: copied files' paths, else the text.
#[tauri::command]
pub async fn clipboard_read() -> AppResult<crate::clipboard::Clipboard> {
    Ok(crate::clipboard::read())
}

#[tauri::command]
pub async fn file_thumbnail(path: String) -> AppResult<Option<String>> {
    Ok(crate::preview::thumbnail(&path))
}

#[tauri::command]
pub async fn fs_is_dir(path: String) -> AppResult<bool> {
    let home = std::env::var("HOME").unwrap_or_default();
    Ok(crate::claude::launcher::validate_cwd(&path, &home).is_ok())
}

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
        home: crate::env::home_dir(),
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

/// Removing a workspace: its layout and notes files go too.
#[tauri::command]
pub async fn state_delete_workspace(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let store = Arc::clone(&state.store);
    blocking(move || store.delete_workspace(&id)).await
}

/// Saves notes as a Markdown file where the user chose; returns the path.
#[tauri::command]
pub async fn notes_export(path: String, markdown: String) -> AppResult<String> {
    blocking(move || crate::persistence::export_markdown(std::path::Path::new(&path), &markdown))
        .await
        .map(|p| p.to_string_lossy().into_owned())
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
        let home = crate::env::home_dir();
        Ok(suggest::folders(std::path::Path::new(&home), 6))
    })
    .await
}

/// What Ctrl+V pastes into a pane: copied files' paths, else the text.
#[tauri::command]
#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
pub async fn clipboard_read(app: tauri::AppHandle) -> AppResult<crate::clipboard::Clipboard> {
    // GTK's clipboard may only be touched on the main thread; wait for it
    // from the blocking pool.
    #[cfg(target_os = "linux")]
    let clip = blocking(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(crate::clipboard::read());
        })
        .map_err(|e| AppError::Unavailable(format!("clipboard: {e}")))?;
        rx.recv().map_err(|e| AppError::Unavailable(format!("clipboard: {e}")))
    })
    .await?;
    #[cfg(not(target_os = "linux"))]
    let clip = crate::clipboard::read();
    Ok(clip)
}

/// An ISO-ish stamp for the manifest. Seconds since the epoch would do, but
/// a person reads this file.
fn chrono_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

/// Where Claude keeps its transcripts. The environment resolves in the
/// background at startup, so this waits for it like `app_env` does.
fn claude_config(state: &State<'_, AppState>) -> AppResult<std::path::PathBuf> {
    state
        .env
        .get(Duration::from_secs(10))
        .map(|e| e.claude_config_dir())
        .ok_or_else(|| AppError::Unavailable("Timed out reading your environment".into()))
}

/// Writes a workspace bundle: its manifest, plus each session's transcript
/// copied out of Claude's own store.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSession {
    pub id: String,
    pub name: String,
    pub kind: String,
    /// Where the session runs on this machine; stored as an offset.
    pub cwd: String,
    pub claude_session_id: Option<String>,
}

#[tauri::command]
pub async fn bundle_export(
    state: State<'_, AppState>,
    dest: String,
    workspace_name: String,
    root: String,
    layout: serde_json::Value,
    sessions: Vec<ExportSession>,
    app_version: String,
) -> AppResult<serde_json::Value> {
    use crate::bundle;
    let claude = claude_config(&state)?;
    // Path handling lives here, not in the interface: one place that knows
    // how a cwd becomes an offset and back again.
    let mut manifest = bundle::Manifest {
        version: bundle::BUNDLE_VERSION,
        app: app_version,
        platform: std::env::consts::OS.to_string(),
        exported_at: chrono_now(),
        workspace_name,
        source_root: root.clone(),
        sessions: sessions
            .into_iter()
            .map(|s| {
                let offset = bundle::relative_to(&root, &s.cwd);
                bundle::BundleSession {
                    id: s.id,
                    name: s.name,
                    kind: s.kind,
                    relative: offset.clone().unwrap_or_default(),
                    outside: offset.is_none(),
                    claude_session_id: s.claude_session_id,
                    has_transcript: false,
                }
            })
            .collect(),
        layout,
    };
    // Only carry transcripts that actually exist, and say which did not.
    let mut copies: Vec<(String, std::path::PathBuf)> = Vec::new();
    for session in &mut manifest.sessions {
        let Some(conversation) = session.claude_session_id.clone() else {
            session.has_transcript = false;
            continue;
        };
        match bundle::find_transcript(&claude, &conversation) {
            Some(path) => {
                session.has_transcript = true;
                copies.push((conversation, path));
            }
            None => session.has_transcript = false,
        }
    }
    let bytes = bundle::write(std::path::Path::new(&dest), &manifest, &copies)?;
    Ok(serde_json::json!({
        "bytes": bytes,
        "transcripts": copies.len(),
        "missing": manifest.sessions.iter().filter(|s| !s.has_transcript).count(),
    }))
}

/// A `.kon` the system asked us to open before the interface was listening.
/// Taken once: a second call returns nothing.
#[tauri::command]
pub async fn bundle_pending(state: State<'_, AppState>) -> AppResult<Option<String>> {
    Ok(state.pending_bundle.lock().unwrap_or_else(|e| e.into_inner()).take())
}

/// What each session would contribute to a bundle, so the export dialog can
/// show the cost before anything is written.
#[tauri::command]
pub async fn bundle_preview(
    state: State<'_, AppState>,
    sessions: Vec<ExportSession>,
) -> AppResult<Vec<serde_json::Value>> {
    let claude = claude_config(&state)?;
    Ok(sessions
        .into_iter()
        .map(|s| {
            let bytes = s
                .claude_session_id
                .as_deref()
                .and_then(|c| crate::bundle::find_transcript(&claude, c))
                .and_then(|p| std::fs::metadata(p).ok())
                .map(|m| m.len())
                .unwrap_or(0);
            serde_json::json!({ "id": s.id, "bytes": bytes })
        })
        .collect())
}

/// Reads a bundle's manifest without writing anything, so the user can see
/// what it holds before importing it.
#[tauri::command]
pub async fn bundle_inspect(path: String) -> AppResult<crate::bundle::Manifest> {
    crate::bundle::read_manifest(std::path::Path::new(&path))
}

/// Copies the bundle's transcripts to where Claude will look for them, given
/// the folder the user picked on this machine.
#[tauri::command]
pub async fn bundle_import(
    state: State<'_, AppState>,
    path: String,
    root: String,
) -> AppResult<crate::bundle::Imported> {
    let src = std::path::Path::new(&path);
    let manifest = crate::bundle::read_manifest(src)?;
    crate::bundle::import_transcripts(src, &claude_config(&state)?, &root, &manifest)
}

#[tauri::command]
pub async fn system_stats() -> AppResult<crate::stats::Stats> {
    Ok(tauri::async_runtime::spawn_blocking(crate::stats::snapshot).await.unwrap_or_default())
}

#[tauri::command]
pub async fn file_thumbnail(path: String) -> AppResult<Option<String>> {
    Ok(crate::preview::thumbnail(&path))
}

#[tauri::command]
pub async fn fs_is_dir(path: String) -> AppResult<bool> {
    Ok(crate::claude::launcher::validate_cwd(&path, &crate::env::home_dir()).is_ok())
}

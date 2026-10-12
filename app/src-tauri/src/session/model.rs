use serde::{Deserialize, Serialize};

use super::status::Status;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Claude,
    Shell,
}

/// What the frontend asks Rust to run. Rust validates every field.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionSpec {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    pub cwd: String,
    pub claude_session_id: Option<String>,
    /// Resume as a *copy* (`--fork-session`). Used once, when two panes point
    /// at the same conversation, so they never write one history together.
    #[serde(default)]
    pub fork: bool,
}

/// `session_attach` result.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Attached {
    #[serde(flatten)]
    pub info: SessionInfo,
    pub replay_bytes: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub kind: Kind,
    pub run_id: u64,
    pub status: Status,
    pub running: bool,
    pub pid: Option<i32>,
    pub exit_code: Option<u32>,
    pub exit_signal: Option<String>,
    pub hooks_active: bool,
    pub claude_session_id: Option<String>,
    pub cwd: String,
    /// Wall-clock ms of the current run's start.
    pub started_at: Option<u64>,
    /// A `--resume` run died within seconds: offer "Start new conversation".
    pub resume_failed: bool,
    /// Current PTY size: the width the program draws (and replayed output was
    /// produced) at. A re-attaching terminal replays at this size first.
    pub cols: u16,
    pub rows: u16,
}

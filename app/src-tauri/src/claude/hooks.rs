//! Session status from Claude Code hooks, without touching the user's config.
//!
//! Each Claude session is launched with `--settings <run>/<id>.settings.json`.
//! Those hooks *merge* with the user's own hooks. Every hook appends one short
//! line to `<run>/<id>.events`; Rust tails that file. Hook commands:
//! - never read stdin except SessionStart (small: ids, source, model), so
//!   prompts and tool inputs are never written to disk;
//! - never print to stdout (UserPromptSubmit stdout would become context);
//! - always exit 0 (a non-zero exit shows a "hook error" in the transcript).
//!
//! macOS/Linux: each hook is a tiny `sh` command (this file). Windows has
//! its own hook plumbing in `win_hooks.rs`, which the macOS build never
//! compiles; only the event format and the tailer below are shared.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookEvent {
    /// SessionStart; carries Claude's conversation id, which changes on `/clear`.
    Start { session_id: Option<String>, source: Option<String> },
    Prompt,
    Tool,
    ToolDone,
    Permission,
    Attention,
    Stop,
}

/// Notification types that mean "a person needs to act in this pane".
pub(crate) const ATTENTION_MATCHER: &str =
    "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input";

pub(crate) fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg_attr(windows, allow(dead_code))]
fn simple(token: &str, events: &str) -> String {
    format!("printf '%s\\n' {token} >> {events} 2>/dev/null; exit 0")
}

#[cfg_attr(windows, allow(dead_code))]
fn capture(token: &str, events: &str) -> String {
    format!("{{ printf '{token}\\t'; tr -d '\\n\\r'; printf '\\n'; }} >> {events} 2>/dev/null; exit 0")
}

#[cfg_attr(windows, allow(dead_code))]
fn entry(command: String, matcher: Option<&str>) -> Value {
    wrap(json!({ "type": "command", "command": command, "timeout": 5 }), matcher)
}

pub(crate) fn wrap(hook: Value, matcher: Option<&str>) -> Value {
    match matcher {
        Some(m) => json!([{ "matcher": m, "hooks": [hook] }]),
        None => json!([{ "hooks": [hook] }]),
    }
}

/// Status-line command: saves Claude's status JSON for the app (atomically)
/// and displays nothing — Kova shows context, model and plan usage in its own
/// chrome. If the user configured a status line of their own, that one is
/// shown unchanged. Never fails (a failing status line shows an error).
#[cfg_attr(windows, allow(dead_code))]
pub fn status_command(status_path: &Path, chain: Option<&str>) -> String {
    let st = sh_quote(&status_path.to_string_lossy());
    let tmp = sh_quote(&format!("{}.tmp", status_path.to_string_lossy()));
    let display = match chain {
        Some(cmd) => format!("printf '%s' \"$input\" | ( {cmd} )"),
        None => ":".to_string(),
    };
    format!("input=$(cat); printf '%s' \"$input\" > {tmp} 2>/dev/null && mv -f {tmp} {st} 2>/dev/null; {display}; exit 0")
}

/// The status line the user configured for this directory, if any
/// (local > project > user settings), so Kova can show it unchanged.
pub fn user_status_line(cwd: &Path, config_dir: &Path) -> Option<String> {
    let files = [
        cwd.join(".claude").join("settings.local.json"),
        cwd.join(".claude").join("settings.json"),
        config_dir.join("settings.json"),
    ];
    for f in files {
        let Ok(bytes) = fs::read(&f) else { continue };
        let Ok(v) = serde_json::from_slice::<Value>(&bytes) else { continue };
        if let Some(sl) = v.get("statusLine").filter(|s| !s.is_null()) {
            return (sl["type"] == "command").then(|| sl["command"].as_str().map(str::to_string)).flatten();
        }
    }
    None
}

#[cfg_attr(windows, allow(dead_code))]
pub fn settings_value(events_path: &Path, status_path: &Path, chain: Option<&str>) -> Value {
    let ev = sh_quote(&events_path.to_string_lossy());
    json!({
        "statusLine": { "type": "command", "command": status_command(status_path, chain), "padding": 0 },
        "hooks": {
            "SessionStart": entry(capture("start", &ev), None),
            "UserPromptSubmit": entry(simple("prompt", &ev), None),
            "PreToolUse": entry(simple("tool", &ev), None),
            "PostToolUse": entry(simple("tool_done", &ev), None),
            "PostToolUseFailure": entry(simple("tool_done", &ev), None),
            "PermissionRequest": entry(simple("permission", &ev), None),
            "Notification": entry(simple("attention", &ev), Some(ATTENTION_MATCHER)),
            "Stop": entry(simple("stop", &ev), None),
            "StopFailure": entry(simple("stop", &ev), None),
        }
    })
}

/// Paths for one session's hook plumbing.
pub struct HookFiles {
    pub settings: PathBuf,
    pub events: PathBuf,
    pub status: PathBuf,
}

/// Writes the settings file and truncates the events file for a new run.
pub fn prepare(run_dir: &Path, session_id: &str, chain: Option<&str>) -> std::io::Result<HookFiles> {
    fs::create_dir_all(run_dir)?;
    #[cfg(unix)]
    fs::set_permissions(run_dir, fs::Permissions::from_mode(0o700))?;
    let settings = run_dir.join(format!("{session_id}.settings.json"));
    let events = run_dir.join(format!("{session_id}.events"));
    let status = run_dir.join(format!("{session_id}.status.json"));
    #[cfg(not(windows))]
    let doc = settings_value(&events, &status, chain);
    #[cfg(windows)]
    let doc = {
        let _ = chain; // chaining the user's own status line: macOS/Linux only
        super::win_hooks::settings_value(&events, &status)
    };
    fs::write(&settings, serde_json::to_vec_pretty(&doc)?)?;
    let mut open = OpenOptions::new();
    open.create(true).write(true).truncate(true);
    #[cfg(unix)]
    open.mode(0o600);
    open.open(&events)?;
    let _ = fs::remove_file(&status);
    Ok(HookFiles { settings, events, status })
}

/* ── status-line feed → usage ─────────────────────────────────────── */

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub id: String,
    /// input-only: input + cache creation + cache read (Claude's formula)
    pub pct: Option<f64>,
    pub used: Option<u64>,
    pub size: Option<u64>,
    pub model: Option<String>,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub pct: f64,
    /// Unix epoch seconds.
    pub resets_at: Option<u64>,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub five_hour: Option<LimitWindow>,
    pub seven_day: Option<LimitWindow>,
}

fn window(v: &Value) -> Option<LimitWindow> {
    Some(LimitWindow { pct: v.get("used_percentage")?.as_f64()?, resets_at: v.get("resets_at").and_then(Value::as_u64) })
}

/// Parses Claude's status-line JSON (documented schema).
pub fn parse_status(id: &str, v: &Value) -> (ContextUsage, Option<Limits>) {
    let cw = &v["context_window"];
    let usage = ContextUsage {
        id: id.to_string(),
        pct: cw["used_percentage"].as_f64(),
        used: cw["total_input_tokens"].as_u64(),
        size: cw["context_window_size"].as_u64(),
        model: v["model"]["display_name"].as_str().map(str::to_string),
    };
    let rl = &v["rate_limits"];
    let limits = (!rl.is_null()).then(|| Limits { five_hour: window(&rl["five_hour"]), seven_day: window(&rl["seven_day"]) });
    (usage, limits.filter(|l| l.five_hour.is_some() || l.seven_day.is_some()))
}

pub fn parse_line(line: &str) -> Option<HookEvent> {
    let (token, rest) = line.split_once('\t').unwrap_or((line, ""));
    Some(match token.trim() {
        "start" => {
            let v: Value = serde_json::from_str(rest).unwrap_or(Value::Null);
            HookEvent::Start {
                session_id: v["session_id"].as_str().map(str::to_string),
                source: v["source"].as_str().map(str::to_string),
            }
        }
        "prompt" => HookEvent::Prompt,
        "tool" => HookEvent::Tool,
        "tool_done" => HookEvent::ToolDone,
        "permission" => HookEvent::Permission,
        "attention" => HookEvent::Attention,
        "stop" => HookEvent::Stop,
        _ => return None,
    })
}

const MAX_READ: u64 = 256 * 1024;

/// Incremental reader for an append-only events file.
pub struct EventTail {
    path: PathBuf,
    offset: u64,
    partial: String,
}

impl EventTail {
    pub fn new(path: PathBuf) -> Self {
        Self { path, offset: 0, partial: String::new() }
    }

    pub fn read_new(&mut self) -> Vec<HookEvent> {
        // stat first: the common case (nothing new) costs no open().
        let len = fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            // Truncated by a new run.
            self.offset = 0;
            self.partial.clear();
        }
        if len == self.offset {
            return Vec::new();
        }
        let Ok(mut f) = File::open(&self.path) else { return Vec::new() };
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return Vec::new();
        }
        // Bounded per tick; bytes, not String, so one bad byte can't wedge the tail.
        let mut buf = Vec::new();
        if (&mut f).take(MAX_READ).read_to_end(&mut buf).is_err() {
            return Vec::new();
        }
        self.offset += buf.len() as u64;
        self.partial.push_str(&String::from_utf8_lossy(&buf));
        if self.partial.len() > MAX_READ as usize {
            // A runaway line with no newline: drop it rather than grow forever.
            self.partial.clear();
        }
        let mut events = Vec::new();
        while let Some(nl) = self.partial.find('\n') {
            let line: String = self.partial.drain(..=nl).collect();
            events.extend(parse_line(line.trim_end_matches('\n')));
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::Command;

    #[cfg(unix)]
    #[test]
    fn settings_cover_status_events_and_quote_paths() {
        let v = settings_value(Path::new("/tmp/it's here/x.events"), Path::new("/tmp/s.json"), None);
        let hooks = v["hooks"].as_object().unwrap();
        for ev in ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop"] {
            assert!(hooks.contains_key(ev), "{ev} missing");
        }
        assert_eq!(v["hooks"]["Notification"][0]["matcher"], ATTENTION_MATCHER);
        let cmd = v["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains(r"'/tmp/it'\''s here/x.events'"));
        assert!(cmd.ends_with("exit 0"));
    }

    /// Runs the generated commands through a real `sh`, as Claude does.
    #[cfg(unix)]
    #[test]
    fn hook_commands_append_parseable_lines_and_never_fail() {
        let dir = tempfile::tempdir().unwrap();
        let files = prepare(dir.path(), "s1", None).unwrap();
        let v: Value = serde_json::from_slice(&fs::read(&files.settings).unwrap()).unwrap();
        let run = |event: &str, stdin: &str| {
            let cmd = v["hooks"][event][0]["hooks"][0]["command"].as_str().unwrap();
            let mut child = Command::new("sh")
                .args(["-c", cmd])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
            let out = child.wait_with_output().unwrap();
            assert!(out.status.success());
            assert!(out.stdout.is_empty(), "{event} must not print to stdout");
        };
        run("SessionStart", "{\"session_id\":\"abc\",\n\"source\":\"resume\"}");
        run("UserPromptSubmit", "{\"prompt\":\"secret prompt\"}");
        run("PermissionRequest", "{}");
        run("Stop", "{}");

        let text = fs::read_to_string(&files.events).unwrap();
        assert!(!text.contains("secret prompt"), "prompts must never reach disk");
        let mut tail = EventTail::new(files.events.clone());
        assert_eq!(
            tail.read_new(),
            vec![
                HookEvent::Start { session_id: Some("abc".into()), source: Some("resume".into()) },
                HookEvent::Prompt,
                HookEvent::Permission,
                HookEvent::Stop,
            ]
        );
        assert!(tail.read_new().is_empty());

        // A missing events dir must still exit 0.
        fs::remove_dir_all(dir.path()).unwrap();
        run("Stop", "{}");
    }

    fn run_status(cmd: &str, stdin: &str) -> (bool, String) {
        let mut child = Command::new("sh")
            .args(["-c", cmd])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        (out.status.success(), String::from_utf8_lossy(&out.stdout).to_string())
    }

    const STATUS_JSON: &str = r#"{"model":{"display_name":"Opus 5.5"},"context_window":{"used_percentage":79.4,"total_input_tokens":794000,"context_window_size":1000000},"rate_limits":{"five_hour":{"used_percentage":11,"resets_at":1790770000},"seven_day":{"used_percentage":38.5,"resets_at":1791200000}}}"#;

    #[cfg(unix)]
    #[test]
    fn status_line_saves_the_feed_and_shows_nothing_by_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.status.json");
        let (ok, out) = run_status(&status_command(&path, None), STATUS_JSON);
        assert!(ok);
        assert_eq!(out, "", "Claude's status row stays empty; Kova shows the data itself");
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let (usage, limits) = parse_status("s", &saved);
        assert_eq!(usage.pct, Some(79.4));
        assert_eq!(usage.size, Some(1_000_000));
        let limits = limits.unwrap();
        assert_eq!(limits.five_hour.unwrap().pct, 11.0);
        assert_eq!(limits.seven_day.unwrap().resets_at, Some(1_791_200_000));
    }

    #[cfg(unix)]
    #[test]
    fn status_line_chains_the_users_own_command_and_never_fails() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.status.json");
        let (ok, out) = run_status(&status_command(&path, Some("cat | wc -c | tr -d ' '")), "{\"x\":1}");
        assert!(ok);
        assert_eq!(out.trim(), "7", "user's command receives the same JSON");
        // A missing run dir can't break Claude.
        let (ok, out) = run_status(&status_command(&dir.path().join("nope/s.json"), None), r#"{"context_window":{"used_percentage":null}}"#);
        assert!(ok);
        assert_eq!(out, "");
    }

    #[test]
    fn user_status_line_precedence() {
        let dir = tempfile::tempdir().unwrap();
        let (cwd, cfg) = (dir.path().join("proj"), dir.path().join("cfg"));
        fs::create_dir_all(cwd.join(".claude")).unwrap();
        fs::create_dir_all(&cfg).unwrap();
        assert_eq!(user_status_line(&cwd, &cfg), None);
        fs::write(cfg.join("settings.json"), r#"{"statusLine":{"type":"command","command":"user.sh"}}"#).unwrap();
        assert_eq!(user_status_line(&cwd, &cfg).as_deref(), Some("user.sh"));
        fs::write(cwd.join(".claude/settings.json"), r#"{"statusLine":{"type":"command","command":"proj.sh"}}"#).unwrap();
        assert_eq!(user_status_line(&cwd, &cfg).as_deref(), Some("proj.sh"));
    }

    #[test]
    fn tail_handles_partial_lines_and_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("e");
        fs::write(&path, "prompt\nsto").unwrap();
        let mut tail = EventTail::new(path.clone());
        assert_eq!(tail.read_new(), vec![HookEvent::Prompt]);
        OpenOptions::new().append(true).open(&path).unwrap().write_all(b"p\n").unwrap();
        assert_eq!(tail.read_new(), vec![HookEvent::Stop]);
        fs::write(&path, "tool\n").unwrap();
        assert_eq!(tail.read_new(), vec![HookEvent::Tool]);
    }
}

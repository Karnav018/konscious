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
//! macOS/Linux: each hook is a tiny `sh` command. Windows: there may be no
//! bash at all (Git for Windows is optional), so hooks use Claude's *exec
//! form* — Claude runs `Kova.exe hook <token> <events-file>` directly, no
//! shell — and Kova's helper mode (`run_helper`) appends the same line.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
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
const ATTENTION_MATCHER: &str =
    "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input";

#[cfg_attr(windows, allow(dead_code))]
fn sh_quote(s: &str) -> String {
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

fn wrap(hook: Value, matcher: Option<&str>) -> Value {
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

/// The `--settings` document for one session. `helper` is Kova's own
/// executable (used on Windows, where hooks run it directly).
pub fn settings_value(events_path: &Path, status_path: &Path, chain: Option<&str>, helper: &Path) -> Value {
    #[cfg(unix)]
    {
        let _ = helper;
        unix_settings(events_path, status_path, chain)
    }
    #[cfg(windows)]
    {
        let _ = chain; // chaining a user's own status line: macOS/Linux only for now
        windows_settings(events_path, status_path, helper)
    }
}

#[cfg_attr(windows, allow(dead_code))]
fn unix_settings(events_path: &Path, status_path: &Path, chain: Option<&str>) -> Value {
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

/// Exec-form hooks (no shell): Claude spawns `helper hook <token> <events>`.
#[cfg_attr(unix, allow(dead_code))]
fn windows_settings(events_path: &Path, status_path: &Path, helper: &Path) -> Value {
    let exe = helper.to_string_lossy().into_owned();
    let ev = events_path.to_string_lossy().into_owned();
    let hook = |token: &str, matcher: Option<&str>| {
        wrap(json!({ "type": "command", "command": exe, "args": ["hook", token, ev], "timeout": 5 }), matcher)
    };
    json!({
        "statusLine": { "type": "command", "command": windows_status_command(helper, status_path, git_bash_present()), "padding": 0 },
        "hooks": {
            "SessionStart": hook("start", None),
            "UserPromptSubmit": hook("prompt", None),
            "PreToolUse": hook("tool", None),
            "PostToolUse": hook("tool_done", None),
            "PostToolUseFailure": hook("tool_done", None),
            "PermissionRequest": hook("permission", None),
            "Notification": hook("attention", Some(ATTENTION_MATCHER)),
            "Stop": hook("stop", None),
            "StopFailure": hook("stop", None),
        }
    })
}

/// The status line has no exec form, so it goes through Claude's shell: Git
/// Bash when installed, else PowerShell. With 8.3 short paths and forward
/// slashes the command is plain words that both shells run unquoted; only if
/// a path still contains unusual characters is it quoted for the shell in use.
#[cfg_attr(unix, allow(dead_code))]
pub fn windows_status_command(helper: &Path, status_path: &Path, git_bash: bool) -> String {
    let fwd = |p: &Path| short_path(p).to_string_lossy().replace('\\', "/");
    let (h, s) = (fwd(helper), fwd(status_path));
    let plain = |x: &str| x.chars().all(|c| c.is_ascii_alphanumeric() || "_./:~-".contains(c));
    if plain(&h) && plain(&s) {
        format!("{h} status {s}")
    } else if git_bash {
        format!("{} status {}", sh_quote(&h), sh_quote(&s))
    } else {
        let ps = |x: &str| format!("'{}'", x.replace('\'', "''"));
        format!("& {} status {}", ps(&h), ps(&s))
    }
}

/// Mirrors how Claude Code picks its shell on Windows: Git Bash if found.
#[cfg_attr(unix, allow(dead_code))]
fn git_bash_present() -> bool {
    if std::env::var_os("CLAUDE_CODE_GIT_BASH_PATH").is_some() {
        return true;
    }
    let path = std::env::var("PATH").unwrap_or_default();
    crate::env::which("git.exe", &path)
        .and_then(|git| git.parent()?.parent().map(|root| root.join("bin").join("bash.exe")))
        .is_some_and(|bash| bash.is_file())
        || Path::new(r"C:\Program Files\Git\bin\bash.exe").is_file()
}

#[cfg(windows)]
fn short_path(p: &Path) -> PathBuf {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;
    // The file itself may not exist yet: shorten the existing parent.
    let (dir, name) = match (p.parent(), p.file_name()) {
        (Some(d), Some(n)) if !p.exists() => (d, Some(n)),
        _ => (p, None),
    };
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut buf = vec![0u16; 1024];
    let n = unsafe { GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) } as usize;
    if n == 0 || n >= buf.len() {
        return p.to_path_buf();
    }
    let short = PathBuf::from(std::ffi::OsString::from_wide(&buf[..n]));
    match name {
        Some(n) => short.join(n),
        None => short,
    }
}

#[cfg(not(windows))]
fn short_path(p: &Path) -> PathBuf {
    p.to_path_buf()
}

/* ── helper mode (Windows hooks) ─────────────────────────────────── */

const HOOK_TOKENS: &[&str] = &["start", "prompt", "tool", "tool_done", "permission", "attention", "stop"];
const MAX_STDIN: u64 = 4 * 1024 * 1024;

/// `Kova hook <token> <file.events>` / `Kova status <file.status.json>`.
/// Returns the exit code when `args` is a helper invocation (always 0: a
/// failing hook would show an error in Claude), `None` for a normal launch.
pub fn run_helper(args: &[String], stdin: &mut dyn Read) -> Option<i32> {
    match args.get(1).map(String::as_str) {
        Some("hook") => {
            if let (Some(token), Some(events)) = (args.get(2), args.get(3)) {
                let _ = append_event(token, Path::new(events), stdin);
            }
            Some(0)
        }
        Some("status") => {
            if let Some(path) = args.get(2) {
                let _ = save_status(Path::new(path), stdin);
            }
            Some(0)
        }
        _ => None,
    }
}

fn append_event(token: &str, events: &Path, stdin: &mut dyn Read) -> std::io::Result<()> {
    // Only our own event files, only known tokens.
    if !HOOK_TOKENS.contains(&token) || events.extension().is_none_or(|e| e != "events") {
        return Ok(());
    }
    let mut input = Vec::new();
    stdin.take(MAX_STDIN).read_to_end(&mut input)?; // drain, so Claude never sees a broken pipe
    let line = if token == "start" {
        let json = String::from_utf8_lossy(&input).replace(['\n', '\r'], "");
        format!("start\t{json}\n")
    } else {
        format!("{token}\n") // prompts and tool inputs are never written to disk
    };
    OpenOptions::new().create(true).append(true).open(events)?.write_all(line.as_bytes())
}

fn save_status(path: &Path, stdin: &mut dyn Read) -> std::io::Result<()> {
    if !path.to_string_lossy().ends_with(".status.json") {
        return Ok(());
    }
    let mut input = Vec::new();
    stdin.take(MAX_STDIN).read_to_end(&mut input)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &input)?;
    fs::rename(&tmp, path)
}

/// Paths for one session's hook plumbing.
pub struct HookFiles {
    pub settings: PathBuf,
    pub events: PathBuf,
    pub status: PathBuf,
}

/// Writes the settings file and truncates the events file for a new run.
pub fn prepare(run_dir: &Path, session_id: &str, chain: Option<&str>, helper: &Path) -> std::io::Result<HookFiles> {
    fs::create_dir_all(run_dir)?;
    #[cfg(unix)]
    fs::set_permissions(run_dir, fs::Permissions::from_mode(0o700))?;
    let settings = run_dir.join(format!("{session_id}.settings.json"));
    let events = run_dir.join(format!("{session_id}.events"));
    let status = run_dir.join(format!("{session_id}.status.json"));
    fs::write(&settings, serde_json::to_vec_pretty(&settings_value(&events, &status, chain, helper))?)?;
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
        let v = settings_value(Path::new("/tmp/it's here/x.events"), Path::new("/tmp/s.json"), None, Path::new("/k"));
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
        let files = prepare(dir.path(), "s1", None, Path::new("/k")).unwrap();
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

    fn helper(args: &[&str], stdin: &str) -> Option<i32> {
        let args: Vec<String> = std::iter::once("Kova").chain(args.iter().copied()).map(String::from).collect();
        run_helper(&args, &mut stdin.as_bytes())
    }

    #[test]
    fn helper_mode_appends_the_same_events_as_the_shell_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let ev = dir.path().join("s1.events");
        let ev_s = ev.to_str().unwrap();
        assert_eq!(helper(&["hook", "start", ev_s], "{\"session_id\":\"abc\",\n\"source\":\"startup\"}"), Some(0));
        assert_eq!(helper(&["hook", "prompt", ev_s], "{\"prompt\":\"secret prompt\"}"), Some(0));
        assert_eq!(helper(&["hook", "stop", ev_s], "{}"), Some(0));
        assert!(!fs::read_to_string(&ev).unwrap().contains("secret prompt"), "prompts never reach disk");
        assert_eq!(
            EventTail::new(ev.clone()).read_new(),
            vec![HookEvent::Start { session_id: Some("abc".into()), source: Some("startup".into()) }, HookEvent::Prompt, HookEvent::Stop]
        );
    }

    #[test]
    fn helper_mode_saves_status_and_rejects_foreign_paths() {
        let dir = tempfile::tempdir().unwrap();
        let st = dir.path().join("s1.status.json");
        assert_eq!(helper(&["status", st.to_str().unwrap()], "{\"model\":{}}"), Some(0));
        assert_eq!(fs::read_to_string(&st).unwrap(), "{\"model\":{}}");
        let other = dir.path().join("notes.txt");
        assert_eq!(helper(&["status", other.to_str().unwrap()], "x"), Some(0));
        assert_eq!(helper(&["hook", "evil", dir.path().join("a.events").to_str().unwrap()], "x"), Some(0));
        assert!(!other.exists() && !dir.path().join("a.events").exists(), "only our own files, only known tokens");
        assert_eq!(helper(&["hook"], ""), Some(0), "malformed calls still exit 0");
        assert_eq!(helper(&[], ""), None, "a normal launch is not a helper call");
    }

    #[test]
    fn windows_status_command_is_shell_neutral_when_it_can_be() {
        let p = |s: &str| PathBuf::from(s);
        assert_eq!(
            windows_status_command(&p("C:/Users/kar/AppData/Local/Kova/Kova.exe"), &p("C:/Users/kar/.kova/run/s1.status.json"), false),
            "C:/Users/kar/AppData/Local/Kova/Kova.exe status C:/Users/kar/.kova/run/s1.status.json"
        );
        let (h, s) = (p("C:/Users/John O'Hara/Kova.exe"), p("C:/x/s.status.json"));
        assert_eq!(windows_status_command(&h, &s, true), "'C:/Users/John O'\\''Hara/Kova.exe' status 'C:/x/s.status.json'");
        assert_eq!(windows_status_command(&h, &s, false), "& 'C:/Users/John O''Hara/Kova.exe' status 'C:/x/s.status.json'");
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

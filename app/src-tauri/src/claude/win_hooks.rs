//! Windows hook plumbing. Compiled only for Windows (and for unit tests on
//! any platform) — the macOS/Linux app never contains this code.
//!
//! There may be no bash on Windows (Git for Windows is optional), so hooks
//! use Claude Code's *exec form*: Claude runs `Kova.exe hook <token>
//! <events-file>` directly, with no shell, and `run_helper` appends the same
//! event lines the Unix `sh` hooks write. The status line has no exec form,
//! so it runs `Kova.exe status <file>` through whichever shell Claude uses.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::hooks::{sh_quote, wrap, ATTENTION_MATCHER};

/// The `--settings` document for one session on Windows.
#[cfg(windows)]
pub fn settings_value(events_path: &Path, status_path: &Path) -> Value {
    let helper = std::env::current_exe().unwrap_or_default();
    settings_with(&helper, events_path, status_path, git_bash_present())
}

/// Exec-form hooks (no shell): Claude spawns `helper hook <token> <events>`.
pub fn settings_with(helper: &Path, events_path: &Path, status_path: &Path, git_bash: bool) -> Value {
    let exe = helper.to_string_lossy().into_owned();
    let ev = events_path.to_string_lossy().into_owned();
    let hook = |token: &str, matcher: Option<&str>| {
        wrap(json!({ "type": "command", "command": exe, "args": ["hook", token, ev], "timeout": 5 }), matcher)
    };
    json!({
        "statusLine": { "type": "command", "command": status_command(helper, status_path, git_bash), "padding": 0 },
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
pub fn status_command(helper: &Path, status_path: &Path, git_bash: bool) -> String {
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
#[cfg(windows)]
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

/// Unit tests on macOS: paths are used as given.
#[cfg(not(windows))]
fn short_path(p: &Path) -> PathBuf {
    p.to_path_buf()
}

/* ── helper mode: what the hooks above execute ───────────────────── */

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::hooks::{EventTail, HookEvent};

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
            status_command(&p("C:/Users/kar/AppData/Local/Kova/Kova.exe"), &p("C:/Users/kar/.kova/run/s1.status.json"), false),
            "C:/Users/kar/AppData/Local/Kova/Kova.exe status C:/Users/kar/.kova/run/s1.status.json"
        );
        let (h, s) = (p("C:/Users/John O'Hara/Kova.exe"), p("C:/x/s.status.json"));
        assert_eq!(status_command(&h, &s, true), "'C:/Users/John O'\\''Hara/Kova.exe' status 'C:/x/s.status.json'");
        assert_eq!(status_command(&h, &s, false), "& 'C:/Users/John O''Hara/Kova.exe' status 'C:/x/s.status.json'");
    }

    #[test]
    fn settings_use_exec_form_hooks_with_no_shell() {
        let v = settings_with(Path::new("C:/k/Kova.exe"), Path::new("C:/r/s1.events"), Path::new("C:/r/s1.status.json"), false);
        let h = &v["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(h["command"], "C:/k/Kova.exe");
        assert_eq!(h["args"], json!(["hook", "stop", "C:/r/s1.events"]));
        assert_eq!(v["hooks"]["Notification"][0]["matcher"], ATTENTION_MATCHER);
        assert_eq!(v["statusLine"]["command"], "C:/k/Kova.exe status C:/r/s1.status.json");
    }
}

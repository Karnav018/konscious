//! Launch environment for child processes.
//!
//! A macOS app started from Finder inherits a bare environment
//! (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, no `LANG`), so `claude` from Homebrew
//! or npm is invisible. A dev build started from a terminal has the opposite
//! problem: it inherits that terminal's variables, including `CLAUDECODE=1`
//! and friends when the terminal is itself a Claude Code session.
//!
//! We capture the user's *login* environment once by running `$SHELL -ilc`
//! from a cleared environment, then scrub terminal- and Claude-session-specific
//! variables so every PTY starts as if opened in a fresh terminal.
//!
//! Windows has no login-shell step: a GUI app already gets the user's full
//! environment from the registry. Terminal panes run PowerShell, `claude.exe`
//! is found on `Path` (note the casing) or in the native installer's folder.

use std::collections::BTreeMap;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::sync::{wait_timeout_while, Lock};

// Login-shell capture markers (macOS/Linux; Windows has no login shell).
#[cfg_attr(windows, allow(dead_code))]
const BEGIN: &str = "__CW_ENV_BEGIN__";
#[cfg_attr(windows, allow(dead_code))]
const END: &str = "__CW_ENV_END__";
#[cfg(unix)]
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(unix)]
const FALLBACK_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const PATH_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Variables that describe the *parent* terminal or Claude session rather than
/// the user's configuration. Only exact names: other `CLAUDE_CODE_*` variables
/// (e.g. `CLAUDE_CODE_USE_BEDROCK`) are genuine user config and must survive.
const SCRUB_EXACT: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CLAUDE_ENV_FILE",
    "CLAUDE_PROJECT_DIR",
    "TERM_SESSION_ID",
    "PWD",
    "OLDPWD",
    "SHLVL",
    "_",
    "CW_SESSION_ID",
];
const SCRUB_PREFIX: &[&str] = &[
    "TERM_PROGRAM",
    "__CF",
    "ITERM_",
    "VSCODE_",
    "GHOSTTY_",
    "KITTY_",
    "TMUX",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    pub shell: String,
    pub home: String,
    pub claude_path: Option<String>,
    pub claude_version: Option<String>,
    /// "login-shell" when capture worked, "fallback" otherwise.
    pub source: String,
}

#[derive(Clone, Debug)]
pub struct ResolvedEnv {
    pub vars: BTreeMap<String, String>,
    pub info: EnvInfo,
}

impl ResolvedEnv {
    pub fn claude_config_dir(&self) -> PathBuf {
        self.vars
            .get("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&self.info.home).join(".claude"))
    }
}

/// Resolved once in the background; commands that need it wait with a timeout.
pub struct EnvHandle {
    slot: Mutex<Option<Arc<ResolvedEnv>>>,
    cv: Condvar,
}

impl EnvHandle {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { slot: Mutex::new(None), cv: Condvar::new() })
    }

    pub fn resolve_in_background(self: &Arc<Self>, claude_override: Option<String>) {
        let me = Arc::clone(self);
        std::thread::Builder::new()
            .name("cw-env".into())
            .spawn(move || me.set(resolve(claude_override.as_deref())))
            .expect("spawn env thread");
    }

    pub fn set(&self, env: ResolvedEnv) {
        *self.slot.locked() = Some(Arc::new(env));
        self.cv.notify_all();
    }

    #[cfg(test)]
    pub fn set_for_tests(&self, env: ResolvedEnv) {
        self.set(env)
    }

    pub fn get(&self, timeout: Duration) -> Option<Arc<ResolvedEnv>> {
        let guard = self.slot.locked();
        wait_timeout_while(&self.cv, guard, timeout, |slot| slot.is_none()).clone()
    }
}

#[cfg(unix)]
fn user_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/zsh".into())
}

/// Terminal panes on Windows: PowerShell 7 if installed, else Windows PowerShell.
#[cfg(windows)]
fn user_shell() -> String {
    let path = std::env::var("PATH").unwrap_or_default();
    which("pwsh.exe", &path)
        .or_else(|| which("powershell.exe", &path))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
            format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe")
        })
}

/// The user's home directory.
#[cfg(unix)]
pub fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

#[cfg(windows)]
pub fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| r"C:\".into())
}

/// Case-insensitive on Windows, where the PATH variable is usually `Path`.
pub fn var<'a>(vars: &'a BTreeMap<String, String>, name: &str) -> Option<&'a String> {
    if cfg!(windows) {
        vars.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v)
    } else {
        vars.get(name)
    }
}

/// Helper processes (`claude --version`, `git`) must not flash a console
/// window when started from a GUI app on Windows.
pub fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[cfg(unix)]
fn platform_env(shell: &str, home: &str) -> (BTreeMap<String, String>, &'static str) {
    match capture_login_env(shell, home) {
        Some(v) => (v, "login-shell"),
        None => (std::env::vars().collect(), "fallback"),
    }
}

#[cfg(windows)]
fn platform_env(_shell: &str, _home: &str) -> (BTreeMap<String, String>, &'static str) {
    (std::env::vars().collect(), "windows")
}

pub fn resolve(claude_override: Option<&str>) -> ResolvedEnv {
    let shell = user_shell();
    let home = home_dir();
    let (mut vars, source) = platform_env(&shell, &home);
    scrub(&mut vars);
    apply_defaults(&mut vars, &shell);

    let claude_path = find_claude(claude_override, &vars, &home);
    let claude_version = claude_path.as_deref().and_then(|p| claude_version(p, &vars));
    ResolvedEnv {
        info: EnvInfo {
            shell,
            home,
            claude_path: claude_path.map(|p| p.to_string_lossy().into_owned()),
            claude_version,
            source: source.into(),
        },
        vars,
    }
}

/// `$SHELL -ilc 'printf BEGIN; env -0; printf END'` from a minimal environment.
#[cfg(unix)]
fn capture_login_env(shell: &str, home: &str) -> Option<BTreeMap<String, String>> {
    let script = format!("printf '\\n{BEGIN}\\n'; env -0; printf '\\n{END}\\n'");
    let mut cmd = Command::new(shell);
    cmd.args(["-ilc", &script])
        .env_clear()
        .env("HOME", home)
        .env("SHELL", shell)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("TERM", "dumb")
        .current_dir(home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    // Linux keeps the desktop session in the app's environment, not in rc
    // files: without these a pane has no display, clipboard, session bus or
    // SSH agent (wl-paste, xdg-open, Claude's image paste all fail).
    #[cfg(target_os = "linux")]
    const SESSION: &[&str] = &[
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XAUTHORITY",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "XDG_CURRENT_DESKTOP",
        "DBUS_SESSION_BUS_ADDRESS",
        "SSH_AUTH_SOCK",
    ];
    #[cfg(not(target_os = "linux"))]
    const SESSION: &[&str] = &[];
    for &key in ["USER", "LOGNAME", "TMPDIR", "LANG"].iter().chain(SESSION) {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    let mut child = cmd.spawn().ok()?;
    let pid = child.id() as i32;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + CAPTURE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                // Timed out (slow rc files) or error: kill the whole group so
                // anything the rc files spawned dies too.
                unsafe { libc::killpg(pid, libc::SIGKILL) };
                let _ = child.wait();
                return None;
            }
        }
    }
    let out = reader.join().ok()?;
    parse_env_block(&out)
}

#[cfg_attr(windows, allow(dead_code))]
pub fn parse_env_block(out: &[u8]) -> Option<BTreeMap<String, String>> {
    let text = String::from_utf8_lossy(out);
    let start = text.find(&format!("\n{BEGIN}\n"))? + BEGIN.len() + 2;
    let end = text.rfind(&format!("\n{END}\n"))?;
    if end < start {
        return None;
    }
    let vars: BTreeMap<String, String> = text[start..end]
        .split('\0')
        .filter_map(|entry| {
            let (k, v) = entry.split_once('=')?;
            (!k.is_empty()).then(|| (k.to_string(), v.to_string()))
        })
        .collect();
    vars.contains_key("PATH").then_some(vars)
}

pub fn scrub(vars: &mut BTreeMap<String, String>) {
    vars.retain(|k, _| {
        !SCRUB_EXACT.contains(&k.as_str()) && !SCRUB_PREFIX.iter().any(|p| k.starts_with(p))
    });
}

#[cfg_attr(windows, allow(unused_variables))]
fn apply_defaults(vars: &mut BTreeMap<String, String>, shell: &str) {
    vars.insert("TERM".into(), "xterm-256color".into());
    vars.insert("COLORTERM".into(), "truecolor".into());
    vars.insert("TERM_PROGRAM".into(), "Konscious".into());
    vars.insert("TERM_PROGRAM_VERSION".into(), env!("CARGO_PKG_VERSION").into());
    // Unix only: on Windows a SHELL variable could make Claude look for bash,
    // and PATH already exists (as "Path") — adding "PATH" would duplicate it.
    #[cfg(unix)]
    {
        vars.entry("SHELL".into()).or_insert_with(|| shell.into());
        vars.entry("PATH".into()).or_insert_with(|| FALLBACK_PATH.into());
        if !vars.contains_key("LANG") && !vars.contains_key("LC_ALL") {
            vars.insert("LANG".into(), "en_US.UTF-8".into());
        }
    }
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

pub fn which(program: &str, path_var: &str) -> Option<PathBuf> {
    path_var
        .split(PATH_SEP)
        .filter(|d| !d.is_empty())
        .map(|d| Path::new(d).join(program))
        .find(|p| is_executable(p))
}

#[cfg(unix)]
fn find_claude(
    override_path: Option<&str>,
    vars: &BTreeMap<String, String>,
    home: &str,
) -> Option<PathBuf> {
    if let Some(p) = override_path.map(PathBuf::from).filter(|p| is_executable(p)) {
        return Some(p);
    }
    if let Some(p) = var(vars, "PATH").and_then(|path| which("claude", path)) {
        return Some(p);
    }
    let local = format!("{home}/.local/bin:{home}/.claude/local");
    which("claude", &format!("{FALLBACK_PATH}:{local}"))
}

/// Native installer: `%USERPROFILE%\.local\bin\claude.exe`; WinGet links;
/// last, an npm `claude.cmd` shim (launched through cmd.exe).
#[cfg(windows)]
fn find_claude(
    override_path: Option<&str>,
    vars: &BTreeMap<String, String>,
    home: &str,
) -> Option<PathBuf> {
    if let Some(p) = override_path.map(PathBuf::from).filter(|p| is_executable(p)) {
        return Some(p);
    }
    let path = var(vars, "PATH").cloned().unwrap_or_default();
    let local_app = var(vars, "LOCALAPPDATA").cloned().unwrap_or_default();
    let known = format!(r"{home}\.local\bin;{local_app}\Microsoft\WinGet\Links");
    which("claude.exe", &path)
        .or_else(|| which("claude.exe", &known))
        .or_else(|| which("claude.cmd", &path))
}

fn claude_version(path: &Path, vars: &BTreeMap<String, String>) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version")
        .env_clear()
        .envs(vars)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    cmd.process_group(0);
    no_window(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    #[cfg(unix)]
    let pid = child.id() as i32;
    let deadline = Instant::now() + Duration::from_secs(5);
    while child.try_wait().ok()?.is_none() {
        if Instant::now() > deadline {
            #[cfg(unix)]
            unsafe {
                libc::killpg(pid, libc::SIGKILL)
            };
            #[cfg(windows)]
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    // "2.1.284 (Claude Code)" -> "2.1.284"
    out.split_whitespace().next().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_env_between_markers_ignoring_rc_noise() {
        let mut raw = b"welcome to zsh\n\n__CW_ENV_BEGIN__\n".to_vec();
        raw.extend_from_slice(b"PATH=/opt/homebrew/bin:/usr/bin\0HOME=/Users/k\0MULTI=a=b\0");
        raw.extend_from_slice(b"\n__CW_ENV_END__\nbye\n");
        let vars = parse_env_block(&raw).unwrap();
        assert_eq!(vars["PATH"], "/opt/homebrew/bin:/usr/bin");
        assert_eq!(vars["MULTI"], "a=b");
        assert_eq!(vars.len(), 3);
    }

    #[test]
    fn parse_requires_markers_and_path() {
        assert!(parse_env_block(b"no markers").is_none());
        assert!(parse_env_block(b"\n__CW_ENV_BEGIN__\nHOME=/x\0\n__CW_ENV_END__\n").is_none());
    }

    #[test]
    fn scrub_removes_parent_session_vars_but_keeps_user_config() {
        let mut vars: BTreeMap<String, String> = [
            "CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_TOKEN", "TERM_PROGRAM",
            "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "__CFBundleIdentifier", "PWD", "SHLVL",
            "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CONFIG_DIR", "PATH", "ANTHROPIC_MODEL",
        ]
        .iter()
        .map(|k| (k.to_string(), "x".to_string()))
        .collect();
        scrub(&mut vars);
        let kept: Vec<_> = vars.keys().cloned().collect();
        assert_eq!(kept, ["ANTHROPIC_MODEL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CONFIG_DIR", "PATH"]);
    }

    #[cfg(unix)]
    #[test]
    fn defaults_set_terminal_identity_and_lang() {
        let mut vars = BTreeMap::new();
        apply_defaults(&mut vars, "/bin/zsh");
        assert_eq!(vars["TERM"], "xterm-256color");
        assert_eq!(vars["TERM_PROGRAM"], "Konscious");
        assert_eq!(vars["LANG"], "en_US.UTF-8");
        assert_eq!(vars["PATH"], FALLBACK_PATH);
    }
}

#[cfg(all(test, unix))]
mod live {
    /// `env -i HOME=$HOME USER=$USER cargo test -- --ignored live` simulates a
    /// Finder launch: no PATH beyond the system default, no LANG.
    #[test]
    #[ignore]
    fn live_login_env() {
        let env = super::resolve(None);
        eprintln!("source={} claude={:?} version={:?}", env.info.source, env.info.claude_path, env.info.claude_version);
        eprintln!("LANG={:?} TERM_PROGRAM={:?} CLAUDECODE={:?}", env.vars.get("LANG"), env.vars.get("TERM_PROGRAM"), env.vars.get("CLAUDECODE"));
        assert_eq!(env.info.source, "login-shell");
        assert!(env.info.claude_path.is_some());
        assert!(!env.vars.contains_key("CLAUDECODE"));
    }
}

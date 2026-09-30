//! Builds the exact argv/env/cwd for a session. Rust only ever executes the
//! resolved `claude` binary or the user's `$SHELL` — never a command string
//! supplied by the frontend.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: BTreeMap<String, String>,
}

/// Display names go into `--name=`; strip control characters so a name can
/// never smuggle newlines or escape sequences into argv or the terminal title.
pub fn sanitize_name(name: &str) -> String {
    let clean: String = name.chars().filter(|c| !c.is_control()).collect();
    let clean = clean.trim();
    let clean: String = clean.chars().take(80).collect();
    if clean.is_empty() { "Untitled".into() } else { clean }
}

/// `--name=<name>` (single token) so a name starting with `-` is never parsed
/// as a flag. `--resume` when Claude already has a transcript for this id,
/// otherwise `--session-id` pins the id we chose. `fork` resumes into a copy.
pub fn claude_args(name: &str, settings: &Path, session: &Uuid, resume: bool, fork: bool) -> Vec<String> {
    let mut args = vec![
        format!("--name={}", sanitize_name(name)),
        "--settings".into(),
        settings.to_string_lossy().into_owned(),
    ];
    args.push(if resume { "--resume" } else { "--session-id" }.into());
    args.push(session.to_string());
    if resume && fork {
        args.push("--fork-session".into());
    }
    args
}

/// Terminal panes: a login zsh/bash on macOS/Linux, PowerShell on Windows.
pub fn shell_args() -> Vec<String> {
    if cfg!(windows) { vec!["-NoLogo".into()] } else { vec!["-l".into()] }
}

/// Windows can't start a `.cmd`/`.bat` (e.g. an npm `claude.cmd` shim)
/// directly; run it through `cmd.exe /d /c`. Everything else is unchanged.
pub fn runnable(program: PathBuf, args: Vec<String>) -> (PathBuf, Vec<String>) {
    let is_script = program
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    if cfg!(windows) && is_script {
        let mut wrapped = vec!["/d".into(), "/c".into(), program.to_string_lossy().into_owned()];
        wrapped.extend(args);
        (PathBuf::from("cmd.exe"), wrapped)
    } else {
        (program, args)
    }
}

/// True when `<config>/projects/*/<id>.jsonl` exists and is non-empty.
pub fn transcript_exists(config_dir: &Path, session: &Uuid) -> bool {
    let Ok(projects) = std::fs::read_dir(config_dir.join("projects")) else {
        return false;
    };
    let file = format!("{session}.jsonl");
    projects
        .flatten()
        .any(|dir| dir.path().join(&file).metadata().map(|m| m.len() > 0).unwrap_or(false))
}

/// Expands `~`, requires an existing directory, returns the canonical path.
/// portable-pty silently falls back to `$HOME` for a bad cwd, so this check
/// is what guarantees a session runs where the UI says it does.
pub fn validate_cwd(cwd: &str, home: &str) -> AppResult<PathBuf> {
    let expanded = match cwd.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("{home}{rest}"),
        _ => cwd.to_string(),
    };
    let path = PathBuf::from(&expanded);
    if !path.is_absolute() {
        return Err(AppError::Invalid(format!("Directory must be an absolute path: {cwd}")));
    }
    if !path.is_dir() {
        return Err(AppError::NotFound(format!("Directory does not exist: {cwd}")));
    }
    Ok(path.canonicalize()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_session_pins_id_and_name_is_one_token() {
        let id = Uuid::parse_str("a3f9c2e1-47bd-4e0a-9d2b-000000000001").unwrap();
        let args = claude_args("--dangerously-skip-permissions", Path::new("/r/s.json"), &id, false, true);
        assert_eq!(
            args,
            [
                "--name=--dangerously-skip-permissions",
                "--settings",
                "/r/s.json",
                "--session-id",
                "a3f9c2e1-47bd-4e0a-9d2b-000000000001"
            ]
        );
    }

    #[test]
    fn existing_transcript_resumes() {
        let id = Uuid::new_v4();
        let args = claude_args("Backend", Path::new("/s.json"), &id, true, false);
        assert_eq!(args[3], "--resume");
        assert_eq!(args[4], id.to_string());
        assert_eq!(args.len(), 5);
        let forked = claude_args("Backend", Path::new("/s.json"), &id, true, true);
        assert_eq!(forked.last().unwrap(), "--fork-session");
    }

    #[test]
    fn sanitize_strips_controls_and_defaults() {
        assert_eq!(sanitize_name("  Back\nend\x1b[31m "), "Backend[31m");
        assert_eq!(sanitize_name("\t\n"), "Untitled");
        assert_eq!(sanitize_name(&"x".repeat(200)).len(), 80);
    }

    #[test]
    fn transcript_lookup_scans_every_project_dir() {
        let dir = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4();
        assert!(!transcript_exists(dir.path(), &id));
        let proj = dir.path().join("projects").join("-Users-k-hawk");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join(format!("{id}.jsonl")), "").unwrap();
        assert!(!transcript_exists(dir.path(), &id), "empty transcript is not resumable");
        std::fs::write(proj.join(format!("{id}.jsonl")), "{}\n").unwrap();
        assert!(transcript_exists(dir.path(), &id));
    }

    #[test]
    fn cwd_must_exist_and_expands_tilde() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().to_str().unwrap();
        std::fs::create_dir(dir.path().join("proj")).unwrap();
        assert!(validate_cwd("~/proj", home).is_ok());
        assert!(matches!(validate_cwd("~/missing", home), Err(AppError::NotFound(_))));
        assert!(matches!(validate_cwd("relative", home), Err(AppError::Invalid(_))));
    }
}

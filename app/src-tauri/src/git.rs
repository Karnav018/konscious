//! Read-only Git visibility via the git CLI (PRD §23). The slice needs only
//! the branch and short commit for pane headers and the inspector.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: String,
    pub commit: String,
}

fn git(cwd: &Path, env: &BTreeMap<String, String>, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    crate::env::no_window(&mut cmd);
    let out = cmd
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env_clear()
        .envs(env)
        // Never take index.lock: we're a background reader beside the user's git.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn info(cwd: &Path, env: &BTreeMap<String, String>) -> Option<GitInfo> {
    let commit = git(cwd, env, &["rev-parse", "--short", "HEAD"])?;
    let branch = git(cwd, env, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|b| b != "HEAD")
        .unwrap_or_else(|| format!("detached@{commit}"));
    Some(GitInfo { branch, commit })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_branch_and_commit_and_none_outside_repos() {
        let dir = tempfile::tempdir().unwrap();
        let env = BTreeMap::from([
            ("PATH".to_string(), "/usr/bin:/bin:/opt/homebrew/bin".to_string()),
            ("HOME".to_string(), dir.path().to_string_lossy().into_owned()),
        ]);
        assert!(info(dir.path(), &env).is_none());
        let run = |args: &[&str]| {
            Command::new("git").arg("-C").arg(dir.path()).args(args).envs(&env).output().unwrap()
        };
        run(&["init", "-q", "-b", "feature/auth"]);
        run(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"]);
        let gi = info(dir.path(), &env).unwrap();
        assert_eq!(gi.branch, "feature/auth");
        assert!(gi.commit.len() >= 7);
    }
}

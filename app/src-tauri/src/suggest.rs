//! Folder suggestions for the first-run screen and the New Session modal.
//! Deliberately never scans ~/Desktop or ~/Documents: those trigger macOS
//! privacy prompts, and the user can always pick them with "Choose folder…".

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

const ROOTS: &[&str] = &["projects", "Projects", "Products", "code", "Code", "src", "dev", "Developer", "repos", "work"];

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub path: String,
    pub name: String,
    /// "~/projects" — the root it was found in, for the "Found in …" label.
    pub root: String,
}

fn visible_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect()
}

/// Immediate, non-hidden subdirectories (for `./backend`-style chips).
pub fn subdirs(dir: &Path, limit: usize) -> Vec<String> {
    let mut names: Vec<String> = visible_dirs(dir)
        .iter()
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .filter(|n| !matches!(n.as_str(), "node_modules" | "target" | "dist" | "build"))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.truncate(limit);
    names
}

/// Git repositories one level below common project roots, newest first.
pub fn folders(home: &Path, limit: usize) -> Vec<Suggestion> {
    let mut found: Vec<(SystemTime, Suggestion)> = Vec::new();
    let mut seen_roots = std::collections::HashSet::new();
    for root_name in ROOTS {
        let root = home.join(root_name);
        // Case-insensitive filesystems report ~/projects and ~/Projects as one.
        let Ok(canon) = root.canonicalize() else { continue };
        if !seen_roots.insert(canon) {
            continue;
        }
        for repo in visible_dirs(&root).into_iter().filter(|d| d.join(".git").exists()) {
            let mtime = repo.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
            found.push((
                mtime,
                Suggestion {
                    name: repo.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    path: repo.to_string_lossy().into_owned(),
                    root: format!("~/{root_name}"),
                },
            ));
        }
    }
    found.sort_by_key(|(mtime, _)| std::cmp::Reverse(*mtime));
    found.into_iter().take(limit).map(|(_, s)| s).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subdirs_skip_hidden_and_build_dirs() {
        let dir = tempfile::tempdir().unwrap();
        for d in ["backend", ".git", "node_modules", "Frontend"] {
            std::fs::create_dir(dir.path().join(d)).unwrap();
        }
        std::fs::write(dir.path().join("README.md"), "").unwrap();
        assert_eq!(subdirs(dir.path(), 10), ["backend", "Frontend"]);
    }

    #[test]
    fn folders_finds_git_repos_under_roots() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join("projects/hawk/.git")).unwrap();
        std::fs::create_dir_all(home.path().join("projects/notes")).unwrap();
        let s = folders(home.path(), 6);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].name, "hawk");
        assert!(s[0].root.eq_ignore_ascii_case("~/projects"));
    }
}

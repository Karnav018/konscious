//! Exporting a workspace to a zip, and importing one back.
//!
//! The point of a bundle is moving a project between machines. The metadata is
//! small; the payload is Claude's own transcripts, without which an imported
//! session resumes with no memory of anything.
//!
//! Two things make this more than copying files:
//!
//!   · Paths are absolute in our data and differ on every machine, so a
//!     session's cwd is stored relative to the workspace root and rebuilt
//!     against the root chosen on import.
//!   · Claude keeps a transcript under `~/.claude/projects/<slug>/<id>.jsonl`,
//!     where the slug is the absolute path with every non-alphanumeric
//!     character replaced by a dash. That is computed for the destination, so
//!     `/Users/a/code/x` and `C:\code\x` both land where Claude will look.
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use zip::write::SimpleFileOptions;

use crate::error::{AppError, AppResult};

fn zip_failed(e: zip::result::ZipError) -> AppError {
    AppError::Io(std::io::Error::other(e.to_string()))
}

/// What the zip holds besides the manifest.
const TRANSCRIPTS: &str = "transcripts";
const MANIFEST: &str = "manifest.json";
/// Bundles this build can read.
pub const BUNDLE_VERSION: u32 = 1;

/// Claude's own project-folder encoding: every character that is not a letter
/// or a digit becomes a dash. Lossy by Claude's design — two different paths
/// can produce one slug — so an import can land beside an unrelated project.
pub fn slug_for(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// A session's directory as an offset from the workspace root, with forward
/// slashes so a bundle reads the same on either platform. `None` when the
/// session lives outside the root, in which case it keeps its own path.
pub fn relative_to(root: &str, cwd: &str) -> Option<String> {
    let (root, cwd) = (normalise(root), normalise(cwd));
    if cwd == root {
        return Some(String::new());
    }
    cwd.strip_prefix(&format!("{root}/")).map(|rest| rest.to_string())
}

/// The other direction: a root on this machine plus an offset from the bundle.
pub fn rebase(root: &str, relative: &str) -> PathBuf {
    let root = PathBuf::from(root);
    if relative.is_empty() {
        return root;
    }
    relative.split('/').filter(|p| !p.is_empty() && *p != "..").fold(root, |acc, part| acc.join(part))
}

/// Trailing separators off, backslashes to forward, so comparisons hold on
/// either platform.
fn normalise(path: &str) -> String {
    let swapped = path.replace('\\', "/");
    swapped.trim_end_matches('/').to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleSession {
    pub id: String,
    pub name: String,
    pub kind: String,
    /// Where the session ran, as an offset from the workspace root.
    pub relative: String,
    /// True when the session ran outside the workspace root, so its offset is
    /// a guess: the import places it at the root and says so.
    #[serde(default)]
    pub outside: bool,
    /// The Claude conversation, and the name of its file in the zip.
    pub claude_session_id: Option<String>,
    /// False when no transcript was found, so the import can say so.
    pub has_transcript: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub app: String,
    pub platform: String,
    pub exported_at: String,
    pub workspace_name: String,
    /// The root the sessions were relative to, for showing where it came from.
    pub source_root: String,
    pub sessions: Vec<BundleSession>,
    /// The workspace's layout, carried through untouched.
    pub layout: Value,
}

/// Writes the bundle. `transcripts` maps a conversation id to the file to copy.
pub fn write(dest: &Path, manifest: &Manifest, transcripts: &[(String, PathBuf)]) -> AppResult<u64> {
    let file = File::create(dest)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(MANIFEST, opts).map_err(zip_failed)?;
    let json = serde_json::to_vec_pretty(manifest)?;
    zip.write_all(&json)?;

    for (id, path) in transcripts {
        let Ok(bytes) = fs::read(path) else { continue };
        zip.start_file(format!("{TRANSCRIPTS}/{id}.jsonl"), opts).map_err(zip_failed)?;
        zip.write_all(&bytes)?;
    }
    let out = zip.finish().map_err(zip_failed)?;
    Ok(out.metadata().map(|m| m.len()).unwrap_or(0))
}

/// Reads just the manifest, so the user can see what a bundle holds before
/// anything is written.
pub fn read_manifest(src: &Path) -> AppResult<Manifest> {
    let file = File::open(src)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| AppError::Invalid("Not a Konscious bundle".into()))?;
    let mut entry = zip
        .by_name(MANIFEST)
        .map_err(|_| AppError::Invalid("This zip has no manifest — it is not a Konscious bundle".into()))?;
    let mut text = String::new();
    entry.read_to_string(&mut text)?;
    let manifest: Manifest =
        serde_json::from_str(&text).map_err(|_| AppError::Invalid("The bundle's manifest is unreadable".into()))?;
    if manifest.version > BUNDLE_VERSION {
        return Err(AppError::Invalid(format!(
            "This bundle was made by a newer Konscious (format {}). Update first.",
            manifest.version
        )));
    }
    Ok(manifest)
}

/// What an import wrote, so the interface can report it honestly.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub transcripts: usize,
    pub missing: usize,
}

/// Copies each transcript to where Claude will look for it, given the root
/// the user picked on this machine. Never overwrites: a conversation already
/// here is the one to keep.
pub fn import_transcripts(src: &Path, claude_config: &Path, root: &str, manifest: &Manifest) -> AppResult<Imported> {
    let file = File::open(src)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| AppError::Invalid("Not a Konscious bundle".into()))?;
    let mut out = Imported::default();

    for session in &manifest.sessions {
        let Some(conversation) = session.claude_session_id.clone() else { continue };
        if !session.has_transcript {
            out.missing += 1;
            continue;
        }
        let cwd = rebase(root, &session.relative);
        let dir = claude_config.join("projects").join(slug_for(&cwd.to_string_lossy()));
        let dest = dir.join(format!("{conversation}.jsonl"));
        if dest.exists() {
            continue;
        }
        let mut entry = match zip.by_name(&format!("{TRANSCRIPTS}/{conversation}.jsonl")) {
            Ok(e) => e,
            Err(_) => {
                out.missing += 1;
                continue;
            }
        };
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        fs::create_dir_all(&dir)?;
        fs::write(&dest, &bytes)?;
        out.transcripts += 1;
    }
    Ok(out)
}

/// The transcript Claude holds for a conversation, wherever it filed it.
/// Scanning rather than computing the slug: the encoding is lossy, and a
/// folder may have been written for a path the session has since moved from.
pub fn find_transcript(claude_config: &Path, conversation: &str) -> Option<PathBuf> {
    let file = format!("{conversation}.jsonl");
    let projects = fs::read_dir(claude_config.join("projects")).ok()?;
    projects
        .flatten()
        .map(|dir| dir.path().join(&file))
        .find(|p| p.metadata().map(|m| m.len() > 0).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_path_the_way_claude_does() {
        assert_eq!(slug_for("/Users/pc-ln/Documents/products/konscious"), "-Users-pc-ln-Documents-products-konscious");
        // Windows: the colon and the backslashes each become a dash.
        assert_eq!(slug_for(r"C:\git\cc-plus"), "C--git-cc-plus");
        // Underscores and dots go too, which is Claude's own lossiness.
        assert_eq!(slug_for("/a/my_app.v2"), "-a-my-app-v2");
    }

    #[test]
    fn a_session_inside_the_root_is_stored_as_an_offset() {
        assert_eq!(relative_to("/p/app", "/p/app/web"), Some("web".into()));
        assert_eq!(relative_to("/p/app", "/p/app"), Some("".into()));
        assert_eq!(relative_to("/p/app/", "/p/app/web/api"), Some("web/api".into()));
        assert_eq!(relative_to(r"C:\p\app", r"C:\p\app\web"), Some("web".into()));
    }

    #[test]
    fn a_session_outside_the_root_has_no_offset() {
        assert_eq!(relative_to("/p/app", "/elsewhere"), None);
        // A sibling whose name merely starts the same is still outside.
        assert_eq!(relative_to("/p/app", "/p/application"), None);
    }

    #[test]
    fn rebuilds_a_path_against_the_root_on_this_machine() {
        assert_eq!(rebase("/new/place", "web"), PathBuf::from("/new/place/web"));
        assert_eq!(rebase("/new/place", ""), PathBuf::from("/new/place"));
        assert_eq!(rebase("/new/place", "web/api"), PathBuf::from("/new/place/web/api"));
    }

    #[test]
    fn an_offset_cannot_climb_out_of_the_root() {
        // A hostile bundle must not write outside where the user pointed.
        assert_eq!(rebase("/new/place", "../../etc"), PathBuf::from("/new/place/etc"));
        assert_eq!(rebase("/new/place", "../.."), PathBuf::from("/new/place"));
    }

    fn manifest(sessions: Vec<BundleSession>) -> Manifest {
        Manifest {
            version: BUNDLE_VERSION,
            app: env!("CARGO_PKG_VERSION").into(),
            platform: "macos".into(),
            exported_at: "2026-10-04T00:00:00Z".into(),
            workspace_name: "konscious".into(),
            source_root: "/p/app".into(),
            sessions,
            layout: serde_json::json!({ "mode": "grid", "open": [] }),
        }
    }

    fn session(id: &str, conversation: Option<&str>, has: bool) -> BundleSession {
        BundleSession {
            id: id.into(),
            name: id.into(),
            kind: "claude".into(),
            relative: "".into(),
            outside: false,
            claude_session_id: conversation.map(str::to_string),
            has_transcript: has,
        }
    }

    #[test]
    fn writes_and_reads_a_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("conv.jsonl");
        fs::write(&transcript, b"{\"a\":1}\n").unwrap();
        let zip_path = dir.path().join("out.zip");
        let m = manifest(vec![session("s1", Some("conv"), true)]);
        let size = write(&zip_path, &m, &[("conv".into(), transcript)]).unwrap();
        assert!(size > 0);

        let back = read_manifest(&zip_path).unwrap();
        assert_eq!(back.workspace_name, "konscious");
        assert_eq!(back.sessions.len(), 1);
        assert_eq!(back.sessions[0].claude_session_id.as_deref(), Some("conv"));
    }

    #[test]
    fn refuses_a_zip_that_is_not_a_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("random.zip");
        let file = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("hello.txt", SimpleFileOptions::default()).unwrap();
        zip.write_all(b"hi").unwrap();
        zip.finish().unwrap();
        assert!(read_manifest(&path).is_err());
    }

    #[test]
    fn refuses_a_bundle_from_a_newer_build() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("future.zip");
        let mut m = manifest(vec![]);
        m.version = BUNDLE_VERSION + 1;
        write(&path, &m, &[]).unwrap();
        let err = read_manifest(&path).unwrap_err();
        assert!(format!("{err:?}").contains("newer"), "{err:?}");
    }

    #[test]
    fn imports_a_transcript_where_claude_will_look_for_it() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("conv.jsonl");
        fs::write(&transcript, b"{\"a\":1}\n").unwrap();
        let zip_path = dir.path().join("out.zip");
        let mut m = manifest(vec![session("s1", Some("conv"), true)]);
        m.sessions[0].relative = "web".into();
        write(&zip_path, &m, &[("conv".into(), transcript)]).unwrap();

        let config = dir.path().join("claude");
        let root = dir.path().join("fresh");
        let out = import_transcripts(&zip_path, &config, &root.to_string_lossy(), &m).unwrap();
        assert_eq!(out.transcripts, 1);
        let expected = config
            .join("projects")
            .join(slug_for(&root.join("web").to_string_lossy()))
            .join("conv.jsonl");
        assert!(expected.exists(), "transcript not at {expected:?}");
    }

    #[test]
    fn never_overwrites_a_conversation_already_here() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("conv.jsonl");
        fs::write(&transcript, b"imported\n").unwrap();
        let zip_path = dir.path().join("out.zip");
        let m = manifest(vec![session("s1", Some("conv"), true)]);
        write(&zip_path, &m, &[("conv".into(), transcript)]).unwrap();

        let config = dir.path().join("claude");
        let root = dir.path().join("fresh");
        let dest = config.join("projects").join(slug_for(&root.to_string_lossy()));
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("conv.jsonl"), b"mine\n").unwrap();

        let out = import_transcripts(&zip_path, &config, &root.to_string_lossy(), &m).unwrap();
        assert_eq!(out.transcripts, 0, "an existing conversation must be left alone");
        assert_eq!(fs::read_to_string(dest.join("conv.jsonl")).unwrap(), "mine\n");
    }

    #[test]
    fn counts_a_session_whose_transcript_never_made_it_in() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("out.zip");
        let m = manifest(vec![session("s1", Some("gone"), true), session("s2", None, false)]);
        write(&zip_path, &m, &[]).unwrap();
        let out = import_transcripts(&zip_path, &dir.path().join("claude"), "/tmp/x", &m).unwrap();
        assert_eq!(out.transcripts, 0);
        assert_eq!(out.missing, 1, "a shell session has no conversation to miss");
    }

    #[test]
    fn finds_a_transcript_wherever_claude_filed_it() {
        let dir = tempfile::tempdir().unwrap();
        let projects = dir.path().join("projects").join("-some-other-path");
        fs::create_dir_all(&projects).unwrap();
        fs::write(projects.join("abc.jsonl"), b"{}\n").unwrap();
        assert!(find_transcript(dir.path(), "abc").is_some());
        assert!(find_transcript(dir.path(), "nope").is_none());
    }

    #[test]
    fn an_empty_transcript_is_not_worth_exporting() {
        let dir = tempfile::tempdir().unwrap();
        let projects = dir.path().join("projects").join("-p");
        fs::create_dir_all(&projects).unwrap();
        fs::write(projects.join("empty.jsonl"), b"").unwrap();
        assert!(find_transcript(dir.path(), "empty").is_none());
    }
}

//! Lightweight metadata under `~/.kova/` (PRD §26). Rust treats
//! the JSON as opaque apart from a required `version` field — the schema
//! lives with the frontend that owns UI state.
//!
//! Writes are serialized and atomic (tmp → fsync → rename), a corrupt file is
//! set aside as `*.corrupt-<ts>` instead of being overwritten, and an
//! exclusive file lock keeps two app instances from resuming the same sessions.
//!
//! Backups: the first write of each file per app launch rotates the previous
//! version into `<file>.bak1` (→ bak2 → bak3), so the state of the last three
//! launches is always recoverable. A corrupt file is restored automatically
//! from the newest valid backup.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::sync::Lock;

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Option<Value>,
    pub workspaces: Option<Value>,
    pub layouts: BTreeMap<String, Value>,
    /// Files that failed to parse and were set aside.
    pub corrupt: Vec<String>,
    /// Files recovered from a backup after their main copy was unreadable.
    pub restored: Vec<String>,
}

pub enum Target {
    Config,
    Workspaces,
    Layout(String),
}

impl Target {
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "config" => Ok(Target::Config),
            "workspaces" => Ok(Target::Workspaces),
            _ => match s.strip_prefix("layout:") {
                Some(id) if valid_id(id) => Ok(Target::Layout(id.to_string())),
                _ => Err(AppError::Invalid(format!("Unknown save target {s:?}"))),
            },
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub const BACKUPS: usize = 3;

fn backup_path(path: &Path, n: usize) -> PathBuf {
    let mut p = path.as_os_str().to_owned();
    p.push(format!(".bak{n}"));
    PathBuf::from(p)
}

pub struct Store {
    base: PathBuf,
    write_lock: Mutex<()>,
    lock_file: Mutex<Option<File>>,
    rotated: Mutex<HashSet<PathBuf>>,
}

impl Store {
    pub fn new(base: PathBuf) -> Self {
        Self { base, write_lock: Mutex::new(()), lock_file: Mutex::new(None), rotated: Mutex::new(HashSet::new()) }
    }

    pub fn base(&self) -> &Path {
        &self.base
    }

    pub fn run_dir(&self) -> PathBuf {
        self.base.join("run")
    }

    fn path_for(&self, t: &Target) -> PathBuf {
        match t {
            Target::Config => self.base.join("config.json"),
            Target::Workspaces => self.base.join("workspaces.json"),
            Target::Layout(id) => self.base.join("layouts").join(format!("{id}.json")),
        }
    }

    /// Exclusive, non-blocking. Held for the life of the process.
    pub fn acquire_lock(&self) -> bool {
        if fs::create_dir_all(&self.base).is_err() {
            return false;
        }
        let Ok(file) = OpenOptions::new().create(true).truncate(false).write(true).open(self.base.join(".lock")) else {
            return false;
        };
        // flock on Unix, LockFileEx on Windows (std's cross-platform lock).
        let ok = file.try_lock().is_ok();
        if ok {
            *self.lock_file.locked() = Some(file);
        }
        ok
    }

    pub fn load(&self) -> Snapshot {
        let mut snap = Snapshot::default();
        snap.config = self.read_or_restore(&self.path_for(&Target::Config), &mut snap);
        snap.workspaces = self.read_or_restore(&self.path_for(&Target::Workspaces), &mut snap);
        if let Ok(dir) = fs::read_dir(self.base.join("layouts")) {
            for entry in dir.flatten() {
                let path = entry.path();
                let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
                if path.extension().is_some_and(|e| e == "json") && valid_id(&id) {
                    if let Some(v) = self.read_or_restore(&path, &mut snap) {
                        snap.layouts.insert(id, v);
                    }
                }
            }
        }
        snap
    }

    /// Main file if valid; if it is corrupt, the newest valid backup (which
    /// is also written back as the main file so the next save starts clean).
    fn read_or_restore(&self, path: &Path, snap: &mut Snapshot) -> Option<Value> {
        let exists = path.exists();
        if let Some(v) = self.read(path, &mut snap.corrupt) {
            return Some(v);
        }
        if !exists {
            return None; // first run: nothing to restore
        }
        for n in 1..=BACKUPS {
            let bak = backup_path(path, n);
            let Ok(bytes) = fs::read(&bak) else { continue };
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                if v.get("version").is_some_and(Value::is_number) {
                    let _ = write_atomic(path, &bytes);
                    snap.restored.push(path.to_string_lossy().into_owned());
                    return Some(v);
                }
            }
        }
        None
    }

    fn read(&self, path: &Path, corrupt: &mut Vec<String>) -> Option<Value> {
        let bytes = fs::read(path).ok()?;
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(v) if v.get("version").is_some_and(Value::is_number) => Some(v),
            _ => {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let aside = path.with_extension(format!("json.corrupt-{ts}"));
                let _ = fs::rename(path, &aside);
                corrupt.push(aside.to_string_lossy().into_owned());
                None
            }
        }
    }

    pub fn save(&self, target: &Target, data: &Value) -> AppResult<()> {
        if !data.get("version").is_some_and(Value::is_number) {
            return Err(AppError::Invalid("State must carry a numeric \"version\"".into()));
        }
        let bytes = serde_json::to_vec_pretty(data)?;
        let _guard = self.write_lock.locked();
        let path = self.path_for(target);
        if self.rotated.locked().insert(path.clone()) {
            rotate_backups(&path);
        }
        write_atomic(&path, &bytes)?;
        Ok(())
    }

    pub fn delete_layout(&self, id: &str) -> AppResult<()> {
        if !valid_id(id) {
            return Err(AppError::Invalid(format!("Bad workspace id {id:?}")));
        }
        let _guard = self.write_lock.locked();
        match fs::remove_file(self.path_for(&Target::Layout(id.into()))) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    /// Reads `claudePath` from config.json before the frontend is up.
    pub fn claude_path_override(&self) -> Option<String> {
        let bytes = fs::read(self.path_for(&Target::Config)).ok()?;
        let v: Value = serde_json::from_slice(&bytes).ok()?;
        v.get("claudePath")?.as_str().filter(|s| !s.is_empty()).map(str::to_string)
    }
}

/// file.bak2 → bak3, bak1 → bak2, file → bak1 (copy: the main file stays in
/// place until the atomic replace). Best effort — never blocks a save.
fn rotate_backups(path: &Path) {
    if !path.exists() {
        return;
    }
    for n in (1..BACKUPS).rev() {
        let _ = fs::rename(backup_path(path, n), backup_path(path, n + 1));
    }
    let _ = fs::copy(path, backup_path(path, 1));
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("state"),
        std::process::id()
    ));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trip_and_layouts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.save(&Target::Workspaces, &json!({"version": 1, "workspaces": []})).unwrap();
        store.save(&Target::parse("layout:hawk").unwrap(), &json!({"version": 1, "mode": "grid"})).unwrap();
        let snap = store.load();
        assert_eq!(snap.workspaces.unwrap()["version"], 1);
        assert_eq!(snap.layouts["hawk"]["mode"], "grid");
        assert!(snap.config.is_none());
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn corrupt_files_are_set_aside_not_lost() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        fs::write(dir.path().join("workspaces.json"), "{ half written").unwrap();
        let snap = store.load();
        assert!(snap.workspaces.is_none());
        assert_eq!(snap.corrupt.len(), 1);
        assert_eq!(fs::read_to_string(&snap.corrupt[0]).unwrap(), "{ half written");
    }

    #[test]
    fn rejects_unversioned_data_and_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        assert!(store.save(&Target::Config, &json!({"theme": "dark"})).is_err());
        assert!(Target::parse("layout:../../etc").is_err());
        assert!(Target::parse("secrets").is_err());
    }

    #[test]
    fn keeps_one_backup_per_launch_up_to_three() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        for launch in 1..=5 {
            let store = Store::new(dir.path().to_path_buf()); // one Store per launch
            for write in 0..3 {
                store.save(&Target::Config, &json!({"version": 1, "launch": launch, "write": write})).unwrap();
            }
        }
        let launch_of = |p: PathBuf| -> i64 {
            serde_json::from_slice::<Value>(&fs::read(p).unwrap()).unwrap()["launch"].as_i64().unwrap()
        };
        assert_eq!(launch_of(path.clone()), 5);
        assert_eq!(launch_of(backup_path(&path, 1)), 4, "bak1 = final state of the previous launch");
        assert_eq!(launch_of(backup_path(&path, 2)), 3);
        assert_eq!(launch_of(backup_path(&path, 3)), 2);
        assert!(!backup_path(&path, 4).exists());
    }

    #[test]
    fn corrupt_file_is_restored_from_the_newest_valid_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspaces.json");
        fs::write(backup_path(&path, 1), "{ torn").unwrap();
        fs::write(backup_path(&path, 2), r#"{"version":1,"workspaces":["good"]}"#).unwrap();
        fs::write(&path, "garbage").unwrap();
        let snap = Store::new(dir.path().to_path_buf()).load();
        assert_eq!(snap.workspaces.unwrap()["workspaces"][0], "good");
        assert_eq!(snap.restored.len(), 1);
        assert_eq!(snap.corrupt.len(), 1, "the bad file is still kept for inspection");
        let healed: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(healed["version"], 1);
    }

    #[test]
    fn second_lock_holder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let a = Store::new(dir.path().to_path_buf());
        let b = Store::new(dir.path().to_path_buf());
        assert!(a.acquire_lock());
        assert!(!b.acquire_lock());
    }
}

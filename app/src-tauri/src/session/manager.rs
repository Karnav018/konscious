//! Registry of sessions. A session outlives its runs: stopping and resuming
//! keeps the same `OutputSink` (so the frontend channel and replay ring carry
//! over) while each spawn gets a fresh `run_id`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use uuid::Uuid;

use super::model::{Kind, SessionInfo, SessionSpec};
use super::process::{ExitInfo, Process, SpawnCtx};
use super::status::{Status, Tracker};
use crate::claude::hooks::{self, ContextUsage, EventTail, HookEvent, Limits};
use crate::claude::launcher::{self, Launch};
use crate::env::EnvHandle;
use crate::error::{AppError, AppResult};
use crate::sync::Lock;
use crate::terminal::output::{Outlet, OutputSink};

pub const EV_STATUS: &str = "session://status";
pub const EV_CLAUDE_ID: &str = "session://claude-id";
pub const EV_USAGE: &str = "session://usage";
pub const EV_LIMITS: &str = "app://limits";
const TICK: Duration = Duration::from_millis(150);
const RESUME_FAIL_WINDOW: Duration = Duration::from_secs(5);
/// Each running session holds a PTY (several fds) and four threads.
pub const MAX_RUNNING: usize = 64;

pub type Emitter = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

pub struct Session {
    pub id: String,
    spec: Mutex<SessionSpec>,
    sink: Arc<OutputSink>,
    tracker: Arc<Mutex<Tracker>>,
    process: Mutex<Option<Arc<Process>>>,
    tail: Mutex<Option<EventTail>>,
    exit: Mutex<Option<ExitInfo>>,
    last_emitted: Mutex<Option<(u64, Status, bool)>>,
    resumed: AtomicBool,
    resume_failed: AtomicBool,
    pty_size: Mutex<(u16, u16)>,
    /// Status-line feed file and the mtime last read.
    status_feed: Mutex<Option<(PathBuf, Option<std::time::SystemTime>)>>,
    usage: Mutex<Option<ContextUsage>>,
}

impl Session {
    fn new(spec: SessionSpec) -> Self {
        let heuristic_only = spec.kind == Kind::Shell;
        Self {
            id: spec.id.clone(),
            spec: Mutex::new(spec),
            sink: Arc::new(OutputSink::default()),
            tracker: Arc::new(Mutex::new(Tracker::new(heuristic_only, Instant::now()))),
            process: Mutex::new(None),
            tail: Mutex::new(None),
            exit: Mutex::new(None),
            last_emitted: Mutex::new(None),
            resumed: AtomicBool::new(false),
            resume_failed: AtomicBool::new(false),
            pty_size: Mutex::new((120, 32)),
            status_feed: Mutex::new(None),
            usage: Mutex::new(None),
        }
    }

    fn process(&self) -> Option<Arc<Process>> {
        self.process.locked().clone()
    }

    fn running(&self) -> bool {
        self.process().is_some_and(|p| p.is_alive())
    }

    pub fn info(&self) -> SessionInfo {
        let spec = self.spec.locked().clone();
        let proc = self.process();
        let (status, hooks_active) = {
            let t = self.tracker.locked();
            (t.status, t.hooks_active)
        };
        let exit = self.exit.locked().clone();
        let running = proc.as_ref().is_some_and(|p| p.is_alive());
        let (cols, rows) = *self.pty_size.locked();
        SessionInfo {
            id: spec.id,
            kind: spec.kind,
            run_id: proc.as_ref().map_or(0, |p| p.run_id),
            status: if proc.is_none() { Status::Completed } else { status },
            running,
            pid: proc.as_ref().filter(|_| running).map(|p| p.pid),
            exit_code: exit.as_ref().map(|e| e.code),
            exit_signal: exit.and_then(|e| e.signal),
            hooks_active,
            claude_session_id: spec.claude_session_id,
            cwd: spec.cwd,
            started_at: proc.as_ref().map(|p| p.started_wall_ms),
            resume_failed: self.resume_failed.load(Ordering::SeqCst),
            cols,
            rows,
        }
    }
}

pub struct SessionManager {
    emit: Emitter,
    env: Arc<EnvHandle>,
    run_dir: PathBuf,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    run_counter: AtomicU64,
    shutting_down: Arc<AtomicBool>,
    limits: Mutex<Option<Limits>>,
}

impl SessionManager {
    pub fn new(emit: Emitter, env: Arc<EnvHandle>, run_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            emit,
            env,
            run_dir,
            sessions: Mutex::new(HashMap::new()),
            run_counter: AtomicU64::new(0),
            shutting_down: Arc::new(AtomicBool::new(false)),
            limits: Mutex::new(None),
        })
    }

    fn get(&self, id: &str) -> AppResult<Arc<Session>> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("No session {id}")))
    }

    fn validate_id(id: &str) -> AppResult<()> {
        let ok = !id.is_empty()
            && id.len() <= 64
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        ok.then_some(()).ok_or_else(|| AppError::Invalid(format!("Bad session id {id:?}")))
    }

    /// Idempotent: starting a running session only (re)attaches the outlet.
    pub fn start(
        &self,
        spec: SessionSpec,
        cols: u16,
        rows: u16,
        outlet: Option<Box<dyn Outlet>>,
    ) -> AppResult<SessionInfo> {
        Self::validate_id(&spec.id)?;
        let session = {
            let mut map = self.sessions.locked();
            Arc::clone(map.entry(spec.id.clone()).or_insert_with(|| Arc::new(Session::new(spec.clone()))))
        };
        if let Some(outlet) = outlet {
            session.sink.attach(outlet, false);
        }
        if session.running() {
            return Ok(session.info());
        }
        {
            let mut s = session.spec.locked();
            s.name = spec.name;
            s.cwd = spec.cwd;
            s.kind = spec.kind;
            if spec.claude_session_id.is_some() {
                s.claude_session_id = spec.claude_session_id;
            }
            s.fork = spec.fork;
        }
        self.spawn_run(&session, cols, rows)
    }

    fn spawn_run(&self, s: &Arc<Session>, cols: u16, rows: u16) -> AppResult<SessionInfo> {
        let env = self
            .env
            .get(Duration::from_secs(8))
            .ok_or_else(|| AppError::Unavailable("Still reading your shell environment — try again".into()))?;
        let running = self.sessions.locked().values().filter(|x| x.running()).count();
        if running >= MAX_RUNNING {
            return Err(AppError::Unavailable(format!(
                "{running} sessions are already running — stop some before starting more"
            )));
        }
        let spec = {
            let mut guard = s.spec.locked();
            let spec = guard.clone();
            guard.fork = false; // one-shot: a later restart resumes the fork itself
            spec
        };
        let cwd = launcher::validate_cwd(&spec.cwd, &env.info.home)?;
        let mut vars = env.vars.clone();
        vars.insert("CW_SESSION_ID".into(), spec.id.clone());

        let (program, args, resumed, events, status) = match spec.kind {
            Kind::Claude => {
                let claude = env.info.claude_path.clone().ok_or_else(|| {
                    AppError::NotFound(
                        "Claude CLI not found on your login PATH. Install it, or set \"claudePath\" in ~/.claude-workspace/config.json".into(),
                    )
                })?;
                let uuid = spec
                    .claude_session_id
                    .as_deref()
                    .and_then(|v| Uuid::parse_str(v).ok())
                    .unwrap_or_else(Uuid::new_v4);
                s.spec.locked().claude_session_id = Some(uuid.to_string());
                let resume = launcher::transcript_exists(&env.claude_config_dir(), &uuid);
                let chain = hooks::user_status_line(&cwd, &env.claude_config_dir());
                let files = hooks::prepare(&self.run_dir, &spec.id, chain.as_deref())?;
                let args = launcher::claude_args(&spec.name, &files.settings, &uuid, resume, spec.fork);
                let (program, args) = launcher::runnable(PathBuf::from(claude), args);
                (program, args, resume, Some(files.events), Some(files.status))
            }
            Kind::Shell => (PathBuf::from(&env.info.shell), launcher::shell_args(), false, None, None),
        };

        let run_id = self.run_counter.fetch_add(1, Ordering::SeqCst) + 1;
        s.sink.begin_run(run_id);
        *s.tracker.locked() = Tracker::new(spec.kind == Kind::Shell, Instant::now());
        *s.tail.locked() = events.map(EventTail::new);
        *s.status_feed.locked() = status.map(|p| (p, None));
        *s.exit.locked() = None;
        s.resumed.store(resumed, Ordering::SeqCst);
        s.resume_failed.store(false, Ordering::SeqCst);

        let on_exit = {
            let weak: Weak<Session> = Arc::downgrade(s);
            let emit = Arc::clone(&self.emit);
            let shutting_down = Arc::clone(&self.shutting_down);
            Box::new(move |exit: ExitInfo| {
                let Some(s) = weak.upgrade() else { return };
                if s.process().map(|p| p.run_id) != Some(run_id) {
                    return; // a newer run replaced this one
                }
                if s.resumed.load(Ordering::SeqCst) && !exit.clean() && exit.ran_for < RESUME_FAIL_WINDOW {
                    s.resume_failed.store(true, Ordering::SeqCst);
                }
                s.tracker.locked().on_exit(exit.clean());
                *s.exit.locked() = Some(exit);
                if !shutting_down.load(Ordering::SeqCst) {
                    let info = s.info();
                    *s.last_emitted.locked() = Some((info.run_id, info.status, info.hooks_active));
                    emit(EV_STATUS, serde_json::to_value(info).unwrap_or(Value::Null));
                }
            })
        };
        let launch = Launch { program, args, cwd, env: vars };
        let proc = Process::spawn(
            &launch,
            cols,
            rows,
            SpawnCtx { run_id, sink: Arc::clone(&s.sink), tracker: Arc::clone(&s.tracker), on_exit },
        )?;
        *s.process.locked() = Some(proc);
        *s.pty_size.locked() = (cols.max(2), rows.max(2));
        let info = s.info();
        self.emit_if_changed(s);
        Ok(info)
    }

    /// Re-attach after a webview reload: replays the ring. Returns the info
    /// and how many bytes were replayed (the frontend waits for them to be
    /// written at the PTY's size before fitting the terminal to its pane).
    pub fn attach(&self, id: &str, outlet: Box<dyn Outlet>) -> AppResult<(SessionInfo, usize)> {
        let s = self.get(id)?;
        let info = s.info();
        let replayed = s.sink.attach(outlet, true);
        Ok((info, replayed))
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        let sessions: Vec<_> = self.sessions.locked().values().cloned().collect();
        sessions.iter().map(|s| s.info()).collect()
    }

    pub fn stop(&self, id: &str) -> AppResult<()> {
        if let Some(p) = self.get(id)?.process() {
            p.stop();
        }
        Ok(())
    }

    pub fn kill(&self, id: &str) -> AppResult<()> {
        if let Some(p) = self.get(id)?.process() {
            p.kill();
        }
        Ok(())
    }

    fn stop_and_wait(p: &Process) {
        if p.is_alive() {
            p.hangup();
            if !p.wait_exit(Duration::from_secs(3)) {
                p.force_kill();
                p.wait_exit(Duration::from_secs(1));
            }
        }
    }

    pub fn restart(&self, id: &str, cols: u16, rows: u16) -> AppResult<SessionInfo> {
        let s = self.get(id)?;
        if let Some(p) = s.process() {
            Self::stop_and_wait(&p);
        }
        self.spawn_run(&s, cols, rows)
    }

    /// Replaces the Claude conversation id (after a failed resume) and restarts.
    pub fn new_conversation(&self, id: &str, cols: u16, rows: u16) -> AppResult<SessionInfo> {
        let s = self.get(id)?;
        s.spec.locked().claude_session_id = Some(Uuid::new_v4().to_string());
        self.restart(id, cols, rows)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let removed = self.sessions.locked().remove(id);
        if let Some(p) = removed.and_then(|s| s.process()) {
            p.kill();
        }
        let _ = std::fs::remove_file(self.run_dir.join(format!("{id}.settings.json")));
        let _ = std::fs::remove_file(self.run_dir.join(format!("{id}.events")));
        let _ = std::fs::remove_file(self.run_dir.join(format!("{id}.status.json")));
        Ok(())
    }

    pub fn write(&self, id: &str, bytes: Vec<u8>) -> AppResult<()> {
        let s = self.get(id)?;
        s.tracker.locked().on_input(Instant::now());
        if let Some(p) = s.process() {
            p.write(bytes);
        }
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let s = self.get(id)?;
        s.tracker.locked().on_resize(Instant::now());
        if let Some(p) = s.process() {
            p.resize(cols, rows);
            *s.pty_size.locked() = (cols.max(2), rows.max(2));
        }
        Ok(())
    }

    pub fn ack(&self, id: &str, bytes: usize) -> AppResult<()> {
        self.get(id)?.sink.ack(bytes);
        Ok(())
    }

    fn emit_if_changed(&self, s: &Session) {
        if self.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let info = s.info();
        let key = (info.run_id, info.status, info.hooks_active);
        let mut last = s.last_emitted.locked();
        if *last != Some(key) {
            *last = Some(key);
            drop(last);
            (self.emit)(EV_STATUS, serde_json::to_value(info).unwrap_or(Value::Null));
        }
    }

    /// Tails hook events and re-derives time-based status for every session.
    pub fn start_ticker(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        std::thread::Builder::new()
            .name("cw-status".into())
            .spawn(move || loop {
                std::thread::sleep(TICK);
                let Some(m) = weak.upgrade() else { break };
                if m.shutting_down.load(Ordering::SeqCst) {
                    break;
                }
                // A bug in one tick must not stop status updates for good.
                let tick = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| m.tick(Instant::now())));
                if tick.is_err() {
                    eprintln!("cw-status: tick panicked; continuing");
                }
            })
            .expect("spawn status ticker");
    }

    fn tick(&self, now: Instant) {
        let sessions: Vec<_> = self.sessions.locked().values().cloned().collect();
        for s in sessions {
            let events = s.tail.locked().as_mut().map(|t| t.read_new()).unwrap_or_default();
            // `/clear` and in-session `/resume` switch Claude's conversation id;
            // track it so relaunch resumes the conversation the user sees.
            let new_id = events.iter().rev().find_map(|e| match e {
                HookEvent::Start { session_id: Some(id), .. } => Some(id.clone()),
                _ => None,
            });
            if let Some(new_id) = new_id {
                let changed = {
                    let mut spec = s.spec.locked();
                    let changed = spec.claude_session_id.as_deref() != Some(new_id.as_str());
                    spec.claude_session_id = Some(new_id.clone());
                    changed
                };
                if changed {
                    (self.emit)(EV_CLAUDE_ID, json!({ "id": s.id, "claudeSessionId": new_id }));
                }
            }
            {
                let mut t = s.tracker.locked();
                for ev in &events {
                    t.on_hook(ev, now);
                }
                t.tick(now);
            }
            self.emit_if_changed(&s);
            self.read_status_feed(&s);
        }
    }

    /// Picks up a new status-line JSON (Claude rewrites it ~every 300ms at
    /// most) and emits context usage / plan limits when they change.
    fn read_status_feed(&self, s: &Session) {
        let fresh = {
            let mut feed = s.status_feed.locked();
            let Some((path, seen)) = feed.as_mut() else { return };
            let Ok(mtime) = std::fs::metadata(&*path).and_then(|m| m.modified()) else { return };
            if *seen == Some(mtime) {
                return;
            }
            *seen = Some(mtime);
            std::fs::read(&*path).ok()
        };
        let Some(v) = fresh.and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { return };
        let (usage, limits) = hooks::parse_status(&s.id, &v);
        if s.usage.locked().as_ref() != Some(&usage) {
            *s.usage.locked() = Some(usage.clone());
            (self.emit)(EV_USAGE, serde_json::to_value(&usage).unwrap_or(Value::Null));
        }
        if let Some(l) = limits {
            let mut cur = self.limits.locked();
            if cur.as_ref() != Some(&l) {
                *cur = Some(l.clone());
                drop(cur);
                (self.emit)(EV_LIMITS, serde_json::to_value(&l).unwrap_or(Value::Null));
            }
        }
    }

    /// Current usage for every session + plan limits (after a UI reload).
    pub fn usage_snapshot(&self) -> Value {
        let sessions: Vec<_> = self.sessions.locked().values().filter_map(|s| s.usage.locked().clone()).collect();
        json!({ "sessions": sessions, "limits": *self.limits.locked() })
    }

    /// App quit: SIGHUP every group, give them 500ms, SIGKILL the rest.
    /// Safe to call more than once. Exit events are suppressed so the UI never
    /// records quit-time exits as "the user stopped this session".
    pub fn shutdown(&self) {
        if self.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
        let procs: Vec<_> = self.sessions.locked().values().filter_map(|s| s.process()).collect();
        for p in &procs {
            p.hangup();
        }
        let deadline = Instant::now() + Duration::from_millis(500);
        while procs.iter().any(|p| p.is_alive()) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        for p in procs.iter().filter(|p| p.is_alive()) {
            p.force_kill();
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::env::{EnvInfo, ResolvedEnv};
    use std::collections::BTreeMap;
    use std::sync::Mutex as StdMutex;

    type Events = Arc<StdMutex<Vec<(String, Value)>>>;

    fn manager(dir: &std::path::Path) -> (Arc<SessionManager>, Events) {
        let events: Events = Arc::default();
        let sink = Arc::clone(&events);
        let emit: Emitter = Arc::new(move |name, v| sink.locked().push((name.to_string(), v)));
        let env = EnvHandle::new();
        env.set_for_tests(ResolvedEnv {
            vars: BTreeMap::from([("PATH".into(), "/usr/bin:/bin".into())]),
            info: EnvInfo {
                shell: "/bin/sh".into(),
                home: dir.to_string_lossy().into(),
                claude_path: None,
                claude_version: None,
                source: "test".into(),
            },
        });
        (SessionManager::new(emit, env, dir.join("run")), events)
    }

    fn spec(id: &str, kind: Kind, cwd: &str) -> SessionSpec {
        SessionSpec { id: id.into(), kind, name: "T".into(), cwd: cwd.into(), claude_session_id: None, fork: false }
    }

    #[test]
    fn shell_session_starts_idempotently_and_exits_completed_on_stop() {
        let dir = tempfile::tempdir().unwrap();
        let (m, events) = manager(dir.path());
        let cwd = dir.path().to_str().unwrap();
        let a = m.start(spec("s1", Kind::Shell, cwd), 80, 24, None).unwrap();
        assert!(a.running);
        let b = m.start(spec("s1", Kind::Shell, cwd), 80, 24, None).unwrap();
        assert_eq!(a.run_id, b.run_id, "second start must not respawn");
        m.stop("s1").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while m.list()[0].running && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let info = &m.list()[0];
        assert!(!info.running);
        assert_eq!(info.status, Status::Completed);
        assert!(events.locked().iter().any(|(n, v)| n == EV_STATUS && v["status"] == "completed"));
    }

    #[test]
    fn bad_cwd_and_missing_claude_are_reported_not_spawned() {
        let dir = tempfile::tempdir().unwrap();
        let (m, _) = manager(dir.path());
        let err = m.start(spec("s2", Kind::Shell, "/definitely/not/here"), 80, 24, None).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
        let err = m.start(spec("s3", Kind::Claude, dir.path().to_str().unwrap()), 80, 24, None).unwrap_err();
        assert!(err.to_string().contains("Claude CLI not found"));
        assert!(matches!(
            m.start(spec("../x", Kind::Shell, "/"), 80, 24, None),
            Err(AppError::Invalid(_))
        ));
    }

    #[test]
    fn shutdown_suppresses_exit_events() {
        let dir = tempfile::tempdir().unwrap();
        let (m, events) = manager(dir.path());
        m.start(spec("s4", Kind::Shell, dir.path().to_str().unwrap()), 80, 24, None).unwrap();
        events.locked().clear();
        m.shutdown();
        std::thread::sleep(Duration::from_millis(600));
        assert!(!m.list()[0].running);
        assert!(events.locked().is_empty(), "quit must not look like user stops");
    }
}

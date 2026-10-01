//! One running process in a PTY and the threads that serve it.
//!
//! ```text
//!   PTY master ──read──► reader ──mpsc──► flusher ──(8ms/64KiB batches)──► OutputSink ─► Channel ─► xterm
//!        ▲                  │ parks while frontend is behind (flow control)
//!        └──write── writer ◄─ queue ◄─ terminal_write     waiter: child.wait() → exit callback
//! ```
//!
//! Signals go to the whole process group (`killpg`), never just the leader:
//! portable-pty's own `kill()` hits one pid and blocks the caller.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use portable_pty::MasterPty;

use crate::claude::launcher::Launch;
use crate::error::AppResult;
use crate::session::status::Tracker;
use crate::sync::{wait_timeout_while, Lock};
use crate::terminal::output::OutputSink;
use crate::terminal::pty;

const BATCH_WINDOW: Duration = Duration::from_millis(8);
const BATCH_MAX: usize = 64 * 1024;
const EOF_DRAIN: Duration = Duration::from_millis(300);
/// Session threads do little stack work; small stacks keep 30+ sessions cheap.
const STACK: usize = 256 * 1024;

#[derive(Debug, Clone)]
pub struct ExitInfo {
    pub code: u32,
    pub signal: Option<String>,
    pub stop_requested: bool,
    pub kill_requested: bool,
    pub ran_for: Duration,
}

impl ExitInfo {
    /// A user-requested stop is a clean end even if a signal delivered it.
    pub fn clean(&self) -> bool {
        !self.kill_requested && (self.stop_requested || (self.code == 0 && self.signal.is_none()))
    }
}

pub struct Process {
    pub run_id: u64,
    pub pid: i32,
    /// Cleared by the waiter once the child is reaped, so we never signal a
    /// recycled pid.
    alive: Arc<Mutex<bool>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer_tx: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    stop_requested: Arc<AtomicBool>,
    kill_requested: Arc<AtomicBool>,
    /// Released on stop/kill so the reader drains and the process can exit.
    sink: Arc<OutputSink>,
    pub started_wall_ms: u64,
}

pub struct SpawnCtx {
    pub run_id: u64,
    pub sink: Arc<OutputSink>,
    pub tracker: Arc<Mutex<Tracker>>,
    pub on_exit: Box<dyn FnOnce(ExitInfo) + Send>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Process {
    pub fn spawn(launch: &Launch, cols: u16, rows: u16, ctx: SpawnCtx) -> AppResult<Arc<Process>> {
        let pty::Spawned { master, mut child, mut reader, mut writer, pid } =
            pty::spawn(launch, cols, rows)?;
        let SpawnCtx { run_id, sink, tracker, on_exit } = ctx;
        let process_sink = Arc::clone(&sink);

        let alive = Arc::new(Mutex::new(true));
        let stop_requested = Arc::new(AtomicBool::new(false));
        let kill_requested = Arc::new(AtomicBool::new(false));
        let flushed = Arc::new((Mutex::new(false), Condvar::new()));
        let started_at = Instant::now();

        // reader: PTY → channel of chunks. Parks while the frontend is behind.
        let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<u8>>();
        {
            let sink = Arc::clone(&sink);
            std::thread::Builder::new().name(format!("cw-read-{pid}")).stack_size(STACK).spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    sink.wait_for_credit(run_id);
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break, // EOF shows up as Ok(0) or EIO on macOS
                        Ok(n) => {
                            if chunk_tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                    }
                }
            })?;
        }

        // flusher: coalesce into batches; first chunk after idle goes out at once
        // so keystroke echo is never delayed.
        {
            let sink = Arc::clone(&sink);
            let tracker = Arc::clone(&tracker);
            let flushed = Arc::clone(&flushed);
            std::thread::Builder::new().name(format!("cw-flush-{pid}")).stack_size(STACK).spawn(move || {
                let mut last_flush = Instant::now() - BATCH_WINDOW * 2;
                'outer: while let Ok(first) = chunk_rx.recv() {
                    let mut batch = first;
                    let mut disconnected = false;
                    if last_flush.elapsed() < BATCH_WINDOW * 2 {
                        let deadline = Instant::now() + BATCH_WINDOW;
                        while batch.len() < BATCH_MAX {
                            let left = deadline.saturating_duration_since(Instant::now());
                            match chunk_rx.recv_timeout(left) {
                                Ok(more) => batch.extend_from_slice(&more),
                                Err(RecvTimeoutError::Timeout) => break,
                                Err(RecvTimeoutError::Disconnected) => {
                                    disconnected = true;
                                    break;
                                }
                            }
                        }
                    } else {
                        while let Ok(more) = chunk_rx.try_recv() {
                            batch.extend_from_slice(&more);
                        }
                    }
                    tracker.locked().on_output(Instant::now());
                    sink.deliver(run_id, batch);
                    last_flush = Instant::now();
                    if disconnected {
                        break 'outer;
                    }
                }
                let (lock, cv) = &*flushed;
                *lock.locked() = true;
                cv.notify_all();
            })?;
        }

        // writer: terminal_write only enqueues; a big paste can't block IPC.
        let (writer_tx, writer_rx) = mpsc::channel::<Vec<u8>>();
        std::thread::Builder::new().name(format!("cw-write-{pid}")).stack_size(STACK).spawn(move || {
            while let Ok(bytes) = writer_rx.recv() {
                if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
        })?;

        // waiter: reap, let trailing output drain, clean the group, report.
        {
            let alive = Arc::clone(&alive);
            let stop_requested = Arc::clone(&stop_requested);
            let kill_requested = Arc::clone(&kill_requested);
            std::thread::Builder::new().name(format!("cw-wait-{pid}")).stack_size(STACK).spawn(move || {
                let status = child.wait();
                *alive.locked() = false;
                {
                    let (lock, cv) = &*flushed;
                    let _g = wait_timeout_while(cv, lock.locked(), EOF_DRAIN, |done| !*done);
                }
                // Descendants may still hold the tty; the group id cannot be
                // reused while any member lives, so this is safe after reaping.
                // Never signal pid ≤ 1: killpg(1) would target launchd.
                if pid > 1 {
                    unsafe { libc::killpg(pid, libc::SIGHUP) };
                }
                let (code, signal) = match &status {
                    Ok(s) => (s.exit_code(), s.signal().map(str::to_string)),
                    Err(_) => (1, None),
                };
                on_exit(ExitInfo {
                    code,
                    signal,
                    stop_requested: stop_requested.load(Ordering::SeqCst),
                    kill_requested: kill_requested.load(Ordering::SeqCst),
                    ran_for: started_at.elapsed(),
                });
            })?;
        }

        Ok(Arc::new(Process {
            run_id,
            pid,
            alive,
            master: Mutex::new(master),
            writer_tx: Mutex::new(Some(writer_tx)),
            stop_requested,
            kill_requested,
            sink: process_sink,
            started_wall_ms: now_ms(),
        }))
    }

    pub fn is_alive(&self) -> bool {
        *self.alive.locked()
    }

    pub fn write(&self, bytes: Vec<u8>) {
        if let Some(tx) = self.writer_tx.locked().as_ref() {
            let _ = tx.send(bytes);
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.master.locked().resize(pty::size(cols, rows));
    }

    /// Signals the process group and, for shells, the foreground job's group.
    fn signal(&self, sig: i32) {
        let alive = self.alive.locked();
        if !*alive || self.pid <= 1 {
            return;
        }
        let fg = self.master.locked().process_group_leader();
        unsafe {
            libc::killpg(self.pid, sig);
            if let Some(fg) = fg.filter(|&g| g > 0 && g != self.pid) {
                libc::killpg(fg, sig);
            }
        }
    }

    /// SIGHUP → (2s) SIGTERM → (1s) SIGKILL. Returns immediately.
    pub fn stop(self: &Arc<Self>) {
        self.stop_requested.store(true, Ordering::SeqCst);
        self.sink.release(self.run_id);
        self.signal(libc::SIGHUP);
        let me = Arc::clone(self);
        let _ = std::thread::Builder::new().stack_size(STACK).spawn(move || {
            for (wait, sig) in [(Duration::from_secs(2), libc::SIGTERM), (Duration::from_secs(1), libc::SIGKILL)] {
                let deadline = Instant::now() + wait;
                while me.is_alive() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(25));
                }
                if !me.is_alive() {
                    return;
                }
                me.signal(sig);
            }
        });
    }

    pub fn kill(&self) {
        self.kill_requested.store(true, Ordering::SeqCst);
        self.sink.release(self.run_id);
        self.signal(libc::SIGKILL);
    }

    pub fn hangup(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
        self.sink.release(self.run_id);
        self.signal(libc::SIGHUP);
    }

    pub fn force_kill(&self) {
        self.sink.release(self.run_id);
        self.signal(libc::SIGKILL);
    }

    pub fn wait_exit(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while self.is_alive() {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        true
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        // Closing the queue ends the writer thread.
        self.writer_tx.locked().take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::output::Outlet;
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::Mutex as StdMutex;

    #[derive(Clone, Default)]
    struct Probe(Arc<StdMutex<Vec<u8>>>);
    impl Outlet for Probe {
        fn send(&self, bytes: Vec<u8>) -> bool {
            self.0.locked().extend(bytes);
            true
        }
    }

    fn sh(script: &str) -> Launch {
        let mut env = BTreeMap::new();
        env.insert("PATH".into(), "/usr/bin:/bin".into());
        env.insert("TERM".into(), "xterm-256color".into());
        Launch {
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".into(), script.into()],
            cwd: std::env::temp_dir(),
            env,
        }
    }

    fn run(script: &str) -> (Arc<Process>, Probe, mpsc::Receiver<ExitInfo>) {
        let sink = Arc::new(OutputSink::default());
        let probe = Probe::default();
        sink.begin_run(1);
        sink.attach(Box::new(probe.clone()), false);
        let (tx, rx) = mpsc::channel();
        let p = Process::spawn(
            &sh(script),
            80,
            24,
            SpawnCtx {
                run_id: 1,
                sink,
                tracker: Arc::new(Mutex::new(Tracker::new(true, Instant::now()))),
                on_exit: Box::new(move |e| {
                    let _ = tx.send(e);
                }),
            },
        )
        .unwrap();
        (p, probe, rx)
    }

    #[test]
    fn streams_output_and_reports_clean_exit_after_output() {
        let (_p, probe, rx) = run("printf 'hello ✻'; exit 0");
        let exit = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(exit.clean());
        assert!(String::from_utf8_lossy(&probe.0.locked()).contains("hello ✻"));
    }

    #[test]
    fn nonzero_exit_is_failure_and_cwd_is_honoured() {
        let (_p, probe, rx) = run("pwd; exit 3");
        let exit = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(exit.code, 3);
        assert!(!exit.clean());
        let out = String::from_utf8_lossy(&probe.0.locked()).to_string();
        let tmp = std::env::temp_dir().canonicalize().unwrap();
        assert!(out.contains(tmp.file_name().unwrap().to_str().unwrap()), "{out}");
    }

    #[test]
    fn input_reaches_the_process_and_size_is_applied() {
        let (p, probe, rx) = run("stty size; read line; echo got:$line");
        p.write(b"ping\r".to_vec());
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let out = String::from_utf8_lossy(&probe.0.locked()).to_string();
        assert!(out.contains("24 80"), "{out}");
        assert!(out.contains("got:ping"), "{out}");
    }

    #[test]
    fn stop_takes_down_the_whole_group_and_counts_as_clean() {
        // The trap makes the leader survive SIGHUP, forcing escalation, and the
        // background child checks that the group (not just the leader) dies.
        let (p, _probe, rx) = run("trap '' HUP; sleep 30 & sleep 30");
        std::thread::sleep(Duration::from_millis(200));
        let pgid = p.pid;
        p.stop();
        let exit = rx.recv_timeout(Duration::from_secs(6)).unwrap();
        assert!(exit.clean(), "user stop is a clean end: {exit:?}");
        std::thread::sleep(Duration::from_millis(100));
        let alive = unsafe { libc::killpg(pgid, 0) } == 0;
        assert!(!alive, "process group {pgid} still has members");
    }

    #[test]
    fn kill_is_a_failure() {
        let (p, _probe, rx) = run("sleep 30");
        std::thread::sleep(Duration::from_millis(100));
        p.kill();
        let exit = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(!exit.clean());
        assert!(exit.signal.is_some() || exit.code != 0);
    }
}

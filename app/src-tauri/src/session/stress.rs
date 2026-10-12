//! Load test for the session engine (run explicitly; it takes ~15s):
//!
//!   cargo test --lib stress -- --ignored --nocapture
//!
//! 24 shell sessions flood output at full speed. Half have a healthy frontend
//! (acks arrive), half a frozen one (acks never arrive). One session is
//! restarted repeatedly mid-flood and one receives a 4 MiB paste. The test
//! asserts: no deadlock or panic, frozen sessions stay bounded by flow
//! control, memory/threads/fds stay bounded, and shutdown cleans up
//! every process and thread.

use std::collections::{BTreeMap, HashMap};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::manager::{Emitter, SessionManager};
use super::model::{Kind, SessionSpec};
use crate::env::{EnvHandle, EnvInfo, ResolvedEnv};
use crate::sync::Lock;
use crate::terminal::output::{Outlet, HARD, HIGH};

const N: usize = 24;
const FLOOD: &str = "yes 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'\r";

#[derive(Clone, Default)]
struct Counter {
    sent: Arc<AtomicUsize>,
    pending: Arc<AtomicUsize>,
}

impl Outlet for Counter {
    fn send(&self, bytes: Vec<u8>) -> bool {
        // Called under the sink lock: record only, ack from another thread
        // exactly like the real UI (acks arrive later via terminal_ack).
        self.sent.fetch_add(bytes.len(), Ordering::Relaxed);
        self.pending.fetch_add(bytes.len(), Ordering::Relaxed);
        true
    }
}

fn metric(args: &[&str]) -> usize {
    let out = Command::new(args[0]).args(&args[1..]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0)
}

fn process_stats() -> (usize, usize, usize) {
    let pid = std::process::id().to_string();
    let rss_kb = metric(&["ps", "-o", "rss=", "-p", &pid]);
    let threads = String::from_utf8_lossy(&Command::new("ps").args(["-M", "-p", &pid]).output().unwrap().stdout)
        .lines()
        .count()
        .saturating_sub(1);
    let fds = std::fs::read_dir("/dev/fd").map(|d| d.count()).unwrap_or(0);
    (rss_kb / 1024, threads, fds)
}

fn manager(dir: &std::path::Path) -> Arc<SessionManager> {
    let emits = Arc::new(AtomicUsize::new(0));
    let e2 = Arc::clone(&emits);
    let emit: Emitter = Arc::new(move |_name, _v: Value| {
        e2.fetch_add(1, Ordering::Relaxed);
    });
    let env = EnvHandle::new();
    env.set(ResolvedEnv {
        vars: BTreeMap::from([
            ("PATH".into(), "/usr/bin:/bin".into()),
            ("TERM".into(), "xterm-256color".into()),
            ("LANG".into(), "en_US.UTF-8".into()),
        ]),
        info: EnvInfo {
            shell: "/bin/sh".into(),
            home: dir.to_string_lossy().into(),
            claude_path: None,
            claude_version: None,
            source: "stress".into(),
        },
    });
    SessionManager::new(emit, env, dir.join("run"))
}

#[test]
#[ignore]
fn stress_many_flooding_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().to_string_lossy().into_owned();
    let (base_rss, base_threads, base_fds) = process_stats();
    let m = manager(dir.path());
    m.start_ticker();

    let counters: Arc<Mutex<HashMap<String, (Counter, bool)>>> = Arc::default();
    for i in 0..N {
        let id = format!("s{i}");
        let healthy = i % 2 == 0;
        let c = Counter::default();
        counters.locked().insert(id.clone(), (c.clone(), healthy));
        let spec = SessionSpec { id: id.clone(), kind: Kind::Shell, name: id.clone(), cwd: cwd.clone(), claude_session_id: None, fork: false };
        m.start(spec, 120, 32, Some(Box::new(c))).expect("start");
        m.write(&id, FLOOD.as_bytes().to_vec()).unwrap();
    }

    // The "UI": acks healthy sessions every 16ms (one frame), never the frozen ones.
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let ui = {
        let (m, counters, stop) = (Arc::clone(&m), Arc::clone(&counters), Arc::clone(&stop));
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                for (id, (c, healthy)) in counters.locked().iter() {
                    if *healthy {
                        let n = c.pending.swap(0, Ordering::Relaxed);
                        if n > 0 {
                            let _ = m.ack(id, n);
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(16));
            }
        })
    };

    // Restart storm on s0 and a 4 MiB paste into s2, mid-flood.
    let t0 = Instant::now();
    for _ in 0..8 {
        std::thread::sleep(Duration::from_millis(400));
        m.restart("s0", 120, 32).expect("restart");
        m.write("s0", FLOOD.as_bytes().to_vec()).unwrap();
    }
    let paste = Instant::now();
    m.write("s2", vec![b'x'; 4 * 1024 * 1024]).unwrap();
    let paste_ms = paste.elapsed().as_millis();
    std::thread::sleep(Duration::from_secs(10).saturating_sub(t0.elapsed()));

    let (peak_rss, peak_threads, peak_fds) = process_stats();
    let infos = m.list();
    let running = infos.iter().filter(|i| i.running).count();
    let (mut healthy_mb, mut frozen_max) = (0usize, 0usize);
    for (id, (c, healthy)) in counters.locked().iter() {
        let sent = c.sent.load(Ordering::Relaxed);
        if *healthy {
            healthy_mb += sent / (1024 * 1024);
        } else {
            frozen_max = frozen_max.max(sent);
            // Parks at HIGH, trickles ≤64 KiB per MAX_PARK, never past HARD.
            assert!(sent <= HARD + 128 * 1024, "{id}: frozen UI received {sent} bytes; flow control failed");
        }
    }
    let working = infos.iter().filter(|i| format!("{:?}", i.status) == "Working").count();

    println!("\n── stress: {N} flooding sessions, 10s ──────────────────────────");
    println!("throughput to healthy UIs : {healthy_mb} MiB total (~{} MiB/s)", healthy_mb / 10);
    println!("frozen UI max received    : {} KiB (parks at HIGH = {} KiB, hard cap {} KiB)", frozen_max / 1024, HIGH / 1024, HARD / 1024);
    println!("running / working         : {running} / {working}");
    println!("4 MiB paste enqueue time  : {paste_ms} ms");
    println!("rss   {base_rss} → {peak_rss} MiB");
    println!("threads {base_threads} → {peak_threads}");
    println!("fds   {base_fds} → {peak_fds}");

    assert_eq!(running, N, "every session must still be running");
    assert!(paste_ms < 50, "paste must enqueue, not block ({paste_ms} ms)");
    assert!(peak_rss < base_rss + 400, "memory grew too much: {peak_rss} MiB");
    assert!(healthy_mb > 50, "healthy sessions should stream plenty ({healthy_mb} MiB)");

    // Shutdown: every process gone quickly, threads and fds released.
    stop.store(true, Ordering::Relaxed);
    ui.join().unwrap();
    let t = Instant::now();
    m.shutdown();
    while m.list().iter().any(|i| i.running) && t.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(20));
    }
    let shutdown_ms = t.elapsed().as_millis();
    for i in m.list().iter().filter(|i| i.running) {
        let healthy = counters.locked()[&i.id].1;
        let pid = i.pid.unwrap_or(0).to_string();
        let ps = Command::new("ps").args(["-o", "pid=,ppid=,stat=,wchan=,command=", "-p", &pid]).output().unwrap();
        println!("STILL RUNNING {} healthy={healthy} pid={pid}\n{}", i.id, String::from_utf8_lossy(&ps.stdout));
    }
    for id in (0..N).map(|i| format!("s{i}")) {
        let _ = m.remove(&id);
    }
    drop(m);
    std::thread::sleep(Duration::from_millis(1500));
    let (end_rss, end_threads, end_fds) = process_stats();
    println!("shutdown                  : {shutdown_ms} ms");
    println!("after cleanup: rss {end_rss} MiB, threads {end_threads}, fds {end_fds}");
    assert!(m_list_all_stopped(shutdown_ms), "shutdown took {shutdown_ms} ms");
    assert!(end_threads <= base_threads + 4, "leaked threads: {base_threads} → {end_threads}");
    assert!(end_fds <= base_fds + 4, "leaked fds: {base_fds} → {end_fds}");
}

fn m_list_all_stopped(ms: u128) -> bool {
    ms < 3000
}

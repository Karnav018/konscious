//! PTY output fan-out: in-memory replay ring + the frontend Channel + flow
//! control. One `OutputSink` per session, shared by every run of it.
//!
//! - **Ring** (256 KiB, memory only): replayed on `attach`, so a webview reload
//!   (⌘R, full HMR) re-renders every terminal. Never written to disk.
//! - **Flow control**: bytes sent but not yet acknowledged by xterm's write
//!   callback. Above `HIGH` the PTY reader parks — but never for longer than
//!   `MAX_PARK` at a time. A process cannot finish exiting on macOS until its
//!   tty output is drained, so a reader parked forever behind a stalled UI
//!   would leave the process half-dead (`E` state) and unkillable.
//! - **Overflow**: a UI that stops acknowledging entirely stops receiving live
//!   output past `HARD` (bytes still go to the ring). When it catches up it is
//!   resynced: terminal reset + ring replay.
//! - **Release**: stop/kill/quit switch the run to drain mode so shutdown
//!   never waits on the UI.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::sync::{wait_timeout, Lock};

pub const RING_CAP: usize = 256 * 1024;
pub const HIGH: usize = 4 * 1024 * 1024;
pub const LOW: usize = 1024 * 1024;
pub const HARD: usize = 16 * 1024 * 1024;
pub const MAX_PARK: Duration = Duration::from_secs(1);
/// ESC c (RIS): full terminal reset before a resync replay.
const RESET: &[u8] = b"\x1bc";

pub struct Ring {
    buf: VecDeque<u8>,
    cap: usize,
}

impl Ring {
    pub fn new(cap: usize) -> Self {
        Self { buf: VecDeque::with_capacity(cap.min(64 * 1024)), cap }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        let bytes = if bytes.len() > self.cap { &bytes[bytes.len() - self.cap..] } else { bytes };
        let overflow = (self.buf.len() + bytes.len()).saturating_sub(self.cap);
        self.buf.drain(..overflow);
        self.buf.extend(bytes);
    }

    pub fn snapshot(&self) -> Vec<u8> {
        let (a, b) = self.buf.as_slices();
        [a, b].concat()
    }
}

/// Transport abstraction so the sink is testable without a Tauri runtime.
pub trait Outlet: Send {
    fn send(&self, bytes: Vec<u8>) -> bool;
}

impl Outlet for Channel<InvokeResponseBody> {
    fn send(&self, bytes: Vec<u8>) -> bool {
        Channel::send(self, InvokeResponseBody::Raw(bytes)).is_ok()
    }
}

struct Inner {
    outlet: Option<Box<dyn Outlet>>,
    ring: Ring,
    unacked: usize,
    run_id: u64,
    draining: bool,
    overflowed: bool,
}

impl Inner {
    fn send(&mut self, bytes: Vec<u8>) {
        let n = bytes.len();
        match self.outlet.as_ref().map(|o| o.send(bytes)) {
            Some(true) => self.unacked += n,
            Some(false) => self.outlet = None,
            None => {}
        }
    }
}

pub struct OutputSink {
    inner: Mutex<Inner>,
    credit: Condvar,
}

impl Default for OutputSink {
    fn default() -> Self {
        Self::new(RING_CAP)
    }
}

impl OutputSink {
    pub fn new(ring_cap: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                outlet: None,
                ring: Ring::new(ring_cap),
                unacked: 0,
                run_id: 0,
                draining: false,
                overflowed: false,
            }),
            credit: Condvar::new(),
        }
    }

    /// Starts accepting output from `run_id`; late output from older runs is dropped.
    pub fn begin_run(&self, run_id: u64) {
        let mut g = self.inner.locked();
        g.run_id = run_id;
        g.unacked = 0;
        g.draining = false;
        g.overflowed = false;
        self.credit.notify_all();
    }

    /// Binds a new outlet. With `replay`, the ring goes first (a re-attaching
    /// frontend lost its screen); holding the lock keeps ordering, so nothing
    /// live slips in between. A new run's outlet gets no replay: the pane
    /// already shows the previous run. Returns the bytes replayed.
    pub fn attach(&self, outlet: Box<dyn Outlet>, replay: bool) -> usize {
        let mut g = self.inner.locked();
        let snapshot = if replay { g.ring.snapshot() } else { Vec::new() };
        let n = snapshot.len();
        g.unacked = 0;
        g.overflowed = false;
        g.outlet = Some(outlet);
        if n > 0 {
            g.send(snapshot);
        }
        self.credit.notify_all();
        n
    }

    pub fn deliver(&self, run_id: u64, bytes: Vec<u8>) {
        let mut g = self.inner.locked();
        if run_id != g.run_id {
            return;
        }
        g.ring.push(&bytes);
        if g.unacked > HARD {
            g.overflowed = true; // UI stopped acking: ring only, resync later
            return;
        }
        g.send(bytes);
    }

    pub fn ack(&self, n: usize) {
        let mut g = self.inner.locked();
        g.unacked = g.unacked.saturating_sub(n);
        if g.overflowed && g.unacked < LOW {
            g.overflowed = false;
            let mut resync = RESET.to_vec();
            resync.extend(g.ring.snapshot());
            g.send(resync);
        }
        if g.unacked < LOW {
            self.credit.notify_all();
        }
    }

    /// Stop/kill/quit: the reader must drain freely so the process can exit.
    pub fn release(&self, run_id: u64) {
        let mut g = self.inner.locked();
        if g.run_id == run_id {
            g.draining = true;
            self.credit.notify_all();
        }
    }

    /// Parks the PTY reader while the frontend is behind — at most `MAX_PARK`.
    pub fn wait_for_credit(&self, run_id: u64) {
        let deadline = Instant::now() + MAX_PARK;
        let mut g = self.inner.locked();
        while g.unacked > HIGH && g.outlet.is_some() && g.run_id == run_id && !g.draining {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            g = wait_timeout(&self.credit, g, left);
        }
    }

    #[cfg(test)]
    pub fn unacked(&self) -> usize {
        self.inner.locked().unacked
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    #[derive(Clone, Default)]
    struct Probe(Arc<StdMutex<Vec<Vec<u8>>>>);
    impl Outlet for Probe {
        fn send(&self, bytes: Vec<u8>) -> bool {
            self.0.locked().push(bytes);
            true
        }
    }

    #[test]
    fn ring_keeps_the_newest_bytes() {
        let mut r = Ring::new(8);
        r.push(b"abcdef");
        r.push(b"ghij");
        assert_eq!(r.snapshot(), b"cdefghij");
        r.push(b"0123456789AB");
        assert_eq!(r.snapshot(), b"456789AB");
    }

    #[test]
    fn attach_replays_history_before_live_output() {
        let sink = OutputSink::new(1024);
        sink.begin_run(1);
        sink.deliver(1, b"hello ".to_vec()); // before any frontend attached
        let probe = Probe::default();
        sink.attach(Box::new(probe.clone()), true);
        sink.deliver(1, b"world".to_vec());
        assert_eq!(*probe.0.locked(), vec![b"hello ".to_vec(), b"world".to_vec()]);
        assert_eq!(sink.unacked(), 11);
        sink.ack(11);
        assert_eq!(sink.unacked(), 0);
        // A new run's outlet starts clean: no replay of what the pane already shows.
        let fresh = Probe::default();
        assert_eq!(sink.attach(Box::new(fresh.clone()), false), 0);
        assert!(fresh.0.locked().is_empty());
    }

    #[test]
    fn stale_runs_are_dropped() {
        let sink = OutputSink::new(1024);
        let probe = Probe::default();
        sink.attach(Box::new(probe.clone()), true);
        sink.begin_run(2);
        sink.deliver(1, b"old".to_vec());
        sink.deliver(2, b"new".to_vec());
        assert_eq!(*probe.0.locked(), vec![b"new".to_vec()]);
    }

    #[test]
    fn reader_parks_while_behind_but_never_past_max_park() {
        let sink = Arc::new(OutputSink::new(16));
        sink.begin_run(1);
        sink.attach(Box::new(Probe::default()), true);
        sink.deliver(1, vec![0; HIGH + 1]);
        let s2 = Arc::clone(&sink);
        let t = Instant::now();
        let reader = std::thread::spawn(move || s2.wait_for_credit(1));
        std::thread::sleep(Duration::from_millis(50));
        assert!(!reader.is_finished(), "reader must park above HIGH");
        reader.join().unwrap();
        let parked = t.elapsed();
        assert!(parked >= MAX_PARK - Duration::from_millis(60) && parked < MAX_PARK * 2, "{parked:?}");
    }

    #[test]
    fn release_and_reattach_unpark_immediately() {
        for how in ["release", "attach"] {
            let sink = Arc::new(OutputSink::new(16));
            sink.begin_run(7);
            sink.attach(Box::new(Probe::default()), true);
            sink.deliver(7, vec![0; HIGH + 1]);
            let s2 = Arc::clone(&sink);
            let t = Instant::now();
            let reader = std::thread::spawn(move || s2.wait_for_credit(7));
            std::thread::sleep(Duration::from_millis(30));
            if how == "release" {
                sink.release(7);
            } else {
                sink.attach(Box::new(Probe::default()), true);
            }
            reader.join().unwrap();
            assert!(t.elapsed() < Duration::from_millis(300), "{how} took {:?}", t.elapsed());
        }
    }

    #[test]
    fn stalled_ui_overflows_to_ring_then_resyncs_with_reset_and_replay() {
        let sink = OutputSink::new(8);
        let probe = Probe::default();
        sink.begin_run(1);
        sink.attach(Box::new(probe.clone()), true);
        sink.deliver(1, vec![b'a'; HARD + 1]);
        sink.deliver(1, b"tail1234".to_vec()); // past HARD: ring only
        assert_eq!(probe.0.locked().len(), 1, "no live sends while overflowed");
        sink.ack(HARD + 1);
        let sent = probe.0.locked();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[1], [RESET, b"tail1234".as_slice()].concat());
    }
}

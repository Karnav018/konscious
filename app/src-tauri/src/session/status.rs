//! Session status from observable signals only: hook events, PTY output
//! timing, user input, and process exit. Never from Claude's content.
//!
//! Two modes per run:
//! - **hooks** (Claude sessions once any hook event arrived): hook events are
//!   authoritative. Safety net: `Working` with no output for `SILENCE_IDLE`
//!   drops to `Idle` — Claude's spinner redraws continuously while it works,
//!   and `Stop` does not fire when the user interrupts with Esc / Ctrl-C.
//! - **heuristic** (shell panes, or before hooks are active — e.g. an
//!   untrusted folder holds hooks back until the trust dialog is accepted):
//!   `Working` = a sustained output burst; typing echo and resize redraws are
//!   ignored.

use std::time::{Duration, Instant};

use serde::Serialize;

use crate::claude::hooks::HookEvent;

pub const BURST_GAP: Duration = Duration::from_millis(1500);
pub const BURST_MIN: Duration = Duration::from_millis(300);
pub const ECHO_QUIET: Duration = Duration::from_millis(250);
pub const RESIZE_QUIET: Duration = Duration::from_millis(500);
pub const SILENCE_IDLE: Duration = Duration::from_secs(4);
pub const STARTING_GRACE: Duration = Duration::from_millis(1500);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Starting,
    Working,
    Waiting,
    Idle,
    Completed,
    Failed,
}

impl Status {
    pub fn is_final(self) -> bool {
        matches!(self, Status::Completed | Status::Failed)
    }
}

#[derive(Debug)]
pub struct Tracker {
    pub status: Status,
    pub hooks_active: bool,
    heuristic_only: bool,
    started_at: Instant,
    last_output: Option<Instant>,
    burst_start: Option<Instant>,
    quiet_until: Instant,
}

impl Tracker {
    pub fn new(heuristic_only: bool, now: Instant) -> Self {
        Self {
            status: Status::Starting,
            hooks_active: false,
            heuristic_only,
            started_at: now,
            last_output: None,
            burst_start: None,
            quiet_until: now,
        }
    }

    pub fn on_output(&mut self, now: Instant) {
        if now < self.quiet_until {
            return;
        }
        let continues = self.last_output.is_some_and(|t| now.duration_since(t) <= BURST_GAP);
        if !continues {
            self.burst_start = Some(now);
        }
        self.last_output = Some(now);
    }

    pub fn on_input(&mut self, now: Instant) {
        self.quiet_until = self.quiet_until.max(now + ECHO_QUIET);
        // Answering a prompt (permission, elicitation) means work resumes.
        // If the answer was "no", the silence safety net lands us on Idle.
        if self.hooks_active && self.status == Status::Waiting {
            self.status = Status::Working;
            self.last_output = Some(now);
        }
    }

    pub fn on_resize(&mut self, now: Instant) {
        self.quiet_until = self.quiet_until.max(now + RESIZE_QUIET);
    }

    pub fn on_hook(&mut self, ev: &HookEvent, now: Instant) {
        if self.status.is_final() || self.heuristic_only {
            return;
        }
        self.hooks_active = true;
        self.status = match ev {
            HookEvent::Start { .. } | HookEvent::Stop => Status::Idle,
            HookEvent::Prompt | HookEvent::Tool | HookEvent::ToolDone => {
                self.last_output = Some(now);
                Status::Working
            }
            HookEvent::Permission | HookEvent::Attention => Status::Waiting,
        };
    }

    pub fn on_exit(&mut self, clean: bool) {
        self.status = if clean { Status::Completed } else { Status::Failed };
    }

    /// Re-derives time-based status. Returns the current status.
    pub fn tick(&mut self, now: Instant) -> Status {
        if self.status.is_final() {
            return self.status;
        }
        if self.hooks_active {
            let silent = self.last_output.is_none_or(|t| now.duration_since(t) >= SILENCE_IDLE);
            if self.status == Status::Working && silent {
                self.status = Status::Idle;
            }
            return self.status;
        }
        if self.status == Status::Starting
            && self.last_output.is_none()
            && now.duration_since(self.started_at) < STARTING_GRACE
        {
            return self.status;
        }
        self.status = match (self.burst_start, self.last_output) {
            (Some(start), Some(last))
                if now.duration_since(last) <= BURST_GAP && last.duration_since(start) >= BURST_MIN =>
            {
                Status::Working
            }
            _ if self.status == Status::Starting
                && now.duration_since(self.started_at) < STARTING_GRACE =>
            {
                Status::Starting
            }
            _ => Status::Idle,
        };
        self.status
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    /// Emits output every 100ms from `from` for `dur`.
    fn stream(t: &mut Tracker, from: Instant, dur: u64) {
        let mut at = 0;
        while at <= dur {
            t.on_output(from + ms(at));
            at += 100;
        }
    }

    #[test]
    fn hooks_drive_the_claude_lifecycle() {
        let t0 = Instant::now();
        let mut t = Tracker::new(false, t0);
        assert_eq!(t.tick(t0), Status::Starting);
        t.on_hook(&HookEvent::Start { session_id: None, source: None }, t0 + ms(800));
        assert_eq!(t.tick(t0 + ms(900)), Status::Idle);
        t.on_hook(&HookEvent::Prompt, t0 + ms(1000));
        stream(&mut t, t0 + ms(1000), 2000);
        assert_eq!(t.tick(t0 + ms(3000)), Status::Working);
        t.on_hook(&HookEvent::Permission, t0 + ms(3100));
        // Waiting survives any amount of silence: a person has to act.
        assert_eq!(t.tick(t0 + ms(60_000)), Status::Waiting);
        t.on_input(t0 + ms(61_000));
        assert_eq!(t.tick(t0 + ms(61_100)), Status::Working);
        t.on_hook(&HookEvent::Stop, t0 + ms(62_000));
        assert_eq!(t.tick(t0 + ms(62_100)), Status::Idle);
    }

    #[test]
    fn interrupted_turn_falls_back_to_idle_after_silence() {
        let t0 = Instant::now();
        let mut t = Tracker::new(false, t0);
        t.on_hook(&HookEvent::Prompt, t0);
        stream(&mut t, t0, 1000);
        assert_eq!(t.tick(t0 + ms(1000) + SILENCE_IDLE - ms(100)), Status::Working);
        assert_eq!(t.tick(t0 + ms(1000) + SILENCE_IDLE), Status::Idle);
    }

    #[test]
    fn idle_claude_ignores_typing_echo_in_hooks_mode() {
        let t0 = Instant::now();
        let mut t = Tracker::new(false, t0);
        t.on_hook(&HookEvent::Stop, t0);
        stream(&mut t, t0, 2000);
        assert_eq!(t.tick(t0 + ms(2000)), Status::Idle);
    }

    #[test]
    fn heuristic_needs_a_sustained_burst() {
        let t0 = Instant::now();
        let mut t = Tracker::new(true, t0);
        t.on_output(t0 + ms(100)); // prompt draw
        assert_eq!(t.tick(t0 + ms(200)), Status::Starting, "grace period");
        assert_eq!(t.tick(t0 + ms(1600)), Status::Idle);
        stream(&mut t, t0 + ms(5000), 1000); // npm test output
        assert_eq!(t.tick(t0 + ms(6000)), Status::Working);
        assert_eq!(t.tick(t0 + ms(6000) + BURST_GAP + ms(10)), Status::Idle);
    }

    #[test]
    fn heuristic_ignores_echo_and_resize_redraws() {
        let t0 = Instant::now();
        let mut t = Tracker::new(true, t0 + ms(0));
        t.on_resize(t0 + ms(2000));
        stream(&mut t, t0 + ms(2000), 400);
        assert_eq!(t.tick(t0 + ms(2400)), Status::Idle);
    }

    #[test]
    fn shell_panes_ignore_hooks_and_exit_is_final() {
        let t0 = Instant::now();
        let mut t = Tracker::new(true, t0);
        t.on_hook(&HookEvent::Permission, t0);
        assert!(!t.hooks_active);
        t.on_exit(false);
        t.on_hook(&HookEvent::Prompt, t0 + ms(10));
        assert_eq!(t.tick(t0 + ms(20)), Status::Failed);
    }
}

//! Poison-tolerant locking. A panic in one session's thread must never
//! cascade: std marks a mutex "poisoned" after a panic while held, and a bare
//! `lock().unwrap()` would then panic in every other thread that touches it.
//! The data behind our locks stays valid across a panic (plain state, no
//! half-applied invariants), so recovering the guard is safe.

use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

pub trait Lock<T> {
    fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T> Lock<T> for Mutex<T> {
    fn locked(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn wait_timeout<'a, T>(cv: &Condvar, g: MutexGuard<'a, T>, dur: Duration) -> MutexGuard<'a, T> {
    match cv.wait_timeout(g, dur) {
        Ok((g, _)) => g,
        Err(e) => e.into_inner().0,
    }
}

pub fn wait_timeout_while<'a, T>(
    cv: &Condvar,
    g: MutexGuard<'a, T>,
    dur: Duration,
    cond: impl FnMut(&mut T) -> bool,
) -> MutexGuard<'a, T> {
    match cv.wait_timeout_while(g, dur, cond) {
        Ok((g, _)) => g,
        Err(e) => e.into_inner().0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_panicking_holder_does_not_poison_other_users() {
        let m = Arc::new(Mutex::new(1));
        let m2 = Arc::clone(&m);
        let _ = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("boom");
        })
        .join();
        assert!(m.lock().is_err(), "std would now panic on unwrap");
        *m.locked() += 1;
        assert_eq!(*m.locked(), 2);
    }
}

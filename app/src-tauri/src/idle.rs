//! How long since the user last touched the machine.
//!
//! The sitting tracker measures time at the desk rather than running a timer,
//! so it needs the one thing only the OS knows: seconds since the last key or
//! click, across the whole session rather than just our own window.
//!
//! Both platforms count a sleeping machine as idle, which is what we want —
//! a lid shut at 18:00 reads as fifteen hours idle at 09:00, and the tracker
//! ends the streak rather than crediting the night.

/// Seconds since the last keyboard or mouse event anywhere in the session,
/// or `None` where we have no way to ask.
pub fn idle_secs() -> Option<f64> {
    platform::idle_secs()
}

#[cfg(target_os = "macos")]
mod platform {
    // CoreGraphics is already linked by the webview, so this adds nothing to
    // the build but a symbol. No crate needed for one function.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> f64;
    }

    /// `kCGEventSourceStateCombinedSessionState`: every input in the login
    /// session, not only events our own process has seen.
    const COMBINED_SESSION_STATE: u32 = 1;
    /// `kCGAnyInputEventType`, which is spelled as the largest u32.
    const ANY_INPUT: u32 = u32::MAX;

    pub fn idle_secs() -> Option<f64> {
        // Safe: the call takes two integers, returns a double, and touches
        // nothing of ours.
        let secs = unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT) };
        // A negative or non-finite reading means the question could not be
        // answered; the tracker would rather hear nothing than a wrong number.
        if secs.is_finite() && secs >= 0.0 {
            Some(secs)
        } else {
            None
        }
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    pub fn idle_secs() -> Option<f64> {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // Safe: a struct we own, with its size declared, as the API asks.
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return None;
        }
        let now = unsafe { GetTickCount() };
        // GetTickCount wraps every 49.7 days; wrapping_sub keeps the
        // difference right across the wrap instead of returning 49 days.
        Some(f64::from(now.wrapping_sub(info.dwTime)) / 1000.0)
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    /// X11 has XScreenSaverQueryInfo and Wayland has no portable answer at
    /// all. Konscious does not ship for Linux yet, so rather than guess, the
    /// app is told there is no reading and the tracker stays off.
    pub fn idle_secs() -> Option<f64> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(any(target_os = "macos", windows))]
    fn reads_an_idle_time_on_a_supported_platform() {
        let secs = idle_secs().expect("the platform should answer");
        assert!(secs.is_finite(), "a reading must be a number");
        assert!(secs >= 0.0, "time since the last event cannot be negative");
        // A test run is not a fifty-day-old session; this would catch a
        // GetTickCount wrap handled with a plain subtraction, or a unit mix-up
        // between seconds and milliseconds.
        assert!(secs < 60.0 * 60.0 * 24.0 * 30.0, "implausible idle time: {secs}");
    }

    #[test]
    #[cfg(not(any(target_os = "macos", windows)))]
    fn says_nothing_where_there_is_no_way_to_ask() {
        assert_eq!(idle_secs(), None);
    }
}

//! What Ctrl+V pastes into a terminal pane.
//!
//! WebView2 gives a page only the *names* of files copied in Explorer, never
//! their paths, so a pane reads the clipboard here instead and pastes the way
//! Windows Terminal does: the paths of copied files (CF_HDROP), otherwise the
//! text.

use serde::Serialize;

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clipboard {
    /// Copied files, as absolute paths, in the order they were copied.
    pub paths: Vec<String>,
    pub text: Option<String>,
    /// A picture is on the clipboard.
    pub image: bool,
}

#[cfg(windows)]
pub fn read() -> Clipboard {
    use std::ptr::null_mut;
    use std::time::Duration;

    use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard};
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows_sys::Win32::System::Ole::{CF_DIB, CF_HDROP, CF_UNICODETEXT};
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    let mut out = Clipboard::default();
    // Another program may be holding the clipboard for a moment.
    let opened = (0..5).any(|i| {
        if i > 0 {
            std::thread::sleep(Duration::from_millis(10));
        }
        // SAFETY: plain Win32 call; no owner window is needed to read.
        unsafe { OpenClipboard(null_mut()) != 0 }
    });
    if !opened {
        return out;
    }
    // SAFETY: the clipboard is open for the whole block, and every handle
    // read here belongs to it until CloseClipboard.
    unsafe {
        let drop = GetClipboardData(u32::from(CF_HDROP));
        if !drop.is_null() {
            let count = DragQueryFileW(drop, u32::MAX, null_mut(), 0);
            for i in 0..count {
                let len = DragQueryFileW(drop, i, null_mut(), 0) as usize;
                let mut buf = vec![0u16; len + 1];
                let got = DragQueryFileW(drop, i, buf.as_mut_ptr(), buf.len() as u32) as usize;
                out.paths.push(String::from_utf16_lossy(&buf[..got.min(len)]));
            }
        }
        let text = GetClipboardData(u32::from(CF_UNICODETEXT));
        if !text.is_null() {
            let p = GlobalLock(text) as *const u16;
            if !p.is_null() {
                let mut n = 0;
                while *p.add(n) != 0 {
                    n += 1;
                }
                out.text = Some(String::from_utf16_lossy(std::slice::from_raw_parts(p, n))).filter(|s| !s.is_empty());
                GlobalUnlock(text);
            }
        }
        out.image = IsClipboardFormatAvailable(u32::from(CF_DIB)) != 0;
        CloseClipboard();
    }
    out
}

/// This copy of the app ships for Windows; built elsewhere (its tests run on
/// macOS), there is no Windows clipboard to read.
#[cfg(not(windows))]
pub fn read() -> Clipboard {
    Clipboard::default()
}

//! What ⌘V / Ctrl+V pastes into a terminal pane.
//!
//! A webview hands a page only the *name* of a file copied in Finder or
//! Explorer, never its path, so a pane reads the system clipboard here instead
//! and pastes the way the platform's own terminal does: the paths of copied
//! files, otherwise the text. It also says whether an image is on the
//! clipboard, which Claude Code reads itself.
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
#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::{
        NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF,
    };
    use objc2_foundation::NSURL;

    use super::Clipboard;

    pub fn read() -> Clipboard {
        read_from(&NSPasteboard::generalPasteboard())
    }

    fn read_from(pb: &NSPasteboard) -> Clipboard {
        autoreleasepool(|_| {
            let mut out = Clipboard::default();
            // SAFETY: the pasteboard type constants are immutable AppKit statics.
            let (file_url, string, png, tiff) =
                unsafe { (NSPasteboardTypeFileURL, NSPasteboardTypeString, NSPasteboardTypePNG, NSPasteboardTypeTIFF) };
            // One item per copied file. Finder writes file *reference* URLs
            // (file:///.file/id=…); `filePathURL` turns them into real paths.
            for item in pb.pasteboardItems().unwrap_or_default().iter() {
                let path = item
                    .stringForType(file_url)
                    .and_then(|s| NSURL::URLWithString(&s))
                    .and_then(|u| u.filePathURL())
                    .and_then(|u| u.path());
                if let Some(p) = path {
                    out.paths.push(p.to_string());
                }
            }
            out.text = pb.stringForType(string).map(|s| s.to_string()).filter(|s| !s.is_empty());
            out.image = pb.types().is_some_and(|types| types.iter().any(|t| &*t == png || &*t == tiff));
            out
        })
    }

    #[cfg(all(test, target_os = "macos"))]
    mod mac_tests {
        use objc2::runtime::ProtocolObject;
        use objc2_app_kit::NSPasteboardWriting;
        use objc2_foundation::{NSArray, NSString};

        use super::*;

        /// A private pasteboard (gone when the test process exits), so tests never
        /// touch the user's clipboard.
        fn scratch() -> objc2::rc::Retained<NSPasteboard> {
            let pb = NSPasteboard::pasteboardWithUniqueName();
            pb.clearContents();
            pb
        }

        #[test]
        fn copied_files_paste_as_their_paths() {
            let dir = tempfile::tempdir().unwrap();
            let a = dir.path().join("Screen Shot 1.png");
            let b = dir.path().join("notes (v2).md");
            std::fs::write(&a, b"x").unwrap();
            std::fs::write(&b, b"x").unwrap();
            let pb = scratch();
            let urls: Vec<_> = [&a, &b]
                .iter()
                .map(|p| ProtocolObject::<dyn NSPasteboardWriting>::from_retained(NSURL::fileURLWithPath(&NSString::from_str(p.to_str().unwrap()))))
                .collect();
            assert!(pb.writeObjects(&NSArray::from_retained_slice(&urls)));
            let got = read_from(&pb);
            // macOS may report /private/var for a temp dir under /var.
            let canon = |p: &std::path::Path| std::fs::canonicalize(p).unwrap();
            let paths: Vec<_> = got.paths.iter().map(|p| canon(std::path::Path::new(p))).collect();
            assert_eq!(paths, vec![canon(&a), canon(&b)]);
            assert!(!got.image);
        }

        #[test]
        fn plain_text_pastes_as_text() {
            let pb = scratch();
            // SAFETY: immutable AppKit static.
            let string = unsafe { NSPasteboardTypeString };
            assert!(pb.setString_forType(&NSString::from_str("/Users/k/a b/c.png"), string));
            assert_eq!(read_from(&pb), Clipboard { paths: vec![], text: Some("/Users/k/a b/c.png".into()), image: false });
        }

        #[test]
        fn an_empty_pasteboard_pastes_nothing() {
            let pb = scratch();
            assert_eq!(read_from(&pb), Clipboard::default());
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::read;

/// Linux: GTK's clipboard, which speaks both Wayland and X11. File managers
/// put copied files on it as a `text/uri-list`. GTK lives on the main thread,
/// so `commands::clipboard_read` calls this there.
#[cfg(target_os = "linux")]
mod linux {
    use gtk::{gdk, glib};

    use super::Clipboard;

    pub fn read() -> Clipboard {
        let cb = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
        Clipboard {
            paths: paths(cb.wait_for_uris().iter().map(|u| u.as_str())),
            text: cb.wait_for_text().map(|s| s.to_string()).filter(|s| !s.is_empty()),
            image: cb.wait_is_image_available(),
        }
    }

    /// Local files only, as paths: `file:///a%20b` is `/a b`.
    pub(super) fn paths<'a>(uris: impl Iterator<Item = &'a str>) -> Vec<String> {
        uris.filter_map(|u| glib::filename_from_uri(u).ok())
            .map(|(p, _)| p.to_string_lossy().into_owned())
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use super::paths;

        #[test]
        fn copied_files_paste_as_their_paths() {
            let uris = ["file:///home/k/Screen%20Shot%201.png", "file:///home/k/notes%20(v2).md", "file:///tmp/%E2%9C%93"];
            assert_eq!(paths(uris.into_iter()), ["/home/k/Screen Shot 1.png", "/home/k/notes (v2).md", "/tmp/✓"]);
        }

        #[test]
        fn anything_but_a_local_file_is_left_out() {
            assert!(paths(["https://example.com/a.png", "not a uri", ""].into_iter()).is_empty());
        }
    }
}

#[cfg(target_os = "linux")]
pub use linux::read;

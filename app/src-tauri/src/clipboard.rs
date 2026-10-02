//! What ⌘V pastes into a terminal pane.
//!
//! WebKit only hands a page the *name* of a file copied in Finder, never its
//! path, so a pane reads the system pasteboard here instead and pastes the way
//! Terminal does: the paths of copied files, otherwise the text. It also says
//! whether an image is on the pasteboard, which Claude Code reads itself.

use objc2::rc::autoreleasepool;
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF};
use objc2_foundation::NSURL;
use serde::Serialize;

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clipboard {
    /// Copied files, as absolute paths, in the order they were copied.
    pub paths: Vec<String>,
    pub text: Option<String>,
    /// A picture (e.g. a screenshot copied with ⌃⇧⌘4).
    pub image: bool,
}

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

#[cfg(test)]
mod tests {
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

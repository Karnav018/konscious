//! Thumbnails for files dropped on a pane.
//!
//! The bytes are read here and handed over as a data URL, rather than opening
//! Tauri's asset protocol to the webview: the only files that can be read are
//! ones the user dropped, of a known image type, under a size cap. A pane's
//! attachment strip is not worth widening what the interface can read from
//! disk.
use std::path::Path;

use base64::Engine;

/// Big enough for a screenshot or a photo off a phone, small enough that the
/// data URL stays cheap to pass and to paint.
pub const MAX_BYTES: u64 = 8 * 1024 * 1024;

/// The media type for an image extension we are willing to inline, if any.
/// SVG is deliberately absent: it is a document that can carry script, and it
/// would be painted inside the interface.
pub fn media_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// A `data:` URL for `path`, or `None` when it is not an image we inline, is
/// missing, or is over the cap. Never an error: a thumbnail is a nicety, and
/// the strip falls back to a file chip.
pub fn thumbnail(path: &str) -> Option<String> {
    let path = Path::new(path);
    let media = media_type(path)?;
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES || meta.len() == 0 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{media};base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_image_types_it_will_inline() {
        assert_eq!(media_type(Path::new("/a/shot.png")), Some("image/png"));
        assert_eq!(media_type(Path::new("/a/photo.JPG")), Some("image/jpeg"));
        assert_eq!(media_type(Path::new("/a/anim.gif")), Some("image/gif"));
    }

    #[test]
    fn refuses_everything_else_including_svg() {
        for p in ["/a/notes.pdf", "/a/main.rs", "/a/logo.svg", "/a/noext", "/a/.hidden"] {
            assert_eq!(media_type(Path::new(p)), None, "{p} must not be inlined");
        }
    }

    #[test]
    fn a_missing_file_has_no_thumbnail() {
        assert!(thumbnail("/no/such/file.png").is_none());
    }

    #[test]
    fn reads_a_real_image_as_a_data_url() {
        let dir = std::env::temp_dir().join("konscious-preview-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("one.png");
        std::fs::write(&file, b"\x89PNG\r\n\x1a\nnot really a png").unwrap();
        let url = thumbnail(file.to_str().unwrap()).expect("a small png is inlined");
        assert!(url.starts_with("data:image/png;base64,"));
        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn an_empty_or_oversized_file_is_skipped() {
        let dir = std::env::temp_dir().join("konscious-preview-test");
        std::fs::create_dir_all(&dir).unwrap();
        let empty = dir.join("empty.png");
        std::fs::write(&empty, b"").unwrap();
        assert!(thumbnail(empty.to_str().unwrap()).is_none(), "an empty file is not a thumbnail");
        std::fs::remove_file(&empty).ok();
    }
}

//! The Glass theme's half of the window (macOS).
//!
//! The interface asks for it when the Glass theme is chosen (`window_glass`).
//! macOS then draws its own glass behind the page, and the page leaves its
//! window surfaces clear so the glass shows (styles/globals.css, data-glass).
//!
//! Two effects are named and the system takes the first it has: Liquid Glass
//! from macOS 26, and the under-window blur on 13 to 15, where there is no
//! glass to ask for.
//!
//! Three things have to be true for the desktop to show through, and only the
//! last is the effect itself:
//!
//! - the page draws no background. It already does not: the window is given a
//!   background colour in tauri.conf.json, and that is the switch wry uses to
//!   stop the webview painting its own.
//! - the window is see-through. Glass bends whatever is under it, and in an
//!   ordinary window that is the window's own flat colour, which comes out as
//!   a plain grey panel: measured, the title bar was the same colour at every
//!   point whatever sat behind the window. So the window is made non-opaque
//!   and its background clear, for as long as it is glass and no longer. A
//!   window in any other theme is exactly the opaque one it always was.
//! - the glass view is there, under the webview.

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Color, Effect, EffectsBuilder};
use tauri::{Manager, Theme, WebviewWindow};

/// Glass in `mode` ("dark" or "light"), or the plain window back for `None`.
///
/// The mode matters because the glass is lit for the window's appearance, and
/// left alone that is the system's: a dark theme on a Mac set to light would
/// get pale glass under pale text. So the window takes the theme's appearance
/// while it is glass, and the system's again afterwards.
pub fn set(window: &WebviewWindow, mode: Option<&str>) -> tauri::Result<()> {
    match mode {
        Some(mode) => {
            window.set_theme(Some(if mode == "light" { Theme::Light } else { Theme::Dark }))?;
            see_through(window, true)?;
            window.set_background_color(Some(Color(0, 0, 0, 0)))?;
            window.set_effects(
                EffectsBuilder::new().effect(Effect::LiquidGlassRegular).effect(Effect::UnderWindowBackground).build(),
            )
        }
        None => {
            window.set_effects(None::<WindowEffectsConfig>)?;
            window.set_background_color(configured_background(window))?;
            see_through(window, false)?;
            window.set_theme(None)
        }
    }
}

/// The colour tauri.conf.json gives this window, which is what it goes back to.
fn configured_background(window: &WebviewWindow) -> Option<Color> {
    let config = window.app_handle().config();
    config.app.windows.iter().find(|w| w.label == window.label()).and_then(|w| w.background_color)
}

/// `NSWindow.isOpaque`, which Tauri only sets when a window is created. The
/// shadow is drawn around what the window covers, so it is worked out again.
fn see_through(window: &WebviewWindow, on: bool) -> tauri::Result<()> {
    // A pointer does not cross threads; an address does, and AppKit may only
    // be called on the main one.
    let ns_window = window.ns_window()? as usize;
    window.run_on_main_thread(move || {
        let Some(ns_window) = (unsafe { (ns_window as *const objc2::runtime::AnyObject).as_ref() }) else { return };
        unsafe {
            let _: () = objc2::msg_send![ns_window, setOpaque: !on];
            let _: () = objc2::msg_send![ns_window, invalidateShadow];
        }
    })
}

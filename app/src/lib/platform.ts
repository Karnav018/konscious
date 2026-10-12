// Platform differences the UI cares about. macOS is the reference build;
// Windows (WebView2) differs in shortcuts, clipboard keys and window chrome.
// Linux (WebKitGTK) has the same keyboard as Windows — no ⌘, and Super belongs
// to the window manager — so it takes the Windows keys and chrome too, while
// paths, shells and the PTY stay Unix.

export const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
export const IS_LINUX = typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent)
/** Windows or Linux: Ctrl-based shortcuts, no app menu, no traffic lights. */
export const IS_PC = IS_WINDOWS || IS_LINUX

/** "macOS" / "Windows" / "Linux". */
export const OS_NAME = IS_WINDOWS ? 'Windows' : IS_LINUX ? 'Linux' : 'macOS'
/** Reveal a file in the file manager. Linux says "folder": Files, Dolphin
 *  and Thunar are all in use. */
export const SHOW_IN_FILES = IS_WINDOWS ? 'Show in Explorer' : IS_LINUX ? 'Show in folder' : 'Show in Finder'
/** The machine the app runs on, as a heading. */
export const THIS_MACHINE = IS_WINDOWS ? 'This PC' : IS_LINUX ? 'This computer' : 'This Mac'

/**
 * Shortcut hint for tooltips and menus. On a PC, Ctrl+letter belongs to the
 * terminal (Ctrl+O, Ctrl+J, Ctrl+I = Tab…), so app shortcuts use Ctrl+Shift
 * like Windows Terminal; text size keeps plain Ctrl.
 */
export function kbd(key: string, win = IS_PC): string {
  if (!win) return `⌘${key}`
  if (key === '+' || key === '−' || key === '0') return `Ctrl+${key === '−' ? '-' : key}`
  return `Ctrl+Shift+${key === '↵' ? 'Enter' : key}`
}

/** Hint for a plain Control combination — the same physical key everywhere,
 *  written ⌃U on a Mac and Ctrl+U on a PC. */
export const ctrl = (key: string, win = IS_PC) => (win ? `Ctrl+${key}` : `⌃${key}`)

/** Hint for a shortcut that also needs Shift (⌘⇧← / Ctrl+Shift+← move a pane). */
export function kbdShift(key: string, win = IS_PC): string {
  return win ? `Ctrl+Shift+${key}` : `⌘⇧${key}`
}

/**
 * WebView2 / WebKitGTK browser keys (reload, print, find, dev tools, history)
 * that would act on the app page itself. Only the browser default is cancelled
 * — xterm ignores `defaultPrevented`, so Ctrl+R still reaches the shell as ^R.
 */
export function isBrowserKey(e: KeyboardEvent): boolean {
  const k = e.key
  if (k === 'F3' || k === 'F5' || k === 'F7' || k === 'F12' || k === 'BrowserBack' || k === 'BrowserForward') return true
  if (e.altKey && !e.ctrlKey && (k === 'ArrowLeft' || k === 'ArrowRight')) return true
  if (!e.ctrlKey || e.altKey) return false
  const c = k.toLowerCase()
  return c === 'r' || c === 'p' || c === 'f' || c === 'g'
}

/**
 * A copy or cut key (Ctrl+C, Ctrl+X, Ctrl+Insert) with nothing selected,
 * outside a terminal. WebKitGTK copies such an empty selection anyway, which
 * empties the clipboard — Ctrl+C after clicking a pane header would lose
 * what the user had copied. Terminals do their own copying (keyFilter).
 */
export function copiesNothing(e: KeyboardEvent, selection = globalThis.getSelection?.()?.toString() ?? ''): boolean {
  if (!e.ctrlKey || e.altKey || e.metaKey) return false
  const k = e.key.toLowerCase()
  if (k !== 'insert' && (e.shiftKey || (k !== 'c' && k !== 'x'))) return false
  const t = e.target
  if (t instanceof Element && t.closest('.xterm')) return false
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return t.selectionStart === t.selectionEnd
  return selection === ''
}

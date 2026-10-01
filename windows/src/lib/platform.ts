// Platform differences the UI cares about. macOS is the reference build;
// Windows (WebView2) differs in shortcuts, clipboard keys and window chrome.

export const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/**
 * Shortcut hint for tooltips and menus. On Windows, Ctrl+letter belongs to the
 * terminal (Ctrl+O, Ctrl+J, Ctrl+I = Tab…), so app shortcuts use Ctrl+Shift
 * like Windows Terminal; text size keeps plain Ctrl.
 */
export function kbd(key: string, win = IS_WINDOWS): string {
  if (!win) return `⌘${key}`
  if (key === '+' || key === '−' || key === '0') return `Ctrl+${key === '−' ? '-' : key}`
  return `Ctrl+Shift+${key === '↵' ? 'Enter' : key}`
}

/**
 * WebView2 browser keys (reload, print, find, dev tools, history) that would
 * act on the app page itself. Only the browser default is cancelled — xterm
 * ignores `defaultPrevented`, so Ctrl+R still reaches the shell as ^R.
 */
export function isBrowserKey(e: KeyboardEvent): boolean {
  const k = e.key
  if (k === 'F3' || k === 'F5' || k === 'F7' || k === 'F12' || k === 'BrowserBack' || k === 'BrowserForward') return true
  if (e.altKey && !e.ctrlKey && (k === 'ArrowLeft' || k === 'ArrowRight')) return true
  if (!e.ctrlKey || e.altKey) return false
  const c = k.toLowerCase()
  return c === 'r' || c === 'p' || c === 'f' || c === 'g'
}

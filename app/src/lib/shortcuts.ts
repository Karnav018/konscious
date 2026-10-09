// App keyboard shortcuts (design keybindings). The window-level capture
// listener handles them before xterm sees the key.
//
// macOS: ⌘N ⌘T ⌘O ⌘I ⌘J ⌘↵ ⌘1–9, ⌘= ⌘− ⌘0, ⌘⇧←/→ to move a pane, ⌘⇧N for Notes,
// ⌘L / ⌘⇧L to cycle grid layouts, ⌘⌥1–5 to pick one, ⌘⇧= to even out sizes.
// Windows and Linux: Ctrl+Shift+N/T/O/I/J/Enter/1–9/←/→ (Ctrl+letter is the
// terminal's), Ctrl+= Ctrl+- Ctrl+0 for text size — the Windows Terminal
// conventions.
// Notes has no Windows shortcut (Ctrl+Shift+N is New session there); of the
// layout keys only Ctrl+Shift+L (next layout) — the rest are in the dock menu.
import { IS_PC } from './platform'

export type Shortcut =
  | { type: 'newSession' }
  | { type: 'newTerminal' }
  | { type: 'workspaceMenu' }
  | { type: 'inspector' }
  | { type: 'jumpWaiting' }
  | { type: 'toggleFocus' }
  | { type: 'notes' }
  | { type: 'cycleLayout'; delta: 1 | -1 }
  | { type: 'pickLayout'; index: number }
  | { type: 'evenOut' }
  | { type: 'selectPane'; index: number }
  | { type: 'movePane'; delta: 1 | -1 }
  | { type: 'apps' }
  | { type: 'fontSize'; delta: 1 | -1 | 0 }

export function matchShortcut(e: KeyboardEvent, win = IS_PC): Shortcut | null {
  return win ? matchWindows(e) : matchMac(e)
}

function fontKey(key: string, code: string): Shortcut | null {
  if (key === '=' || key === '+') return { type: 'fontSize', delta: 1 }
  if (key === '-' || key === '_') return { type: 'fontSize', delta: -1 }
  if (key === '0' || code === 'Digit0' || code === 'Numpad0') return { type: 'fontSize', delta: 0 }
  return null
}

const WIN_KEYS: Record<string, Shortcut> = {
  KeyN: { type: 'newSession' },
  KeyT: { type: 'newTerminal' },
  KeyO: { type: 'workspaceMenu' },
  KeyI: { type: 'inspector' },
  KeyJ: { type: 'jumpWaiting' },
  Enter: { type: 'toggleFocus' },
  NumpadEnter: { type: 'toggleFocus' },
  KeyA: { type: 'apps' },
  KeyL: { type: 'cycleLayout', delta: 1 },
  ArrowLeft: { type: 'movePane', delta: -1 },
  ArrowRight: { type: 'movePane', delta: 1 },
}

/** `e.code`, not `e.key`: with Shift held, Digit1 reads "!" and letters are upper-case. */
function matchWindows(e: KeyboardEvent): Shortcut | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null
  if (e.shiftKey) {
    const hit = WIN_KEYS[e.code]
    if (hit) return hit
    const digit = /^Digit([1-9])$/.exec(e.code)
    if (digit) return { type: 'selectPane', index: Number(digit[1]) - 1 }
  }
  return fontKey(e.key, e.code)
}

function matchMac(e: KeyboardEvent): Shortcut | null {
  if (!e.metaKey || e.ctrlKey) return null
  // ⌘⌥1–5 picks a grid layout. `code`: with ⌥ held, the digits type symbols.
  if (e.altKey) {
    const digit = /^Digit([1-5])$/.exec(e.code)
    return digit ? { type: 'pickLayout', index: Number(digit[1]) - 1 } : null
  }
  const k = e.key.toLowerCase()
  if (k === 'l') return { type: 'cycleLayout', delta: e.shiftKey ? -1 : 1 }
  // ⌘⇧= evens out pane sizes; ⌘= (no Shift) stays bigger text.
  if (e.shiftKey && e.code === 'Equal') return { type: 'evenOut' }
  if (k === 'n') return e.shiftKey ? { type: 'notes' } : { type: 'newSession' }
  if (k === 't' && !e.shiftKey) return { type: 'newTerminal' }
  if (k === 'o' && !e.shiftKey) return { type: 'workspaceMenu' }
  if (k === 'i' && !e.shiftKey) return { type: 'inspector' }
  if (k === 'j' && !e.shiftKey) return { type: 'jumpWaiting' }
  if (k === 'a' && e.shiftKey) return { type: 'apps' }
  if (k === 'enter') return { type: 'toggleFocus' }
  // ⌘⇧← / ⌘⇧→ — move the selected pane one slot in the grid.
  if (e.shiftKey && (k === 'arrowleft' || k === 'arrowright')) {
    return { type: 'movePane', delta: k === 'arrowleft' ? -1 : 1 }
  }
  if (/^[1-9]$/.test(k)) return { type: 'selectPane', index: Number(k) - 1 }
  return k === '0' ? { type: 'fontSize', delta: 0 } : fontKey(k, '')
}

export const isAppShortcut = (e: KeyboardEvent) => matchShortcut(e) !== null

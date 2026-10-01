// App keyboard shortcuts (design keybindings). The window-level capture
// listener handles them before xterm sees the key.
export type Shortcut =
  | { type: 'newSession' }
  | { type: 'newTerminal' }
  | { type: 'workspaceMenu' }
  | { type: 'inspector' }
  | { type: 'jumpWaiting' }
  | { type: 'toggleFocus' }
  | { type: 'selectPane'; index: number }
  | { type: 'movePane'; delta: 1 | -1 }
  | { type: 'fontSize'; delta: 1 | -1 | 0 }

export function matchShortcut(e: KeyboardEvent): Shortcut | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'n' && !e.shiftKey) return { type: 'newSession' }
  if (k === 't' && !e.shiftKey) return { type: 'newTerminal' }
  if (k === 'o' && !e.shiftKey) return { type: 'workspaceMenu' }
  if (k === 'i' && !e.shiftKey) return { type: 'inspector' }
  if (k === 'j' && !e.shiftKey) return { type: 'jumpWaiting' }
  if (k === 'enter') return { type: 'toggleFocus' }
  // ⌘⇧← / ⌘⇧→ — move the selected pane one slot in the grid.
  if (e.shiftKey && (k === 'arrowleft' || k === 'arrowright')) {
    return { type: 'movePane', delta: k === 'arrowleft' ? -1 : 1 }
  }
  if (k === '=' || k === '+') return { type: 'fontSize', delta: 1 }
  if (k === '-' || k === '_') return { type: 'fontSize', delta: -1 }
  if (k === '0') return { type: 'fontSize', delta: 0 }
  if (/^[1-9]$/.test(k)) return { type: 'selectPane', index: Number(k) - 1 }
  return null
}

export const isAppShortcut = (e: KeyboardEvent) => matchShortcut(e) !== null

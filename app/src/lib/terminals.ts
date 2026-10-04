// One xterm per session, owned here — not by React. A pane borrows the
// terminal by moving its host element into itself, so hiding a pane,
// switching Grid/Focus, or changing workspace never loses scrollback, and
// hidden terminals keep receiving output (xterm pauses rendering for
// off-screen terminals on its own).
//
//   Rust Channel ──bytes──► term.write(bytes, ack) ──► terminal_ack (flow control)
//   xterm onData ─────────► terminal_write
//   ResizeObserver ─(60ms)─► fit ─► syncPty ─► terminal_resize (until Rust agrees)
//
// Rendering: visible panes use the WebGL renderer (smooth scrolling and fast
// full-screen redraws — the DOM renderer made Claude's TUI lag and, through
// flow control, slowed Claude itself). Parked terminals drop their GL
// context, so at most CAP (6) contexts exist, under WebKit's limit.
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { type ITheme, Terminal } from '@xterm/xterm'

import type { Kind, Theme } from '../types'
import { Channel, ipc } from './ipc'
import { IS_WINDOWS } from './platform'
import { attachFiles } from '../state/commands/ui'
import { pathsForTerminal } from './paste'
import { isAppShortcut } from './shortcuts'
import { NEUTRAL_K, warmColor } from './warmth'

const ACK_BATCH = 32 * 1024
const MIN_COLS = 20
const MIN_ROWS = 5
export const SCROLLBACK = 5000

// Default text size is the base (12px) in every pane; a pane can be pinned
// larger/smaller from its ⋯ menu or ⌘+/⌘−. MAX_BONUS > 0 would let wide panes
// grow toward ~TARGET_COLS columns automatically (off: "Default" means 12).
export const TARGET_COLS = 80
export const MAX_BONUS = 0
/** .xterm horizontal padding (12 + 4) + scrollbar gutter. */
const H_CHROME = 26
let charRatio = 0.6 // JetBrains Mono advance width / font size; measured once fonts load

/** Pure: font size for a pane `width` px wide (0.5px steps, no flicker). */
export function autoFontSize(width: number, base: number, ratio = charRatio): number {
  const ideal = Math.max(0, width - H_CHROME) / (TARGET_COLS * ratio)
  const clamped = Math.min(base + MAX_BONUS, Math.max(base, ideal))
  return Math.round(clamped * 2) / 2
}

function measureCharRatio() {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return
  ctx.font = '100px "JetBrains Mono"'
  const w = ctx.measureText('MMMMMMMMMM').width / 10
  if (w > 30 && w < 90) charRatio = w / 100
}

interface Entry {
  id: string
  kind: Kind
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  channel: Channel<ArrayBuffer> | null
  pendingAck: number
  ackTimer: ReturnType<typeof setTimeout> | undefined
  resizeTimer: ReturnType<typeof setTimeout> | undefined
  observer: ResizeObserver | null
  mountedIn: HTMLElement | null
  webgl: WebglAddon | null
  /** The size Rust's PTY has — the program draws for this width. */
  pty: { cols: number; rows: number } | null
  /** Size of an in-flight terminal_resize, to avoid duplicate sends. */
  ptyPending: string | null
  /** While replaying history, the terminal is pinned to the PTY's size. */
  held: boolean
  /** User-chosen text size for this pane; null = automatic. */
  fontOverride: number | null
  /** The current selection came from ⌘A, so Delete means "clear my input". */
  selectedAll: boolean
  /** Keystrokes typed before the process exists; delivered on start. */
  pendingInput: string[] | null
  /** Bytes written (parsed) from the current channel, and who waits on it. */
  written: number
  waiters: { bytes: number; resolve: () => void }[]
}

let gpuBroken = false

function enableGpu(e: Entry) {
  if (e.webgl || gpuBroken) return
  try {
    const gl = new WebglAddon()
    gl.onContextLoss(() => {
      // Never retry in a loop: fall back to DOM until the pane remounts.
      gl.dispose()
      if (e.webgl === gl) e.webgl = null
    })
    e.term.loadAddon(gl)
    e.webgl = gl
  } catch (err) {
    console.warn('WebGL unavailable, using DOM renderer', err)
    gpuBroken = true
  }
}

function disableGpu(e: Entry) {
  const gl = e.webgl
  e.webgl = null
  try {
    gl?.dispose()
  } catch {
    /* already lost */
  }
}

/** Tells Rust the terminal's size until it confirms. A resize sent before the
 *  session exists in Rust fails; the size is re-sent once `started()` runs. */
function syncPty(e: Entry) {
  const { cols, rows } = e.term
  if (e.pty && e.pty.cols === cols && e.pty.rows === rows) return
  const key = `${cols}x${rows}`
  if (e.ptyPending === key) return
  e.ptyPending = key
  ipc
    .terminalResize(e.id, cols, rows)
    .then(() => {
      e.pty = { cols, rows }
    })
    .catch(() => {
      /* not running yet — started() will sync */
    })
    .finally(() => {
      if (e.ptyPending === key) e.ptyPending = null
      // The terminal may have been resized again meanwhile.
      if (e.term.cols !== cols || e.term.rows !== rows) syncPty(e)
    })
}

// Survives Vite HMR so a hot update never duplicates terminals.
const g = globalThis as unknown as { __cwTerminals?: Map<string, Entry>; __cwParking?: HTMLDivElement }
const entries: Map<string, Entry> = (g.__cwTerminals ??= new Map())

let fontSize = 12

/** Set by bootstrap: start a queued session immediately. */
let startHook: ((id: string) => void) | null = null
export const onStartRequest = (fn: (id: string) => void) => {
  startHook = fn
}
export const requestStart = (id: string) => startHook?.(id)
let theme: Theme = 'dark'
// Colour temperature for the hardcoded colours below; the ones that come from
// CSS variables are already warmed by lib/warmth's pass over them.
let warmth = NEUTRAL_K

function parking(): HTMLDivElement {
  if (!g.__cwParking || !g.__cwParking.isConnected) {
    const el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    Object.assign(el.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '960px',
      height: '600px',
      visibility: 'hidden',
      pointerEvents: 'none',
    })
    document.body.appendChild(el)
    g.__cwParking = el
  }
  return g.__cwParking
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function xtermTheme(): ITheme {
  const dark = theme === 'dark'
  const ansi = dark
    ? {
        black: '#383232', red: '#f07a7a', green: '#8fce9f', yellow: '#e9bc6a',
        blue: '#9fb4e0', magenta: '#c890a7', cyan: '#8fcfcf', white: '#e6dfd0',
        brightBlack: '#8c807b', brightRed: '#f59a9a', brightGreen: '#aedcb9', brightYellow: '#f0cd8c',
        brightBlue: '#bccbea', brightMagenta: '#dcb0c2', brightCyan: '#afdddd', brightWhite: '#fbf5e5',
      }
    : {
        black: '#212121', red: '#c0392b', green: '#3f8f5e', yellow: '#a8741a',
        blue: '#3d6aa8', magenta: '#a35c7a', cyan: '#2e7f86', white: '#5e5654',
        brightBlack: '#9c8f8b', brightRed: '#d9534f', brightGreen: '#4ea570', brightYellow: '#c08a2a',
        brightBlue: '#4f7fc0', brightMagenta: '#b8708f', brightCyan: '#3a959d', brightWhite: '#212121',
      }
  const warm = (c: string) => warmColor(c, warmth)
  return {
    background: css('--pane') || warm(dark ? '#292626' : '#fffcf5'),
    foreground: css('--text'),
    cursor: css('--accent'),
    cursorAccent: css('--pane'),
    // Selection is a #C890A7 tint: clearly "selected", never read as an error.
    selectionBackground: warm(dark ? 'rgba(200,144,167,0.32)' : 'rgba(200,144,167,0.35)'),
    scrollbarSliderBackground: warm(dark ? 'rgba(251,245,229,0.12)' : 'rgba(33,33,33,0.12)'),
    scrollbarSliderHoverBackground: warm(dark ? 'rgba(251,245,229,0.2)' : 'rgba(33,33,33,0.18)'),
    scrollbarSliderActiveBackground: warm(dark ? 'rgba(251,245,229,0.28)' : 'rgba(33,33,33,0.24)'),
    ...(Object.fromEntries(Object.entries(ansi).map(([k, v]) => [k, warm(v)])) as typeof ansi),
  }
}

function flushAck(e: Entry) {
  clearTimeout(e.ackTimer)
  e.ackTimer = undefined
  if (e.pendingAck > 0) {
    const n = e.pendingAck
    e.pendingAck = 0
    void ipc.terminalAck(e.id, n).catch(() => {})
  }
}

function ack(e: Entry, n: number) {
  e.pendingAck += n
  if (e.pendingAck >= ACK_BATCH) flushAck(e)
  else if (!e.ackTimer) e.ackTimer = setTimeout(() => flushAck(e), 100)
}

/** ConPTY repaints on resize by itself; xterm must know which build it is
 *  talking to (reflow is safe from build 21376, i.e. Windows 11). WebView2
 *  reports Windows 11 as platformVersion 13+. */
let winPty: { backend: 'conpty'; buildNumber?: number } = { backend: 'conpty' }
if (IS_WINDOWS) {
  const uaData = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ platformVersion?: string }> }
  }).userAgentData
  void uaData
    ?.getHighEntropyValues(['platformVersion'])
    .then(({ platformVersion }) => {
      const major = Number((platformVersion ?? '').split('.')[0])
      winPty = { backend: 'conpty', buildNumber: major >= 13 ? 22000 : 19045 }
      for (const e of entries.values()) e.term.options.windowsPty = winPty
    })
    .catch(() => {})
}

/** The paste key and a paste event can both fire for one paste (the key,
 *  then the browser's paste); whichever comes second is the same paste. */
const PASTE_DEDUP_MS = 300
let lastPasteAt = -Infinity

/**
 * Paste the way Windows Terminal does. The clipboard is read natively because
 * WebView2 gives the page only the *names* of files copied in Explorer: copied
 * files paste as their (quoted) paths, otherwise the text. On macOS, with only
 * a picture on the clipboard, a Claude pane gets ⌃V — Claude Code reads the
 * image itself (Windows uses a different key, so it is left alone there).
 */
async function pasteClipboard(e: Entry) {
  const now = performance.now()
  if (now - lastPasteAt < PASTE_DEDUP_MS) return
  lastPasteAt = now
  const clip = await ipc.clipboardRead().catch(() => null)
  if (!clip) return
  if (clip.paths.length) {
    e.term.paste(pathsForTerminal(clip.paths))
    attachFiles(e.id, clip.paths)
  }
  else if (clip.text) e.term.paste(clip.text)
  else if (clip.image && e.kind === 'claude' && !IS_WINDOWS) e.term.input('\x16', true)
}

/** Select-all, then Delete. A terminal selection is a copy selection over the
 *  program's own output, so nothing on screen can be deleted — but this one
 *  gesture plainly means "clear what I typed", and `Ctrl+U` does that: Claude
 *  clears its input buffer (Ctrl+Y restores it) and a shell kills the line. */
export function clearsInput(
  ev: Pick<KeyboardEvent, 'type' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>,
  selectedAll: boolean,
): boolean {
  if (!selectedAll || ev.type !== 'keydown') return false
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return false
  return ev.key === 'Backspace' || ev.key === 'Delete'
}

/** Keys xterm must not turn into bytes. App shortcuts are also stopped by
 *  the window capture listener; this is the backstop. */
function keyFilter(e: Entry, ev: KeyboardEvent): boolean {
  if (ev.isComposing) return true
  if (ev.type === 'keydown') {
    if (ev.key === 'Enter' && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      // Claude reads ESC CR (what Option+Enter sends) as "newline in prompt".
      ev.preventDefault()
      void ipc.terminalWrite(e.id, '\x1b\r')
      return false
    }
    if (ev.metaKey && ev.key.toLowerCase() === 'a') {
      ev.preventDefault()
      e.term.selectAll()
      e.selectedAll = true // set after selectAll: the change event resets it
      return false
    }
    if (clearsInput(ev, e.selectedAll)) {
      ev.preventDefault()
      e.term.clearSelection()
      void ipc.terminalWrite(e.id, '\x15')
      return false
    }
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && ev.key.toLowerCase() === 'v') {
      // Handled here (not by the menu's paste event) so copied files paste
      // as paths; see pasteClipboard.
      ev.preventDefault()
      void pasteClipboard(e)
      return false
    }
  }
  if (IS_WINDOWS && ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    const k = ev.key.toLowerCase()
    // Windows Terminal conventions (no Edit menu here): Ctrl+C copies when
    // text is selected and is ^C otherwise; Ctrl+Shift+C always copies.
    if (k === 'c' && (ev.shiftKey || e.term.hasSelection())) {
      if (ev.type === 'keydown') {
        ev.preventDefault()
        const text = e.term.getSelection()
        if (text) void navigator.clipboard.writeText(text).catch(() => {})
        e.term.clearSelection()
      }
      return false
    }
    // Ctrl+Shift+A selects the pane's output, the Windows Terminal binding.
    // Plain Ctrl+A stays ^A (start of line) for the program.
    if (k === 'a' && ev.shiftKey) {
      if (ev.type === 'keydown') {
        ev.preventDefault()
        e.term.selectAll()
        e.selectedAll = true // set after selectAll: the change event resets it
      }
      return false
    }
    // Ctrl+V / Ctrl+Shift+V: pasted here (not by WebView2) so files copied
    // in Explorer paste as paths; see pasteClipboard.
    if (k === 'v') {
      if (ev.type === 'keydown') {
        ev.preventDefault()
        void pasteClipboard(e)
      }
      return false
    }
  }
  // ⌘-combos never reach the PTY (xterm would send a bare \r for ⌘↵).
  // Copy arrives through the native Edit menu as a DOM copy event.
  if (ev.metaKey || isAppShortcut(ev)) return false
  return true
}

export const terminals = {
  has: (id: string) => entries.has(id),

  ensure(id: string, kind: Kind): Entry {
    const existing = entries.get(id)
    if (existing) return existing
    const term = new Terminal({
      cols: 120,
      rows: 32,
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: SCROLLBACK,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      ...(IS_WINDOWS ? { windowsPty: winPty } : {}),
      allowProposedApi: true,
      drawBoldTextInBrightColors: false,
      theme: xtermTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    try {
      // Grapheme-aware widths (emoji + VS16, ZWJ) match how Claude measures
      // its status line; unicode11 miscounts those and shifts columns.
      term.loadAddon(new UnicodeGraphemesAddon())
    } catch {
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
    }
    term.loadAddon(new WebLinksAddon((_ev, uri) => void ipc.openUrl(uri)))

    const host = document.createElement('div')
    host.className = 'cw-term-host'
    parking().appendChild(host)
    term.open(host)

    const entry: Entry = {
      id, kind, term, fit, host,
      channel: null, pendingAck: 0, ackTimer: undefined, resizeTimer: undefined,
      observer: null, mountedIn: null, webgl: null, pty: null, ptyPending: null,
      held: false, written: 0, waiters: [], fontOverride: null, pendingInput: [], selectedAll: false,
    }
    term.onData((data) => {
      if (entry.pendingInput) {
        entry.pendingInput.push(data)
        startHook?.(id) // typing into a queued session starts it now
        return
      }
      void ipc.terminalWrite(id, data).catch(() => {})
    })
    term.onSelectionChange(() => {
      entry.selectedAll = false
    })
    term.attachCustomKeyEventHandler((ev) => keyFilter(entry, ev))
    // Edit › Paste (and right-click Paste) arrive as a DOM paste event. Taken
    // before xterm's own handler so they paste exactly like ⌘V.
    host.addEventListener(
      'paste',
      (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        void pasteClipboard(entry)
      },
      true,
    )
    entries.set(id, entry)
    return entry
  },

  /** A fresh output channel; output on any older channel is ignored. */
  channel(id: string): Channel<ArrayBuffer> {
    const e = entries.get(id)
    if (!e) throw new Error(`no terminal ${id}`)
    flushAck(e)
    e.pendingAck = 0
    const ch = new Channel<ArrayBuffer>()
    e.channel = ch
    e.written = 0
    const done = (n: number) => {
      ack(e, n)
      e.written += n
      e.waiters = e.waiters.filter((w) => (e.written >= w.bytes ? (w.resolve(), false) : true))
    }
    ch.onmessage = (buf) => {
      if (e.channel !== ch) return
      const bytes = new Uint8Array(buf)
      try {
        e.term.write(bytes, () => done(bytes.length))
      } catch (err) {
        // Never stall Rust's flow control on a render error: ack anyway.
        console.error('terminal write failed', err)
        done(bytes.length)
      }
    }
    return ch
  },

  /** Pins the terminal to the PTY's size so replayed history (drawn by the
   *  program for that width) renders correctly; `release` then fits to the
   *  pane like a normal resize, and the program redraws for the new width. */
  hold(id: string, cols: number, rows: number) {
    const e = entries.get(id)
    if (!e) return
    e.held = true
    if (cols >= 2 && rows >= 2 && (cols !== e.term.cols || rows !== e.term.rows)) e.term.resize(cols, rows)
    e.pty = { cols, rows }
  },

  release(id: string) {
    const e = entries.get(id)
    if (!e) return
    e.held = false
    terminals.fit(id)
  },

  /** Resolves once `bytes` from the current channel are parsed (or on timeout). */
  whenWritten(id: string, bytes: number, timeoutMs = 3000): Promise<void> {
    const e = entries.get(id)
    if (!e || bytes <= 0 || e.written >= bytes) return Promise.resolve()
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs)
      e.waiters.push({ bytes, resolve: () => (clearTimeout(t), resolve()) })
    })
  },

  size(id: string): { cols: number; rows: number } {
    const e = entries.get(id)
    return e ? { cols: e.term.cols, rows: e.term.rows } : { cols: 120, rows: 32 }
  },

  /** Moves the terminal into `container` and keeps it fitted there. */
  mount(id: string, container: HTMLElement) {
    const e = entries.get(id)
    if (!e) return
    if (e.mountedIn !== container) {
      container.appendChild(e.host)
      e.mountedIn = container
    }
    enableGpu(e)
    e.observer?.disconnect()
    e.observer = new ResizeObserver(() => terminals.scheduleFit(id))
    e.observer.observe(container)
    requestAnimationFrame(() => terminals.fit(id))
  },

  unmount(id: string, container: HTMLElement) {
    const e = entries.get(id)
    if (!e || e.mountedIn !== container) return
    e.observer?.disconnect()
    e.observer = null
    e.mountedIn = null
    disableGpu(e)
    parking().appendChild(e.host)
  },

  scheduleFit(id: string) {
    const e = entries.get(id)
    if (!e) return
    clearTimeout(e.resizeTimer)
    e.resizeTimer = setTimeout(() => terminals.fit(id), 60)
  },

  /** Sizes the font to the pane, fits, then makes sure the PTY agrees. */
  fit(id: string) {
    const e = entries.get(id)
    if (!e || !e.mountedIn || e.held) return
    const width = e.mountedIn.clientWidth
    if (width > 0 || e.fontOverride) {
      const size = e.fontOverride ?? autoFontSize(width, fontSize)
      if (size !== e.term.options.fontSize) e.term.options.fontSize = size
    }
    const dims = e.fit.proposeDimensions()
    if (dims && Number.isFinite(dims.cols) && Number.isFinite(dims.rows) && dims.cols >= MIN_COLS && dims.rows >= MIN_ROWS) {
      if (dims.cols !== e.term.cols || dims.rows !== e.term.rows) e.term.resize(dims.cols, dims.rows)
    }
    syncPty(e)
  },

  /** Rust spawned (or re-attached) the PTY at `size`; reconcile with the pane,
   *  then deliver anything typed while it was starting. */
  started(id: string, size: { cols: number; rows: number } | null) {
    const e = entries.get(id)
    if (!e) return
    e.pty = size
    e.ptyPending = null
    const early = e.pendingInput
    e.pendingInput = null
    if (early?.length) void ipc.terminalWrite(id, early.join('')).catch(() => {})
    if (e.mountedIn) terminals.fit(id)
    else syncPty(e)
  },

  /** After a replay, make full-screen TUIs (Claude) redraw cleanly. */
  nudge(id: string) {
    const e = entries.get(id)
    if (!e) return
    const { cols, rows } = e.term
    e.pty = null
    void ipc.terminalResize(id, Math.max(MIN_COLS, cols - 1), rows).then(() =>
      setTimeout(() => syncPty(e), 50),
    )
  },

  /** Pins this pane's text size (null = automatic) and re-fits. */
  setFontOverride(id: string, size: number | null) {
    const e = entries.get(id)
    if (!e || e.fontOverride === size) return
    e.fontOverride = size
    if (size) e.term.options.fontSize = size
    terminals.fit(id)
  },

  /** The size the pane is rendering at right now (auto or pinned). */
  currentFontSize(id: string): number {
    return entries.get(id)?.term.options.fontSize ?? fontSize
  },

  /** Ctrl+U: clears Claude's input buffer (Ctrl+Y restores it) and kills the
   *  line in a shell. The only reliable way to take back what was typed. */
  clearInput(id: string) {
    void ipc.terminalWrite(id, '\x15').catch(() => {})
  },

  focus(id: string) {
    entries.get(id)?.term.focus()
  },

  /** Types `text` as a paste (bracketed when the program asked for it). */
  paste(id: string, text: string) {
    if (text) entries.get(id)?.term.paste(text)
  },

  /** Whether the program asked for bracketed paste — then a multi-line paste
   *  lands in its prompt instead of running line by line. Claude always does. */
  bracketedPaste(id: string) {
    return entries.get(id)?.term.modes.bracketedPasteMode ?? false
  },

  isFocused(id: string) {
    const e = entries.get(id)
    return !!e && !!document.activeElement && e.host.contains(document.activeElement)
  },

  selectAll(id: string) {
    entries.get(id)?.term.selectAll()
  },

  clear(id: string) {
    entries.get(id)?.term.reset()
  },

  dispose(id: string) {
    const e = entries.get(id)
    if (!e) return
    flushAck(e)
    e.observer?.disconnect()
    e.channel = null
    disableGpu(e)
    e.term.dispose()
    e.host.remove()
    entries.delete(id)
  },

  /** Theme, colour temperature and base font size (the auto size is derived
   *  per pane in fit()). */
  setAppearance(next: { theme?: Theme; fontSize?: number; warmth?: number }) {
    if (next.theme) theme = next.theme
    if (next.fontSize) fontSize = next.fontSize
    if (next.warmth !== undefined) warmth = next.warmth
    measureCharRatio()
    const t = xtermTheme()
    for (const e of entries.values()) {
      e.term.options.theme = t
      terminals.scheduleFit(e.id)
    }
  },
}

// User intents → state commands + terminal registry + IPC. Components call
// these; they never talk to ipc, terminals or `act` directly.
import { CAP } from '../lib/grid'
import { errorMessage, ipc, type SessionSpec } from '../lib/ipc'
import { terminals } from '../lib/terminals'
import { DEFAULT_K, effectiveK, isWarm, kelvinAt, paintWarmth } from '../lib/warmth'
import {
  hidePane as hideLayoutPane,
  layoutOf,
  movePaneOnto as moveLayoutPaneOnto,
  nudgePane as nudgeLayoutPane,
  openPane,
  selectPane,
  setMode as setLayoutMode,
  toggleFocus as toggleLayoutFocus,
} from '../state/commands/layout'
import { applyInfo, markSpawnFailed, markStarting, setGit, setUnread } from '../state/commands/runtime'
import {
  askDeleteSession,
  closeNewSession,
  closeWorkspaceMenu,
  flash,
  openNewSessionDraft,
  setPaneMenu,
  setThemeValue,
  setWarmValue,
} from '../state/commands/ui'
import {
  addSession,
  addWorkspace as addWorkspaceCmd,
  basename,
  newSessionId,
  removeSession as removeSessionCmd,
  setActiveWorkspace,
  updateSession,
} from '../state/commands/workspace'
import { canStart } from '../state/machine'
import { FONT_MAX, FONT_MIN } from '../state/persistence'
import { getState, type NewSessionDraft } from '../state/store'
import type { Kind, LayoutMode, SessionInfo, SessionMeta, Theme } from '../types'

export { flash }

const specOf = (m: SessionMeta, fork = false): SessionSpec => ({
  id: m.id,
  kind: m.kind,
  name: m.name,
  cwd: m.cwd,
  claudeSessionId: m.claudeSessionId,
  fork,
})

export function expandHome(path: string): string {
  const home = getState().ui.init?.home
  const p = path.trim()
  if (home && (p === '~' || p.startsWith('~/'))) return home + p.slice(1)
  return p.replace(/\/+$/, '') || p
}

/* ── status plumbing ─────────────────────────────────────────────── */

const gitAt: Record<string, number> = {}

export async function refreshGit(id: string, force = false) {
  const meta = getState().workspace.sessions[id]
  if (!meta) return
  const now = Date.now()
  if (!force && now - (gitAt[id] ?? 0) < 3000) return
  gitAt[id] = now
  try {
    setGit(id, await ipc.gitInfo(meta.cwd))
  } catch {
    /* not a repo / git missing: header just omits the branch */
  }
}

function isInView(id: string): boolean {
  const s = getState()
  const meta = s.workspace.sessions[id]
  if (!meta || s.workspace.activeId !== meta.workspaceId || !document.hasFocus()) return false
  return layoutOf(s.layout.byWorkspace, meta.workspaceId).selected === id
}

/** Two panes on one Claude conversation both append to one history. */
export function setClaudeSessionId(id: string, claudeSessionId: string) {
  const s = getState()
  const meta = s.workspace.sessions[id]
  if (!meta || meta.claudeSessionId === claudeSessionId) return
  updateSession(id, { claudeSessionId })
  const twin = Object.values(s.workspace.sessions).find(
    (m) => m.id !== id && m.claudeSessionId === claudeSessionId && s.runtime.bySession[m.id]?.running,
  )
  if (twin) flash(`“${meta.name}” is now the same conversation as “${twin.name}” — both panes write to one history`)
}

/** Single entry point for every Rust snapshot (events and command results). */
export function onInfo(info: SessionInfo) {
  const accepted = applyInfo(info)
  if (!accepted) return // unknown session, or rejected by the lifecycle machine
  const { prev } = accepted
  const meta = getState().workspace.sessions[info.id]!
  if (prev?.status === 'working' && info.status === 'idle' && !isInView(info.id)) setUnread(info.id, true)
  if (prev?.running && !info.running) {
    // Rust suppresses quit-time exits, so this is a real stop/exit.
    updateSession(info.id, { wasRunning: false, lastActiveAt: Date.now() })
  } else if (info.status === 'working' && prev?.status !== 'working') {
    updateSession(info.id, { lastActiveAt: Date.now() })
  }
  if (info.claudeSessionId && info.claudeSessionId !== meta.claudeSessionId) {
    setClaudeSessionId(info.id, info.claudeSessionId)
  }
  if (prev && prev.status !== info.status && (info.status === 'idle' || !info.running)) void refreshGit(info.id)
}

/* ── lifecycle ───────────────────────────────────────────────────── */

const starting = new Set<string>()

export async function startSession(id: string, opts: { fork?: boolean } = {}) {
  const meta = getState().workspace.sessions[id]
  if (!meta || starting.has(id)) return
  starting.add(id)
  try {
    await spawnSession(meta, opts)
  } finally {
    starting.delete(id)
  }
}

async function spawnSession(meta: SessionMeta, opts: { fork?: boolean }) {
  const id = meta.id
  terminals.ensure(id, meta.kind)
  // Measure first when visible, so Claude starts at the pane's real width.
  terminals.fit(id)
  const { cols, rows } = terminals.size(id)
  const channel = terminals.channel(id)
  markStarting(id)
  try {
    const info = await ipc.sessionStart(specOf(meta, opts.fork), cols, rows, channel)
    // An idempotent start may return an already-running PTY of unknown size;
    // resending the current size is harmless (no SIGWINCH when unchanged).
    terminals.started(id, null)
    onInfo(info)
    const now = getState().workspace.sessions[id]
    updateSession(id, {
      wasRunning: info.running,
      claudeSessionId: info.claudeSessionId ?? now?.claudeSessionId ?? null,
      lastActiveAt: Date.now(),
    })
    void refreshGit(id, true)
  } catch (e) {
    markSpawnFailed(id)
    updateSession(id, { wasRunning: false })
    flash(errorMessage(e))
  }
}

/** Re-binds to a session Rust is still running (after a webview reload). */
export async function reattachSession(info: SessionInfo) {
  const meta = getState().workspace.sessions[info.id]
  if (!meta) return
  // After HMR the old xterm survives with its content; the replay would
  // duplicate it, so start from a clean screen.
  if (terminals.has(info.id)) terminals.clear(info.id)
  terminals.ensure(info.id, meta.kind)
  // Replay history at the width it was drawn for, then fit to the pane.
  terminals.hold(info.id, info.cols, info.rows)
  try {
    const attached = await ipc.sessionAttach(info.id, terminals.channel(info.id))
    onInfo(attached)
    await terminals.whenWritten(info.id, attached.replayBytes)
  } catch (e) {
    flash(errorMessage(e))
  } finally {
    terminals.release(info.id)
    if (meta.kind === 'claude' && info.running) terminals.nudge(info.id)
  }
}

export const stopSession = (id: string) => void ipc.sessionStop(id).catch((e) => flash(errorMessage(e)))
export const killSession = (id: string) => void ipc.sessionKill(id).catch((e) => flash(errorMessage(e)))

export async function restartSession(id: string) {
  if (canStart(getState().runtime.bySession[id])) return startSession(id)
  terminals.fit(id)
  const { cols, rows } = terminals.size(id)
  try {
    onInfo(await ipc.sessionRestart(id, cols, rows))
    terminals.started(id, { cols, rows })
    updateSession(id, { wasRunning: true })
  } catch (e) {
    flash(errorMessage(e))
  }
}

/** After a failed `--resume`: same pane, fresh Claude conversation. */
export async function startNewConversation(id: string) {
  updateSession(id, { claudeSessionId: crypto.randomUUID() })
  terminals.clear(id)
  await startSession(id)
}

export function removeSession(id: string) {
  if (!getState().workspace.sessions[id]) return
  void ipc.sessionRemove(id).catch(() => {})
  terminals.dispose(id)
  removeSessionCmd(id)
}

/** Claude sessions need the typed "delete" confirmation (they hold a
 *  conversation's context); a terminal is just a shell and goes at once. */
export function requestDeleteSession(id: string) {
  const meta = getState().workspace.sessions[id]
  if (!meta) return
  if (meta.kind === 'shell') {
    removeSession(id)
    flash(`Deleted terminal “${meta.name}”`)
  } else {
    askDeleteSession(id)
  }
}

export function renameSession(id: string, name: string) {
  const clean = name.trim()
  if (clean) updateSession(id, { name: clean.slice(0, 200) })
}

/* ── grid & selection ────────────────────────────────────────────── */

export function selectSession(id: string, opts: { focus?: boolean } = {}) {
  if (!getState().workspace.sessions[id]) return
  const evicted = openPane(id)
  if (getState().runtime.bySession[id]?.unread) setUnread(id, false)
  if (evicted) {
    const name = getState().workspace.sessions[evicted]?.name ?? 'a session'
    flash(`Grid holds ${CAP} — hid ${name} (still running)`)
  }
  if (opts.focus) requestAnimationFrame(() => terminals.focus(id))
}

/** Click inside an already-visible pane. */
export function focusPane(id: string) {
  selectPane(id)
  if (getState().runtime.bySession[id]?.unread) setUnread(id, false)
}

export const hidePane = (id: string) => hideLayoutPane(id)

/* ── reordering panes ────────────────────────────────────────────── */

/** Reordering moves the pane's DOM node, which blurs whatever was focused
 *  inside it; the terminal gets its keyboard focus back. */
function keepingFocus(id: string, reorder: () => void) {
  const refocus = terminals.isFocused(id)
  reorder()
  if (refocus) requestAnimationFrame(() => terminals.focus(id))
}

/** Dropped on another pane: take its slot, the panes in between shift along. */
export function movePaneOnto(id: string, targetId: string) {
  if (id === targetId) return
  keepingFocus(id, () => moveLayoutPaneOnto(id, targetId))
}

/** "Move left" / "Move right". Nothing to reorder while one pane fills the
 *  stage, and the ends don't wrap. */
export function movePane(id: string | null | undefined, delta: number) {
  const s = getState()
  const meta = id ? s.workspace.sessions[id] : undefined
  if (!meta) return
  if (layoutOf(s.layout.byWorkspace, meta.workspaceId).mode === 'focus') return
  keepingFocus(meta.id, () => nudgeLayoutPane(meta.id, delta))
}

export function toggleFocus(id?: string) {
  const s = getState()
  const wsId = s.workspace.activeId
  if (!wsId) return
  const target = id ?? layoutOf(s.layout.byWorkspace, wsId).selected
  if (!target) return
  toggleLayoutFocus(wsId, target)
  requestAnimationFrame(() => terminals.focus(target))
}

export function setMode(mode: LayoutMode) {
  const s = getState()
  const wsId = s.workspace.activeId
  if (!wsId || layoutOf(s.layout.byWorkspace, wsId).mode === mode) return
  if (mode === 'focus') toggleFocus()
  else setLayoutMode(wsId, 'grid')
}

export function selectPaneIndex(index: number) {
  const s = getState()
  const id = layoutOf(s.layout.byWorkspace, s.workspace.activeId).open[index]
  if (id) selectSession(id, { focus: true })
}

export function jumpWaiting() {
  const s = getState()
  const waiting = Object.values(s.workspace.sessions)
    .filter((m) => s.runtime.bySession[m.id]?.status === 'waiting')
    .sort((a, b) => a.createdAt - b.createdAt)
  if (!waiting.length) return flash('No sessions are waiting')
  const current = layoutOf(s.layout.byWorkspace, s.workspace.activeId).selected
  const i = waiting.findIndex((m) => m.id === current)
  selectSession(waiting[(i + 1) % waiting.length].id, { focus: true })
}

export const openPaneMenu = (id: string | null) => setPaneMenu(id)

/* ── workspaces & creation ───────────────────────────────────────── */

export function switchWorkspace(id: string) {
  setActiveWorkspace(id)
  closeWorkspaceMenu()
  const l = layoutOf(getState().layout.byWorkspace, id)
  const target = l.selected ?? l.open[0]
  if (target) requestAnimationFrame(() => terminals.focus(target))
}

export function addWorkspace(path: string) {
  const w = addWorkspaceCmd(path)
  closeWorkspaceMenu()
  return w
}

export async function pickWorkspaceFolder() {
  const path = await ipc.pickFolder(getState().ui.init?.home)
  return path ? addWorkspace(path) : null
}

export async function openNewSession(prefill: Partial<NewSessionDraft> = {}) {
  let s = getState()
  let wsId = prefill.workspaceId ?? s.workspace.activeId
  if (!wsId || !s.workspace.workspaces.some((w) => w.id === wsId)) {
    const created = s.workspace.workspaces[0] ?? (await pickWorkspaceFolder())
    if (!created) return
    wsId = created.id
    s = getState()
  }
  const w = s.workspace.workspaces.find((x) => x.id === wsId)!
  openNewSessionDraft({ kind: 'claude', workspaceId: w.id, name: '', dir: w.path, ...prefill })
}

export async function createSession(draft: NewSessionDraft) {
  const cwd = expandHome(draft.dir)
  if (!(await ipc.fsIsDir(cwd).catch(() => false))) {
    flash(`Directory does not exist: ${draft.dir}`)
    return false
  }
  const kind: Kind = draft.kind
  const now = Date.now()
  const meta: SessionMeta = {
    id: newSessionId(),
    workspaceId: draft.workspaceId,
    name: draft.name.trim().slice(0, 200) || (kind === 'shell' ? 'Terminal' : basename(cwd) || 'Untitled'),
    kind,
    cwd,
    claudeSessionId: kind === 'claude' ? crypto.randomUUID() : null,
    wasRunning: true,
    fontSize: null,
    createdAt: now,
    lastActiveAt: now,
  }
  addSession(meta)
  const l = layoutOf(getState().layout.byWorkspace, meta.workspaceId)
  if (l.mode === 'focus') setLayoutMode(meta.workspaceId, 'grid')
  closeNewSession()
  terminals.ensure(meta.id, kind)
  selectSession(meta.id, { focus: true })
  await startSession(meta.id)
  return true
}

/* ── per-pane text size ──────────────────────────────────────────── */

/** Pins a pane's text size (null = automatic) and remembers it. */
export function setPaneFontSize(id: string, size: number | null) {
  const clamped = size === null ? null : Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size)))
  updateSession(id, { fontSize: clamped })
  terminals.setFontOverride(id, clamped)
}

/** ⌘+ / ⌘− and the menu stepper: starts from what the pane shows now. */
export function stepPaneFontSize(id: string | null | undefined, delta: number) {
  if (!id || !getState().workspace.sessions[id]) return
  setPaneFontSize(id, Math.round(terminals.currentFontSize(id)) + delta)
}

/** ⌘0 / "Default": back to automatic sizing. */
export function resetPaneFontSize(id: string | null | undefined) {
  if (id && getState().workspace.sessions[id]) setPaneFontSize(id, null)
}

/** ⌘T / pane "+": a shell in the pane's folder, immediately — no dialog.
 *  With no pane selected, opens at the active workspace root. */
export async function openTerminalHere(fromSessionId?: string | null) {
  const s = getState()
  const from = fromSessionId ? s.workspace.sessions[fromSessionId] : undefined
  const ws = s.workspace.workspaces.find((w) => w.id === (from?.workspaceId ?? s.workspace.activeId))
  if (!ws) return void openNewSession({ kind: 'shell' })
  await createSession({ kind: 'shell', workspaceId: ws.id, name: '', dir: from?.cwd ?? ws.path })
}

/* ── appearance & misc ───────────────────────────────────────────── */

/** Repaints the window for the theme and colour temperature now in state. */
function repaint() {
  const { theme, warm, warmth } = getState().ui
  const kelvin = effectiveK(warm, warmth)
  paintWarmth(theme, kelvin)
  terminals.setAppearance({ theme, warmth: kelvin })
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  setThemeValue(theme)
  repaint()
}

/** The title-bar lamp: warm colours on or off, at the temperature chosen. A
 *  slider left at neutral would make "on" invisible, so it starts at default. */
export function toggleWarm() {
  const { warm, warmth } = getState().ui
  const on = !warm
  setWarmValue(on, on && !isWarm(warmth) ? DEFAULT_K : warmth)
  repaint()
}

/** The slider: 0 is neutral, 100 is amber. Moving it switches warmth on. */
export function setWarmthPercent(percent: number) {
  setWarmValue(true, kelvinAt(percent))
  repaint()
}

export async function copyText(text: string, msg = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    flash(msg)
  } catch {
    flash('Could not access the clipboard')
  }
}

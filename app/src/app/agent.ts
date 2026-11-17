// Tools Claude sessions call to drive Konscious. Rust (src-tauri/src/agent.rs)
// speaks MCP and hands each call here as an `agent-call` event naming the
// session that made it; the answer goes back as plain text Claude reads.
//
// Sessions, workspaces and the layout live here; the dock apps, notes and
// settings in app/agentApps.ts. Anything that opens or stops sessions, or
// changes how the app looks, waits for the person (AgentAskDialog). Each
// session may open a few at most in a short while, and only one request shows
// at a time, so one runaway prompt can't fill the grid or bury the person in
// dialogs.
import { GRID_LAYOUTS, isGridLayout, unavailable } from '../lib/layouts'
import { errorMessage, ipc, type AgentCall } from '../lib/ipc'
import { STATUS_LABEL, resetsIn, tildify } from '../lib/format'
import { cleanName, nameFromTask, uniqueName } from '../lib/naming'
import { basename, join } from '../lib/path'
import { IS_WINDOWS } from '../lib/platform'
import { layoutOf } from '../state/commands/layout'
import { setNotesOpen } from '../state/commands/notes'
import { getState } from '../state/store'
import type { Kind, LimitWindow, Status } from '../types'
import {
  createSession,
  expandHome,
  renameSession,
  restartSession,
  selectSession,
  setMode,
  stopSession,
  stopWorkspaceSessions,
  switchWorkspace,
  toggleFocus,
} from './actions'
import { caffeine, dock, media, notes, notify, pomodoro, reminders, settings } from './agentApps'
import { type Args, askPerson, asking, BUSY, type Ctx, fail, notDone, ok, pickByName, type Reply, sessionsIn } from './agentKit'
import { evenOutPanes, gridPanes, pickGridLayout } from './layouts'

export { answerAgentAsk } from './agentKit'

/** Each session may open this many sessions per window of time. */
export const OPEN_LIMIT = 3
export const OPEN_WINDOW_MS = 10 * 60_000

/** Sessions a tool opened, so the dialog can say so when one of them asks to
 *  open another. Kept for this launch only. */
const openedByTool = new Set<string>()
const opensBy = new Map<string, number[]>()

const TOOLS: Record<string, (ctx: Ctx, args: Args) => Reply | Promise<Reply>> = {
  list_sessions: listSessions,
  new_session: newSession,
  manage_session: manageSession,
  arrange,
  workspaces,
  usage,
  notes,
  notify,
  pomodoro,
  reminders,
  caffeine,
  media,
  dock,
  settings,
}

export async function handleAgentCall(call: AgentCall) {
  let reply: Reply
  try {
    const caller = getState().workspace.sessions[call.sessionId]
    const tool = Object.prototype.hasOwnProperty.call(TOOLS, call.tool) ? TOOLS[call.tool] : undefined
    if (!caller) reply = fail('This session is no longer in Konscious.')
    else if (!tool) reply = fail(`Konscious has no tool named ${JSON.stringify(call.tool)}.`)
    else reply = await tool({ callId: call.callId, caller }, call.args ?? {})
  } catch (e) {
    reply = fail(`Konscious couldn't do that: ${errorMessage(e)}`)
  }
  void ipc.agentReply(call.callId, reply.ok, reply.text).catch(() => {})
}

/* ── list_sessions ─────────────────────────────────────────────────── */

const STATE_WORDS: Partial<Record<Status, string>> = {
  waiting: 'waiting for the person',
  completed: 'finished',
}

function listSessions({ caller }: Ctx, args: Args): Reply {
  const s = getState()
  const home = s.ui.init?.home
  const all = args.scope === 'all'
  const lines: string[] = []
  for (const ws of s.workspace.workspaces) {
    if (!all && ws.id !== caller.workspaceId) continue
    const layout = layoutOf(s.layout.byWorkspace, ws.id)
    const view = s.workspace.activeId === ws.id ? (s.ui.notesOpen ? 'Notes' : layout.mode === 'focus' ? 'Focus' : 'Grid') : 'not on screen'
    lines.push(`Workspace ${ws.name} (${tildify(ws.path, home)}), ${view}:`)
    const sessions = sessionsIn(ws.id)
    if (!sessions.length) lines.push('- no sessions')
    for (const m of sessions) {
      const status = s.runtime.bySession[m.id]?.status ?? 'stopped'
      const state = STATE_WORDS[status] ?? STATUS_LABEL[status].toLowerCase()
      const place = layout.open.includes(m.id) ? 'in the grid' : 'hidden'
      const you = m.id === caller.id ? ' (you)' : ''
      lines.push(`- ${m.name}${you}: ${m.kind === 'shell' ? 'terminal' : 'Claude'}, ${state}, ${tildify(m.cwd, home)}, ${place}`)
    }
  }
  return ok(lines.join('\n'))
}

/* ── new_session ───────────────────────────────────────────────────── */

/** Where a tool asked to run: absolute, `~/…`, or relative to the caller. */
export function resolveFolder(folder: string, base: string, win = IS_WINDOWS): string {
  const f = folder.trim()
  if (!f) return base
  if (f === '~' || f.startsWith('~/') || f.startsWith('~\\')) return expandHome(f)
  const absolute = win ? /^([a-zA-Z]:[\\/]|\\\\)/.test(f) : f.startsWith('/')
  if (absolute) return f
  return f
    .split(/[\\/]+/)
    .filter(Boolean)
    .reduce((dir, part) => (part === '.' ? dir : join(dir, part, win)), base)
}

/** Opens so far this window, after forgetting old ones. */
export function recentOpens(times: number[], now: number, windowMs = OPEN_WINDOW_MS): number[] {
  return times.filter((t) => now - t < windowMs)
}

async function newSession({ callId, caller }: Ctx, args: Args): Promise<Reply> {
  const now = Date.now()
  const recent = recentOpens(opensBy.get(caller.id) ?? [], now)
  if (recent.length >= OPEN_LIMIT) {
    return fail(`This session has opened ${OPEN_LIMIT} sessions in the last 10 minutes. Wait, or ask the person to open more.`)
  }
  if (asking()) return BUSY
  if (args.kind !== undefined && args.kind !== 'claude' && args.kind !== 'terminal') {
    return fail('kind must be "claude" or "terminal".')
  }

  const kind: Kind = args.kind === 'terminal' ? 'shell' : 'claude'
  const task = typeof args.task === 'string' && kind === 'claude' ? args.task.trim().slice(0, 4000) : ''
  const dir = resolveFolder(typeof args.folder === 'string' ? args.folder : '', caller.cwd)
  if (!(await ipc.fsIsDir(dir).catch(() => false))) return fail(`There is no folder at ${dir}.`)

  const taken = sessionsIn(caller.workspaceId).map((m) => m.name)
  const given = typeof args.name === 'string' ? cleanName(args.name) : ''
  const fallback = kind === 'shell' ? 'Terminal' : basename(dir) || 'Session'
  const name = uniqueName(given || (task ? nameFromTask(task) : '') || cleanName(fallback) || 'Session', taken)
  const where = tildify(dir, getState().ui.init?.home)

  const claude = kind === 'claude'
  const chained = openedByTool.has(caller.id)
  const answer = await askPerson({
    callId,
    from: caller.name,
    asks: claude ? 'wants to open a session' : 'wants to open a terminal',
    avatar: name,
    rows: [
      { label: 'Name', value: name },
      { label: 'Folder', value: where, mono: true },
      ...(claude ? [{ label: 'Task', value: task || 'No task: it starts empty.', long: true }] : []),
    ],
    note: [
      chained && `${caller.name} was itself opened by another session.`,
      claude ? 'It runs as a normal session with your usual permissions, and Konscious asks you before it opens anything.' : 'It opens a terminal in that folder.',
    ]
      .filter(Boolean)
      .join(' '),
    confirm: claude ? 'Open session' : 'Open terminal',
  })
  if (answer !== 'yes') return notDone(answer, `open “${name}”`)

  opensBy.set(caller.id, [...recent, now])
  if (!getState().workspace.workspaces.some((w) => w.id === caller.workspaceId)) {
    return fail('Your workspace was removed while the person was deciding.')
  }
  const id = await createSession(
    { kind, workspaceId: caller.workspaceId, name, dir },
    { prompt: task || undefined, quiet: true },
  )
  if (!id) return fail(`Konscious couldn’t open “${name}”.`)
  openedByTool.add(id)

  if (!claude) return ok(`Opened a terminal “${name}” in ${where}.`)
  if (task && IS_WINDOWS) {
    return ok(`Opened “${name}” in ${where}, but Konscious can’t hand it the task on Windows yet. Tell the person to paste the task into it.`)
  }
  return ok(`Opened “${name}” in ${where}${task ? ' and gave it the task' : ''}. Use list_sessions to see how it is doing.`)
}

/* ── manage_session ────────────────────────────────────────────────── */

async function manageSession({ callId, caller }: Ctx, args: Args): Promise<Reply> {
  const mine = sessionsIn(caller.workspaceId)
  const target = pickByName(mine, args.session, 'session')
  if (typeof target === 'string') return fail(target)
  const action = args.action

  if (action === 'rename') {
    const name = typeof args.name === 'string' ? cleanName(args.name) : ''
    if (!name) return fail('Give the new name: letters, digits, spaces and dashes, up to 24 characters.')
    const unique = uniqueName(
      name,
      mine.filter((m) => m.id !== target.id).map((m) => m.name),
    )
    renameSession(target.id, unique)
    return ok(`Renamed “${target.name}” to “${unique}”.`)
  }
  if (action !== 'stop' && action !== 'restart') return fail('action must be "rename", "stop" or "restart".')
  if (target.id === caller.id) return fail(`You can’t ${action} yourself. Ask the person to do it.`)
  const running = getState().runtime.bySession[target.id]?.running ?? false
  if (action === 'stop' && !running) return ok(`“${target.name}” isn’t running.`)
  if (asking()) return BUSY

  const stop = action === 'stop'
  const answer = await askPerson({
    callId,
    from: caller.name,
    asks: `wants to ${action} “${target.name}”`,
    avatar: target.name,
    rows: [
      { label: 'Session', value: target.name },
      { label: 'Folder', value: tildify(target.cwd, getState().ui.init?.home), mono: true },
    ],
    note: stop
      ? 'Its conversation is kept, and you can start it again from its pane.'
      : 'It stops and starts again, picking up its conversation where it was.',
    confirm: stop ? 'Stop session' : 'Restart session',
  })
  if (answer !== 'yes') return notDone(answer, `${action} “${target.name}”`)
  if (stop) stopSession(target.id)
  else await restartSession(target.id)
  return ok(stop ? `Stopped “${target.name}”.` : `Restarted “${target.name}”.`)
}

/* ── workspaces ────────────────────────────────────────────────────── */

async function workspaces({ callId, caller }: Ctx, args: Args): Promise<Reply> {
  const s = getState()
  const home = s.ui.init?.home
  const all = s.workspace.workspaces
  if (args.action === 'list') {
    const lines = all.map((w) => {
      const sessions = sessionsIn(w.id)
      const running = sessions.filter((m) => s.runtime.bySession[m.id]?.running).length
      const marks = [w.id === caller.workspaceId && 'yours', w.id === s.workspace.activeId && 'on screen'].filter(Boolean)
      return `- ${w.name}${marks.length ? ` (${marks.join(', ')})` : ''}: ${tildify(w.path, home)}, ${sessions.length} session${sessions.length === 1 ? '' : 's'}, ${running} running`
    })
    return ok(lines.join('\n') || 'No workspaces.')
  }
  const target = pickByName(all, args.workspace, 'workspace')
  if (typeof target === 'string') return fail(target)
  if (args.action === 'switch') {
    switchWorkspace(target.id)
    return ok(`${target.name} is on screen now.`)
  }
  if (args.action !== 'stop_all') return fail('action must be "list", "switch" or "stop_all".')
  if (target.id === caller.workspaceId) return fail('That would stop you too. Ask the person to stop their own workspace.')
  const running = sessionsIn(target.id).filter((m) => s.runtime.bySession[m.id]?.running)
  if (!running.length) return ok(`Nothing is running in ${target.name}.`)
  if (asking()) return BUSY
  const answer = await askPerson({
    callId,
    from: caller.name,
    asks: `wants to stop everything in ${target.name}`,
    rows: [
      { label: 'Workspace', value: `${target.name} · ${tildify(target.path, home)}` },
      { label: 'Running', value: running.map((m) => m.name).join(', ') },
    ],
    note: 'Each session keeps its conversation and can be started again.',
    confirm: `Stop ${running.length} session${running.length === 1 ? '' : 's'}`,
  })
  if (answer !== 'yes') return notDone(answer, `stop ${target.name}`)
  const n = stopWorkspaceSessions(target.id)
  return ok(`Stopped ${n} session${n === 1 ? '' : 's'} in ${target.name}.`)
}

/* ── arrange ───────────────────────────────────────────────────────── */

function arrange({ caller }: Ctx, args: Args): Reply {
  const s = getState()
  if (s.workspace.activeId !== caller.workspaceId) {
    return fail('Your workspace isn’t the one on screen, so Konscious left the layout alone.')
  }
  const { view, grid, focus } = args
  if (view !== undefined && view !== 'grid' && view !== 'focus' && view !== 'notes') {
    return fail('view must be "grid", "focus" or "notes".')
  }
  if (grid !== undefined && !isGridLayout(grid)) {
    return fail(`grid must be one of ${GRID_LAYOUTS.map((g) => `"${g.id}"`).join(', ')}.`)
  }
  const done: string[] = []

  let targetId: string | undefined
  if (focus !== undefined) {
    const target = pickByName(sessionsIn(caller.workspaceId), focus, 'session')
    if (typeof target === 'string') return fail(target)
    selectSession(target.id)
    targetId = target.id
    done.push(`selected ${target.name}`)
  }

  if (view === 'notes') {
    setNotesOpen(true)
    done.push('opened Notes')
  } else if (view === 'focus') {
    if (getState().ui.notesOpen) setNotesOpen(false)
    if (layoutOf(getState().layout.byWorkspace, caller.workspaceId).mode !== 'focus') toggleFocus(targetId)
    done.push('switched to Focus')
  } else if (view === 'grid') {
    setMode('grid')
    done.push('switched to Grid')
  }

  if (grid) {
    const g = gridPanes()
    const why = unavailable(grid, g.n, g.terminals)
    if (why) return fail(`${done.length ? `Done: ${done.join(', ')}. ` : ''}Couldn’t use that grid: ${why}.`)
    pickGridLayout(grid, { hud: true })
    done.push(`arranged the grid as ${GRID_LAYOUTS.find((x) => x.id === grid)?.name ?? grid}`)
  }
  if (args.even_out === true) {
    evenOutPanes()
    done.push('evened out the pane sizes')
  }
  return done.length ? ok(`Done: ${done.join(', ')}.`) : fail('Nothing to change: give view, grid, focus or even_out.')
}

/* ── usage ─────────────────────────────────────────────────────────── */

const windowText = (label: string, w: LimitWindow | null) =>
  w ? `${label}: ${Math.round(w.pct)}% used, ${resetsIn(w.resetsAt)}.` : `${label}: not reported yet.`

function usage(): Reply {
  const limits = getState().ui.limits
  if (!limits) return ok('Konscious hasn’t seen plan usage yet. It appears after Claude’s first reply in any session.')
  return ok(`${windowText('5-hour window', limits.fiveHour)} ${windowText('7-day window', limits.sevenDay)}`)
}

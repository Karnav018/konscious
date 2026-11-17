// The tools for everything around the sessions: the dock apps, the workspace
// notes, a message to the person, and the look of the app (app/agent.ts routes
// calls here). Each one calls the same commands the app's own controls use.
import { APPS, type AppId, nextDueAt, pomoClock, pomoLeft } from '../lib/apps'
import { type CupSize, DRINKS, doseFor, type DrinkId, inBody, mg, todayTotal } from '../lib/caffeine'
import { clock } from '../lib/format'
import { errorMessage, ipc } from '../lib/ipc'
import { PALETTES, type PaletteId } from '../lib/themes'
import {
  acknowledge,
  addDose,
  setAppOn,
  setAppPinned,
  setDockPlace,
  setEvery,
  setPomoLength,
  skip,
  snooze,
  startPomo,
  stopPomoTimer,
  undoDose,
} from '../state/commands/apps'
import { addTask, currentNotes, linkTask, notesOf, setScratch, toggleTask } from '../state/commands/notes'
import { flash } from '../state/commands/ui'
import { getState } from '../state/store'
import type { Theme } from '../types'
import { setPalette, setTerminalSize, setTheme, toggleWarm } from './actions'
import { type Args, askPerson, asking, BUSY, type Ctx, fail, ok, pickByName, plain, type Reply, sessionsIn, wholeIn } from './agentKit'

/* ── notes ─────────────────────────────────────────────────────────── */

export function notes({ caller }: Ctx, args: Args): Reply {
  const ws = caller.workspaceId
  const read = () => currentNotes(notesOf(getState(), ws))
  const { tasks, scratch } = read()
  const names = getState().workspace.sessions
  const pick = () => {
    const n = wholeIn(args.task, 1, tasks.length)
    return n === null ? null : tasks[n - 1]
  }
  switch (args.action) {
    case 'list': {
      const list = tasks.map((t, i) => {
        const who = t.sessionId && names[t.sessionId] ? ` (→ ${names[t.sessionId].name})` : ''
        return `${i + 1}. [${t.done ? 'x' : ' '}] ${t.text}${who}`
      })
      const pad = scratch.trim() ? `\nScratch pad:\n${scratch.trim().slice(0, 2000)}` : '\nThe scratch pad is empty.'
      return ok(`${list.length ? `Tasks:\n${list.join('\n')}` : 'No tasks.'}${pad}`)
    }
    case 'add': {
      const text = plain(args.text, 500)
      if (!text) return fail('Give the task as text.')
      addTask(ws, text)
      // New tasks go on top, as the Notes view shows them.
      return ok(`Added as task 1: ${text}`)
    }
    case 'done':
    case 'undone': {
      const task = pick()
      if (!task) return fail(`task must be a number from 1 to ${tasks.length}. list shows them.`)
      const want = args.action === 'done'
      if (task.done !== want) toggleTask(ws, task.id)
      return ok(`Task “${task.text}” is ${want ? 'done' : 'open again'}.`)
    }
    case 'link': {
      const task = pick()
      if (!task) return fail(`task must be a number from 1 to ${tasks.length}. list shows them.`)
      const target = pickByName(sessionsIn(ws), args.session, 'session')
      if (typeof target === 'string') return fail(target)
      linkTask(ws, task.id, target.id)
      return ok(`Linked “${task.text}” to ${target.name}.`)
    }
    case 'append': {
      const line = plain(args.text, 500)
      if (!line) return fail('Give the line as text.')
      setScratch(ws, scratch.trim() ? `${scratch.replace(/\s+$/, '')}\n${line}` : line)
      return ok('Added to the scratch pad.')
    }
    default:
      return fail('action must be "list", "add", "done", "undone", "link" or "append".')
  }
}

/* ── notify ────────────────────────────────────────────────────────── */

const NOTIFY_GAP_MS = 10_000
const lastNotify = new Map<string, number>()

export function notify({ caller }: Ctx, args: Args): Reply {
  const title = plain(args.title, 80)
  const body = plain(args.body, 240)
  if (!title) return fail('Give a title.')
  const now = Date.now()
  if (now - (lastNotify.get(caller.id) ?? -Infinity) < NOTIFY_GAP_MS) return fail('One message every 10 seconds. Try again shortly.')
  lastNotify.set(caller.id, now)
  flash(`${caller.name}: ${title}${body ? `. ${body}` : ''}`)
  if (!document.hasFocus()) ipc.notify(`${caller.name}: ${title}`, body)
  return ok('The person has the message.')
}

/* ── pomodoro ──────────────────────────────────────────────────────── */

export function pomodoro(_: Ctx, args: Args): Reply {
  const focus = args.focus_minutes === undefined ? undefined : wholeIn(args.focus_minutes, 1, 180)
  const brk = args.break_minutes === undefined ? undefined : wholeIn(args.break_minutes, 1, 60)
  if (focus === null) return fail('focus_minutes must be a whole number from 1 to 180.')
  if (brk === null) return fail('break_minutes must be a whole number from 1 to 60.')
  if (focus) setPomoLength('focusMin', focus)
  if (brk) setPomoLength('breakMin', brk)

  const status = () => {
    const { pomo, pomoSet } = getState().ui.apps
    const lengths = `Focus ${pomoSet.focusMin} min, break ${pomoSet.breakMin} min, ${pomo.rounds} round${pomo.rounds === 1 ? '' : 's'} today.`
    if (pomo.phase === 'idle') return `The timer is stopped. ${lengths}`
    return `${pomo.phase === 'focus' ? 'Focus' : 'Break'}: ${pomoClock(pomoLeft(pomo))} left. ${lengths}`
  }
  switch (args.action) {
    case 'status':
      return ok(status())
    case 'start':
      if (!getState().ui.apps.on.pomo) setAppOn('pomo', true)
      startPomo()
      return ok(`Started. ${status()}`)
    case 'stop':
      stopPomoTimer()
      return ok(`Stopped. ${status()}`)
    default:
      return fail('action must be "status", "start" or "stop".')
  }
}

/* ── reminders ─────────────────────────────────────────────────────── */

export function reminders(_: Ctx, args: Args): Reply {
  const id = args.reminder
  if (id !== 'water' && id !== 'stand') return fail('reminder must be "water" or "stand".')
  const name = id === 'water' ? 'Drink water' : 'Stand up'
  const on = getState().ui.apps.on[id]
  if (args.action === 'every') {
    const minutes = wholeIn(args.minutes, 10, 240)
    if (minutes === null) return fail('minutes must be a whole number from 10 to 240.')
    setEvery(id, minutes)
    return ok(`${name} now comes every ${minutes} minutes.${on ? '' : ' It is switched off; the dock tool switches it on.'}`)
  }
  if (args.action === 'status') {
    const { every, reminders: r } = getState().ui.apps
    if (!on) return ok(`${name} is off.`)
    const next = nextDueAt(every[id], r[id])
    return ok(`${name} comes every ${every[id]} minutes. ${r[id].dueAt ? 'It is due now.' : next ? `Next at ${clock(next)}.` : ''}`.trim())
  }
  if (!on) return fail(`${name} is off. The dock tool switches it on.`)
  switch (args.action) {
    case 'done':
      acknowledge(id)
      return ok(`${name} marked done; the next one is a full interval away.`)
    case 'snooze':
      snooze(id)
      return ok(`${name} snoozed for ${getState().ui.apps.snoozeMin} minutes.`)
    case 'skip':
      skip(id)
      return ok(`Skipped this ${name.toLowerCase()} reminder.`)
    default:
      return fail('action must be "status", "done", "snooze", "skip" or "every".')
  }
}

/* ── caffeine ──────────────────────────────────────────────────────── */

const SIZES: Record<CupSize, string> = { s: 'small', m: 'medium', l: 'large' }

export function caffeine(_: Ctx, args: Args): Reply {
  const today = () => {
    const { log, limitMg } = getState().ui.apps.caff
    const now = Date.now()
    return `Today: ${mg(todayTotal(log, now))} of ${mg(limitMg)}, about ${mg(inBody(log, now))} still in the system.`
  }
  switch (args.action) {
    case 'status':
      return ok(today())
    case 'log': {
      const drink = (args.drink ?? 'coffee') as DrinkId
      const def = DRINKS.find((d) => d.id === drink)
      if (!def) return fail(`drink must be one of ${DRINKS.map((d) => `"${d.id}"`).join(', ')}.`)
      const size = (args.size ?? getState().ui.apps.caff.size) as CupSize
      if (!(size in SIZES)) return fail('size must be "s", "m" or "l".')
      const amount = doseFor(drink, size)
      addDose(amount)
      return ok(`Logged a ${SIZES[size]} ${def.name.toLowerCase()} (${mg(amount)}). ${today()}`)
    }
    case 'undo':
      if (!getState().ui.apps.caff.log.length) return fail('There is nothing to undo.')
      undoDose()
      return ok(`Removed the last drink. ${today()}`)
    default:
      return fail('action must be "status", "log" or "undo".')
  }
}

/* ── media ─────────────────────────────────────────────────────────── */

const MEDIA_ACTIONS = { play_pause: 'toggle', next: 'next', previous: 'prev' } as const

export async function media(_: Ctx, args: Args): Promise<Reply> {
  if (args.action === 'status') {
    const m = await ipc.mediaNow()
    if (m.denied) return ok('The computer hasn’t allowed Konscious to see the music player.')
    if (!m.now) return ok('Nothing is playing.')
    return ok(`${m.now.playing ? 'Playing' : 'Paused'}: ${m.now.title} by ${m.now.artist} in ${m.now.app}.`)
  }
  const action = typeof args.action === 'string' ? MEDIA_ACTIONS[args.action as keyof typeof MEDIA_ACTIONS] : undefined
  if (!action) return fail('action must be "status", "play_pause", "next" or "previous".')
  try {
    return (await ipc.mediaControl(action)) ? ok('Done.') : fail('No player answered.')
  } catch (e) {
    return fail(`The player didn’t respond: ${errorMessage(e)}`)
  }
}

/* ── dock ──────────────────────────────────────────────────────────── */

const EDGES = ['left', 'right', 'top', 'bottom'] as const

export function dock(_: Ctx, args: Args): Reply {
  const apps = getState().ui.apps
  if (args.action === 'list') {
    const lines = APPS.map((a) => `- ${a.name} (${a.id}): ${apps.on[a.id] ? 'on' : 'off'}${apps.pinned[a.id] ? ', in the dock' : ''}`)
    return ok(`The dock is on the ${apps.edge} edge.\n${lines.join('\n')}`)
  }
  if (args.action === 'move') {
    const edge = EDGES.find((e) => e === args.edge)
    if (!edge) return fail('edge must be "left", "right", "top" or "bottom".')
    setDockPlace(edge, apps.along)
    return ok(`Moved the dock to the ${edge} edge.`)
  }
  const want = typeof args.app === 'string' ? args.app.trim().toLowerCase() : ''
  const app = APPS.find((a) => a.id === want || a.name.toLowerCase() === want || a.short?.toLowerCase() === want)
  if (!app) return fail(`app must be one of ${APPS.map((a) => `"${a.id}"`).join(', ')}.`)
  const id: AppId = app.id
  switch (args.action) {
    case 'on':
      setAppOn(id, true)
      return ok(`${app.name} is on.`)
    case 'off':
      setAppOn(id, false)
      return ok(`${app.name} is off.`)
    case 'pin':
      setAppPinned(id, true)
      return ok(`${app.name} is in the dock.`)
    case 'unpin':
      setAppPinned(id, false)
      return ok(`${app.name} is out of the dock; it stays ${apps.on[id] ? 'on' : 'off'}.`)
    default:
      return fail('action must be "list", "on", "off", "pin", "unpin" or "move".')
  }
}

/* ── settings ──────────────────────────────────────────────────────── */

export async function settings({ callId, caller }: Ctx, args: Args): Promise<Reply> {
  const ui = getState().ui
  const themeName = (id: PaletteId) => PALETTES.find((p) => p.id === id)?.name ?? id
  const now = `${ui.theme === 'light' ? 'Light' : 'Dark'} mode, ${themeName(ui.palette)} theme, terminal text ${ui.fontSize}px, warm colours ${ui.warm ? 'on' : 'off'}.`

  const rows: { label: string; value: string }[] = []
  const mode = args.mode
  if (mode !== undefined && mode !== 'light' && mode !== 'dark') return fail('mode must be "light" or "dark".')
  const palette = args.theme === undefined ? undefined : PALETTES.find((p) => p.id === args.theme)
  if (palette === undefined && args.theme !== undefined) {
    return fail(`theme must be one of ${PALETTES.map((p) => `"${p.id}"`).join(', ')}.`)
  }
  const size = args.terminal_size === undefined ? undefined : wholeIn(args.terminal_size, 9, 24)
  if (size === null) return fail('terminal_size must be a whole number from 9 to 24.')
  if (args.warm !== undefined && typeof args.warm !== 'boolean') return fail('warm must be true or false.')
  const warm = args.warm as boolean | undefined

  if (mode && mode !== ui.theme) rows.push({ label: 'Mode', value: `${ui.theme} → ${mode}` })
  if (palette && palette.id !== ui.palette) rows.push({ label: 'Theme', value: `${themeName(ui.palette)} → ${palette.name}` })
  if (size && size !== ui.fontSize) rows.push({ label: 'Text', value: `${ui.fontSize}px → ${size}px` })
  if (warm !== undefined && warm !== ui.warm) rows.push({ label: 'Warm', value: warm ? 'off → on' : 'on → off' })
  if (!rows.length) return ok(`Nothing to change. Now: ${now}`)
  if (asking()) return BUSY

  const yes = await askPerson({
    callId,
    from: caller.name,
    asks: 'wants to change how Konscious looks',
    rows,
    note: 'You can change any of these back in Settings.',
    confirm: 'Change',
  })
  if (!yes) return ok(`The person kept the current look: ${now}`)
  if (mode && mode !== ui.theme) setTheme(mode as Theme)
  if (palette && palette.id !== ui.palette) await setPalette(palette.id)
  if (size && size !== ui.fontSize) setTerminalSize(size)
  if (warm !== undefined && warm !== getState().ui.warm) toggleWarm()
  return ok(`Changed: ${rows.map((r) => `${r.label.toLowerCase()} ${r.value}`).join(', ')}.`)
}

// Mini apps: the catalog, when a reminder is due, and where the dock sits.
//
// From the design of 3 Oct 2026. Three rules shape all of it:
//
//   · An app never takes a pane. The dock floats over the grid and takes no
//     width from it. An app earns a pane only if it shows something you would
//     look at unprompted; being prompted is the dock's job.
//   · An app never uses a session colour. Each has its own hue, clear of --ok,
//     --warn, --err and --info, and app tiles are square where sessions are
//     round. Apps never count toward "waiting".
//   · A reminder interrupts once. One system notification, no repeat, no
//     pulse, and missed ones do not stack.
//
// Everything here is pure. The dock reads it; nothing in it touches the DOM.

export type AppId = 'water' | 'stand' | 'sys' | 'pomo'
export type AppCategory = 'Reminders' | 'Timers' | 'System'

export interface AppDef {
  id: AppId
  name: string
  /** The label on the tile when there is no room for the name. */
  short: string
  hue: string
  category: AppCategory
  /** One line, as the catalog lists it. */
  desc: string
  /** The catalog's About tab. */
  long: string
  /** "How it works", in order. */
  steps: readonly string[]
  /** Words the catalog's search matches besides the name. */
  tags: readonly string[]
  /** What the app can do, which later becomes the permission model. */
  can: readonly string[]
  /** Minutes between nudges, for a reminder. Absent for a gauge. */
  everyMin?: number
  /** What the popover's acknowledge button says. */
  ack?: string
}

/** Every app that ships inside Konscious. Order is the catalog's order. */
export const APPS: readonly AppDef[] = [
  {
    id: 'water',
    name: 'Drink water',
    short: 'Water',
    hue: 'var(--water)',
    category: 'Reminders',
    desc: 'A nudge to drink, and a count of glasses today.',
    long: 'A gentle reminder to drink while you work. Tap once to count a glass, and the timer starts over from that moment, not from when the reminder fired.',
    steps: [
      'Every 40 minutes you get one notification, and the drop in the dock fills.',
      'Tap Had a glass to count it, or In 10 min if you’re mid-thought.',
      'The timer restarts from your tap. Missed reminders don’t stack.',
    ],
    tags: ['hydration', 'glass', 'health'],
    can: ['Show a tile in the dock', 'Raise a system notification', 'Keep a count for today'],
    everyMin: 40,
    ack: 'Had a glass',
  },
  {
    id: 'stand',
    name: 'Stand up',
    short: 'Stand',
    hue: 'var(--stand)',
    category: 'Reminders',
    desc: 'A nudge to leave the desk for a minute.',
    long: 'A reminder to get up and move, timed around how long you’ve actually been sitting. It waits if a session needs you first.',
    steps: [
      'Every 50 minutes you get one notification, and the figure in the dock hops.',
      'Stand up, then tap Done. Or tap In 10 min to snooze.',
      'The timer restarts from Done, so the next nudge is honest.',
    ],
    tags: ['posture', 'break', 'move', 'health'],
    can: ['Show a tile in the dock', 'Raise a system notification'],
    everyMin: 50,
    ack: 'Done',
  },
  {
    id: 'pomo',
    name: 'Pomodoro',
    short: 'Focus',
    hue: 'var(--pomo)',
    category: 'Timers',
    desc: 'Timed focus stretches with a break between them.',
    long: 'A focus timer you start when you sit down to something. It runs a stretch, tells you to take a break, then starts the next one. Pick how long a stretch and a break should be; 25 and 5 is the classic pair.',
    steps: [
      'Pick a focus length — 5, 15, 25 or 30 minutes — and a break.',
      'Start it. The tile shows how much is left, and one notification goes out when the stretch ends.',
      'The break starts itself, and the next stretch follows it. Stop whenever.',
    ],
    tags: ['pomodoro', 'focus', 'timer', 'break', 'deep work', 'tomato', '25'],
    can: ['Show a timer in the dock', 'Raise a system notification when a stretch or break ends', 'Keep a count of today’s stretches'],
    ack: 'Start',
  },
  {
    id: 'sys',
    name: 'System stats',
    short: 'Stats',
    hue: 'var(--sys)',
    category: 'System',
    desc: 'CPU, memory, disk and temperature at a glance, at the top of the dock.',
    long: 'A small gauge at the top of the dock that cycles through CPU, memory, disk and temperature. It’s useful when several sessions are building at once. Click it to see all four together.',
    steps: [
      'The gauge cycles through CPU, memory, disk and temperature every 5 seconds.',
      'Click it to see all four at once, or pick one to stop the cycling on it.',
      'Cycling pauses while a session is waiting for you.',
    ],
    tags: ['cpu', 'ram', 'memory', 'ssd', 'disk', 'temperature', 'heat', 'monitor', 'gauge', 'performance'],
    can: ['Show a gauge in the dock', 'Read this machine’s processor, memory, disk and temperature'],
  },
]

export const appById = (id: AppId): AppDef => APPS.find((a) => a.id === id)!
export const isReminder = (a: AppDef): boolean => a.everyMin !== undefined

/** The system stats gauge cycles through these, in this order. */
export const METRICS = [
  { key: 'cpu', label: 'CPU', short: 'CPU', hue: 'var(--cpu)' },
  { key: 'ram', label: 'Memory', short: 'RAM', hue: 'var(--ram)' },
  { key: 'ssd', label: 'Disk', short: 'SSD', hue: 'var(--ssd)' },
  { key: 'tmp', label: 'Temperature', short: 'TEMP', hue: 'var(--tmp)' },
] as const

export type MetricKey = (typeof METRICS)[number]['key']

/** Temperature is read in °C on a gauge that tops out here, not at 100. */
export const TEMP_MAX = 105
/** Under this, a stat is dim: nothing worth looking at. */
export const QUIET_PCT = 30
/** At or over this, the stat and its tile turn --hot. */
export const HOT_PCT = 80

/** Where a metric sits on its own gauge, 0–1. */
export const gaugeFill = (key: MetricKey, value: number): number =>
  Math.max(0, Math.min(1, value / (key === 'tmp' ? TEMP_MAX : 100)))

/** How a stat is drawn: dim when idle, its own hue normally, --hot under load. */
export function metricTone(key: MetricKey, value: number): 'quiet' | 'normal' | 'hot' {
  const pct = gaugeFill(key, value) * 100
  if (pct >= HOT_PCT) return 'hot'
  return pct < QUIET_PCT ? 'quiet' : 'normal'
}

/* ── when a reminder is due ───────────────────────────────────────── */

/** What a reminder remembers. Times are epoch ms; nothing here is a timer. */
export interface ReminderState {
  /** When the user last acknowledged, or when the app was switched on. The
   *  interval runs from here, not from when the last nudge fired. */
  since: number
  /** Set by "In 10 min"; the nudge is held until then. */
  snoozedUntil: number | null
  /** When the current nudge became due, so it stays due until the next one. */
  dueAt: number | null
}

export const freshReminder = (now = Date.now()): ReminderState => ({ since: now, snoozedUntil: null, dueAt: null })

/** A reminder holds for up to this long while a session is waiting for you:
 *  the session is the more important interruption, but not indefinitely. */
export const HOLD_MS = 5 * 60 * 1000

export interface DueInput {
  every: number
  state: ReminderState
  /** A session is waiting for the user right now. */
  sessionWaiting: boolean
  now: number
}

/** Whether the tile should be showing a nudge. Due once per interval: it
 *  stays due until acknowledged or the interval comes round again, and never
 *  stacks. While a session is waiting it holds, but only for HOLD_MS. */
export function isDue({ every, state, sessionWaiting, now }: DueInput): boolean {
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return false
  const ready = now - state.since >= every * 60_000
  if (!ready) return state.dueAt !== null
  if (sessionWaiting && state.dueAt === null && now - state.since < every * 60_000 + HOLD_MS) return false
  return true
}

/** When the next nudge is expected, for the "around 14:20" line. Null while
 *  one is already due. */
export function nextDueAt(every: number, state: ReminderState, now = Date.now()): number | null {
  if (state.dueAt !== null) return null
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return state.snoozedUntil
  return state.since + every * 60_000
}

/** Acknowledged: the interval restarts from the tap, which is what makes the
 *  next nudge honest. */
export const acknowledged = (now = Date.now()): ReminderState => freshReminder(now)

/** "In 10 min". The interval still runs from the last acknowledgement. */
export const snoozed = (state: ReminderState, minutes: number, now = Date.now()): ReminderState => ({
  ...state,
  snoozedUntil: now + minutes * 60_000,
  dueAt: null,
})

/** "Skip this one": no glass counted, but the interval restarts, so the next
 *  nudge is a full interval away rather than immediate. */
export const skipped = (now = Date.now()): ReminderState => freshReminder(now)

/* ── where the dock sits ──────────────────────────────────────────── */

export type Edge = 'left' | 'right' | 'top' | 'bottom'
export const isVertical = (edge: Edge): boolean => edge === 'left' || edge === 'right'

/** The edge a point is nearest, for the line that marks the drop target. */
export function nearestEdge(x: number, y: number, width: number, height: number): Edge {
  const d: [Edge, number][] = [
    ['left', x],
    ['right', Math.max(0, width - x)],
    ['top', y],
    ['bottom', Math.max(0, height - y)],
  ]
  return d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]
}

/** How far along its edge the dock sits, 0–1, from a pointer position. */
export const alongEdge = (edge: Edge, x: number, y: number, width: number, height: number): number => {
  const raw = isVertical(edge) ? y / (height || 1) : x / (width || 1)
  return Math.max(0, Math.min(1, raw))
}

/* ── pomodoro ─────────────────────────────────────────────────────── */

// A pomodoro is not a reminder: the user starts it, it runs a focus stretch,
// then a break, then stops asking. So it keeps a phase and an end time rather
// than an interval, and it is the one app with something worth looking at
// unprompted — a tile that shows how much is left.

export type PomoPhase = 'idle' | 'focus' | 'break'

/** Focus lengths offered, in minutes. 25 is the classic one. */
export const FOCUS_CHOICES = [5, 15, 25, 30] as const
/** Break lengths offered. A break as long as the focus is nobody's pomodoro. */
export const BREAK_CHOICES = [5, 10, 15] as const

export interface PomoState {
  phase: PomoPhase
  /** When the running phase ends. Null while idle. */
  endsAt: number | null
  /** Focus stretches finished today. */
  rounds: number
}

export const freshPomo = (): PomoState => ({ phase: 'idle', endsAt: null, rounds: 0 })

export interface PomoSettings {
  focusMin: number
  breakMin: number
}

/** Starts a focus stretch, keeping the rounds already done. */
export const startFocus = (set: PomoSettings, state: PomoState, now = Date.now()): PomoState => ({
  phase: 'focus',
  endsAt: now + set.focusMin * 60_000,
  rounds: state.rounds,
})

/** Stops entirely. The rounds stay: they are the day's tally. */
export const stopPomo = (state: PomoState): PomoState => ({ phase: 'idle', endsAt: null, rounds: state.rounds })

/** Milliseconds left in the running phase; 0 when idle or already over. */
export function pomoLeft(state: PomoState, now = Date.now()): number {
  if (state.phase === 'idle' || state.endsAt === null) return 0
  return Math.max(0, state.endsAt - now)
}

/** How far through the phase, 0–1, for the ring drawn on the tile. */
export function pomoProgress(state: PomoState, set: PomoSettings, now = Date.now()): number {
  if (state.phase === 'idle') return 0
  const total = (state.phase === 'focus' ? set.focusMin : set.breakMin) * 60_000
  if (total <= 0) return 1
  return Math.max(0, Math.min(1, 1 - pomoLeft(state, now) / total))
}

export const pomoOver = (state: PomoState, now = Date.now()): boolean =>
  state.phase !== 'idle' && state.endsAt !== null && now >= state.endsAt

/** What follows the phase that just ended: focus earns a break and counts a
 *  round; a break goes straight back to focus, so the cycle keeps itself. */
export function pomoAdvance(state: PomoState, set: PomoSettings, now = Date.now()): PomoState {
  if (state.phase === 'focus') {
    return { phase: 'break', endsAt: now + set.breakMin * 60_000, rounds: state.rounds + 1 }
  }
  if (state.phase === 'break') {
    return { phase: 'focus', endsAt: now + set.focusMin * 60_000, rounds: state.rounds }
  }
  return state
}

/** What the notification says when a phase ends. */
export function pomoNotice(ended: PomoPhase, set: PomoSettings): { title: string; body: string } {
  return ended === 'focus'
    ? { title: 'Time for a break', body: `${set.breakMin} minutes. Leave the desk if you can.` }
    : { title: 'Back to it', body: `${set.focusMin} minutes of focus.` }
}

/** "24:59" — what the tile and popover show while a phase runs. */
export function pomoClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const m = Math.floor(total / 60)
  return `${m}:${String(total % 60).padStart(2, '0')}`
}

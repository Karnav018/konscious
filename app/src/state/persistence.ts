// Store ⇄ ~/.konscious, schema-first.
//
// Load:  raw JSON ─► migrate (versioned, stepwise) ─► zod validate per item
//        (bad items are dropped and counted, never fatal) ─► invariant repair
// Save:  committed state ─► serialize ─► diff vs last write ─► atomic save
//        (retried with backoff; failure is surfaced, not swallowed)
// Safety: data written by a *newer* schema is never overwritten — the app
//        runs read-only rather than silently downgrade someone's files.
import { produce } from 'immer'
import { z } from 'zod'

import { APPS, type AppId } from '../lib/apps'
import { CAP, emptyLayout } from '../lib/grid'
import { DEFAULT_GRID } from '../lib/layouts'
import { ipc } from '../lib/ipc'
import type { Place } from '../lib/sun'
import { DEFAULT_K, NEUTRAL_K, WARMEST_K, type WarmWhen } from '../lib/warmth'
import type { Layout, LayoutNode, Limits, NoteTask, SessionMeta, Snapshot, Theme, Workspace, WorkspaceNotes } from '../types'
import { act } from './act'
import { setPersistStatus } from './commands/ui'
import { repair } from './invariants'
import { type AppsState, type AppState, getState, initialState, useApp } from './store'

export const SCHEMA_VERSION = 2
export const DEFAULT_FONT = 12
export const FONT_MIN = 9
export const FONT_MAX = 24
export type FileKind = 'config' | 'workspaces' | 'layout' | 'notes'
type Raw = Record<string, unknown>
export type Migration = (raw: Raw) => Raw

/** version N → N+1 upgrades, per file kind. Add an entry when the schema changes. */
export const MIGRATIONS: Record<FileKind, Record<number, Migration>> = {
  // v2: the default terminal size is 12px. 12.5 was only ever the old default
  // (no UI could set it), so move it to the new default; keep any other value.
  config: { 1: (r) => ({ ...r, fontSize: r.fontSize === 12.5 ? DEFAULT_FONT : r.fontSize }) },
  // v2: sessions gained an optional per-pane fontSize (absent = automatic).
  workspaces: { 1: (r) => r },
  layout: { 1: (r) => r },
  // Notes arrived at schema v2; nothing older exists.
  notes: { 1: (r) => r },
}

export class NewerSchemaError extends Error {
  constructor(
    readonly file: FileKind,
    readonly version: number,
  ) {
    super(`${file} was written by a newer version of Konscious (schema v${version}; this build reads v${SCHEMA_VERSION})`)
  }
}

export function migrate(kind: FileKind, raw: Raw, table = MIGRATIONS[kind], current = SCHEMA_VERSION): Raw {
  let v = typeof raw.version === 'number' ? raw.version : 0
  if (v > current) throw new NewerSchemaError(kind, v)
  let data = raw
  while (v < current) {
    const step = table[v]
    if (!step) throw new Error(`no migration for ${kind} v${v} → v${v + 1}`)
    data = { ...step(data), version: v + 1 }
    v++
  }
  return data
}

/* ── schema v2 ───────────────────────────────────────────────────── */

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const Ms = z.number().finite().nonnegative().catch(0)

export const SessionV1 = z.object({
  id: Id,
  name: z.string().trim().min(1).max(200).catch('Untitled'),
  kind: z.enum(['claude', 'shell']).catch('claude'),
  cwd: z.string().min(1),
  claudeSessionId: z.string().regex(/^[0-9a-f-]{36}$/i).nullable().catch(null),
  wasRunning: z.boolean().catch(false),
  fontSize: z.number().min(FONT_MIN).max(FONT_MAX).nullable().catch(null),
  createdAt: Ms,
  lastActiveAt: Ms,
})

export const WorkspaceV1 = z.object({
  id: Id,
  name: z.string().min(1).optional(),
  path: z.string().min(1),
  createdAt: Ms,
  updatedAt: Ms,
  sessions: z.array(z.unknown()).catch([]),
})

const WorkspacesFileV1 = z.object({ version: z.literal(SCHEMA_VERSION), workspaces: z.array(z.unknown()).catch([]) })
const LimitWindowV = z.object({ pct: z.number().min(0).max(1000), resetsAt: z.number().nullable() }).nullable()
const ConfigFileV1 = z.object({
  version: z.literal(SCHEMA_VERSION),
  theme: z.enum(['dark', 'light']).catch('dark'),
  /** Warm colours for late sessions, and the temperature they warm to. */
  warm: z.boolean().catch(false).optional(),
  warmth: z.number().min(WARMEST_K).max(NEUTRAL_K).catch(DEFAULT_K).optional(),
  warmWhen: z.enum(['always', 'hours', 'sun']).catch('always').optional(),
  warmFrom: z.number().min(0).max(1439).catch(20 * 60).optional(),
  warmTo: z.number().min(0).max(1439).catch(6 * 60).optional(),
  warmPlace: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .nullable()
    .catch(null)
    .optional(),
  /** Last known plan usage, shown (faded) until the next live update. */
  limits: z.object({ fiveHour: LimitWindowV, sevenDay: LimitWindowV }).nullable().catch(null).optional(),
  limitsAt: z.number().nullable().catch(null).optional(),
  /** Mini apps: the dock's place, which apps are on, and their settings. */
  apps: z
    .object({
      edge: z.enum(['left', 'right', 'top', 'bottom']).catch('right'),
      along: z.number().min(0).max(1).catch(0.5),
      autoMinimise: z.boolean().catch(false),
      on: z.record(z.string(), z.boolean()).catch({}),
      pinned: z.record(z.string(), z.boolean()).catch({}),
      every: z.object({ water: z.number().min(1).max(600), stand: z.number().min(1).max(600) }).catch({ water: 40, stand: 50 }),
      snoozeMin: z.number().min(1).max(120).catch(10),
      glasses: z.number().min(0).max(100).catch(0),
      glassesOn: z.string().catch(''),
      asked: z.boolean().catch(false),
      pomo: z
        .object({
          phase: z.enum(['idle', 'focus', 'break']).catch('idle'),
          endsAt: z.number().nullable().catch(null),
          rounds: z.number().min(0).max(1000).catch(0),
        })
        .catch({ phase: 'idle', endsAt: null, rounds: 0 })
        .optional(),
      pomoSet: z
        .object({ focusMin: z.number().min(1).max(600), breakMin: z.number().min(1).max(600) })
        .catch({ focusMin: 25, breakMin: 5 })
        .optional(),
      statPinned: z.enum(['cpu', 'ram', 'ssd', 'tmp']).nullable().catch(null).optional(),
      reminders: z
        .record(
          z.string(),
          z.object({ since: Ms, snoozedUntil: z.number().nullable().catch(null), dueAt: z.number().nullable().catch(null) }),
        )
        .catch({}),
    })
    .nullable()
    .catch(null)
    .optional(),
  fontSize: z.number().min(FONT_MIN).max(FONT_MAX).catch(DEFAULT_FONT),
  activeWorkspace: z.string().nullable().catch(null),
})
// A dragged arrangement: panes and splits (whether it fits the panes is
// checked where it's used, in lib/layouts.ts).
const LayoutNodeV: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.object({ leaf: z.number().int().nonnegative() }),
    z.object({ dir: z.enum(['row', 'col']), kids: z.array(LayoutNodeV).min(2), w: z.array(z.number().positive().finite()) }),
  ]),
)

const LayoutFileV1 = z.object({
  version: z.literal(SCHEMA_VERSION),
  mode: z.enum(['grid', 'focus']).catch('grid'),
  open: z.array(z.string()).catch([]),
  recent: z.array(z.string()).catch([]),
  selected: z.string().nullable().catch(null),
  // Grid layouts; files from before them have neither and get even, balanced rows.
  grid: z.enum(['balanced', 'lead', 'columns', 'strip', 'free']).catch(DEFAULT_GRID).optional(),
  trees: z.record(z.string(), LayoutNodeV).catch({}).optional(),
})

// Notes: a bad task is dropped (and counted), never the whole file.
const NoteTaskV1 = z.object({
  id: z.string().min(1),
  text: z.string(),
  done: z.boolean(),
  sessionId: z.string().nullable().catch(null),
})
const NotesV1 = z.object({ tasks: z.array(z.unknown()).catch([]), scratch: z.string().catch('') })
const NotesFileV1 = z.object({
  version: z.literal(SCHEMA_VERSION),
  saved: NotesV1.catch({ tasks: [], scratch: '' }),
  draft: NotesV1.nullable().catch(null),
  pref: z
    .object({ dest: z.enum(['app', 'repo', 'other']), name: z.string(), dir: z.string().nullable().catch(null) })
    .nullable()
    .catch(null),
  lastSaved: z.object({ file: z.string().nullable(), at: z.number() }).nullable().catch(null),
})

export interface Decoded {
  workspaces: Workspace[]
  sessions: Record<string, SessionMeta>
  activeId: string | null
  layouts: Record<string, Layout>
  notes: Record<string, WorkspaceNotes>
  theme: Theme
  apps: AppsState
  warm: boolean
  warmth: number
  warmWhen: WarmWhen
  warmFrom: number
  warmTo: number
  warmPlace: Place | null
  fontSize: number
  limits: Limits | null
  limitsAt: number | null
  /** Entries that failed validation and were dropped. */
  skipped: number
  /** Set when any file is from a newer schema: load it, but never save. */
  readonly: string | null
}

export function decode(snap: Snapshot): Decoded {
  let skipped = 0
  let readonly: string | null = null
  const load = <T>(kind: FileKind, raw: unknown, schema: z.ZodType<T>): T | null => {
    if (!raw || typeof raw !== 'object') return null
    try {
      const r = schema.safeParse(migrate(kind, raw as Raw))
      if (!r.success) skipped++
      return r.success ? r.data : null
    } catch (e) {
      if (e instanceof NewerSchemaError) {
        readonly = e.message
        // Best effort: read what this build understands.
        const r = schema.safeParse({ ...(raw as Raw), version: SCHEMA_VERSION })
        return r.success ? r.data : null
      }
      skipped++
      return null
    }
  }

  const workspaces: Workspace[] = []
  const sessions: Record<string, SessionMeta> = {}
  for (const rawWs of load('workspaces', snap.workspaces, WorkspacesFileV1)?.workspaces ?? []) {
    const w = WorkspaceV1.safeParse(rawWs)
    if (!w.success || workspaces.some((x) => x.id === w.data.id)) {
      skipped++
      continue
    }
    const { sessions: rawSessions, ...ws } = w.data
    workspaces.push({ ...ws, name: ws.name ?? ws.path.split('/').pop() ?? ws.path })
    for (const rawS of rawSessions) {
      const s = SessionV1.safeParse(rawS)
      if (!s.success || sessions[s.data.id]) {
        skipped++
        continue
      }
      sessions[s.data.id] = { ...s.data, workspaceId: w.data.id }
    }
  }

  const layouts: Record<string, Layout> = {}
  for (const w of workspaces) {
    const l = load('layout', snap.layouts[w.id], LayoutFileV1)
    layouts[w.id] = l
      ? { mode: l.mode, open: l.open.slice(0, CAP), recent: l.recent, selected: l.selected, grid: l.grid ?? DEFAULT_GRID, trees: l.trees ?? {} }
      : emptyLayout()
  }

  const notes: Record<string, WorkspaceNotes> = {}
  const tasksOf = (raw: unknown[]): NoteTask[] => {
    const out: NoteTask[] = []
    for (const t of raw) {
      const r = NoteTaskV1.safeParse(t)
      if (r.success) out.push(r.data)
      else skipped++
    }
    return out
  }
  for (const w of workspaces) {
    const n = load('notes', snap.notes?.[w.id], NotesFileV1)
    if (!n) continue
    notes[w.id] = {
      saved: { tasks: tasksOf(n.saved.tasks), scratch: n.saved.scratch },
      draft: n.draft ? { tasks: tasksOf(n.draft.tasks), scratch: n.draft.scratch } : null,
      pref: n.pref,
      lastSaved: n.lastSaved,
    }
  }

  const cfg = load('config', snap.config, ConfigFileV1)
  return {
    workspaces,
    sessions,
    layouts,
    notes,
    activeId: cfg?.activeWorkspace ?? null,
    theme: cfg?.theme ?? 'dark',
    apps: appsFrom(cfg?.apps),
    warm: cfg?.warm ?? false,
    warmWhen: cfg?.warmWhen ?? 'always',
    warmFrom: cfg?.warmFrom ?? 20 * 60,
    warmTo: cfg?.warmTo ?? 6 * 60,
    warmPlace: cfg?.warmPlace ?? null,
    warmth: cfg?.warmth ?? DEFAULT_K,
    fontSize: cfg?.fontSize ?? DEFAULT_FONT,
    limits: cfg?.limits ?? null,
    limitsAt: cfg?.limitsAt ?? null,
    skipped,
    readonly,
  }
}

/** The saved apps state, with every gap filled from the defaults — a config
 *  from before mini apps, or one missing an app added since, both load. */
function appsFrom(saved: unknown): AppsState {
  const base = initialState().ui.apps
  const got = (saved ?? {}) as Partial<AppsState>
  const flags = (from: unknown, fallback: Record<string, boolean>) => {
    const m = { ...fallback } as Record<AppId, boolean>
    for (const app of APPS) {
      const v = (from as Record<string, unknown> | null | undefined)?.[app.id]
      if (typeof v === 'boolean') m[app.id] = v
    }
    return m
  }
  // A pomodoro that was running when the app quit is not resumed: a phase
  // that ended hours ago is not a phase.
  const pomo = got.pomo && got.pomo.phase !== 'idle' ? { ...got.pomo, phase: 'idle' as const, endsAt: null } : base.pomo
  const reminders = { ...base.reminders }
  for (const id of ['water', 'stand'] as const) {
    const r = got.reminders?.[id]
    if (r && Number.isFinite(r.since)) reminders[id] = r
  }
  return {
    ...base,
    ...got,
    on: flags(got.on, base.on),
    pinned: flags(got.pinned, base.pinned),
    every: { ...base.every, ...got.every },
    pomo,
    pomoSet: { ...base.pomoSet, ...got.pomoSet },
    reminders,
  }
}

/** Loads decoded data into the store, healed to satisfy every invariant. */
export function hydrate(dec: Decoded) {
  act('app/hydrate', (d) => {
    d.workspace.workspaces = dec.workspaces
    d.workspace.sessions = dec.sessions
    d.workspace.activeId = dec.activeId
    d.layout.byWorkspace = dec.layouts
    d.notes.byWorkspace = dec.notes
    d.ui.theme = dec.theme
    d.ui.apps = dec.apps
    d.ui.warm = dec.warm
    d.ui.warmWhen = dec.warmWhen
    d.ui.warmFrom = dec.warmFrom
    d.ui.warmTo = dec.warmTo
    d.ui.warmPlace = dec.warmPlace
    d.ui.warmth = dec.warmth
    d.ui.fontSize = dec.fontSize
    d.ui.limits = dec.limits
    d.ui.limitsAt = dec.limitsAt
    d.ui.limitsLive = false
    repair(d)
  })
}

/* ── save ────────────────────────────────────────────────────────── */

export function serialize(s: AppState = getState()) {
  const { workspaces, sessions, activeId } = s.workspace
  const byWs = (id: string) =>
    Object.values(sessions)
      .filter((x) => x.workspaceId === id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ workspaceId: _w, ...rest }) => rest)
  return {
    config: {
      version: SCHEMA_VERSION,
      theme: s.ui.theme,
      apps: s.ui.apps,
      warm: s.ui.warm,
      warmWhen: s.ui.warmWhen,
      warmFrom: s.ui.warmFrom,
      warmTo: s.ui.warmTo,
      warmPlace: s.ui.warmPlace,
      warmth: s.ui.warmth,
      fontSize: s.ui.fontSize,
      activeWorkspace: activeId,
      limits: s.ui.limits,
      limitsAt: s.ui.limitsAt,
    },
    workspaces: { version: SCHEMA_VERSION, workspaces: workspaces.map((w) => ({ ...w, sessions: byWs(w.id) })) },
    layouts: Object.fromEntries(
      workspaces.map((w) => [
        w.id,
        { version: SCHEMA_VERSION, ...(s.layout.byWorkspace[w.id] ?? emptyLayout()) },
      ]),
    ),
    // Only workspaces that have notes get a notes file.
    notes: Object.fromEntries(
      workspaces.filter((w) => s.notes.byWorkspace[w.id]).map((w) => [w.id, { version: SCHEMA_VERSION, ...s.notes.byWorkspace[w.id] }]),
    ),
  }
}

const SAVE_DELAY = 150
const RETRY_MS = [1000, 3000, 10_000]
let enabled = false
let readonlyMode = false
let timer: ReturnType<typeof setTimeout> | undefined
let failures = 0
const written = new Map<string, string>()

function targets(s: AppState) {
  const out = serialize(s)
  return [
    ['config', out.config],
    ['workspaces', out.workspaces],
    ...Object.entries(out.layouts).map(([id, v]) => [`layout:${id}`, v]),
    ...Object.entries(out.notes).map(([id, v]) => [`notes:${id}`, v]),
  ] as [string, unknown][]
}

async function flush() {
  timer = undefined
  if (readonlyMode) return
  try {
    for (const [target, data] of targets(getState())) {
      const json = JSON.stringify(data)
      if (written.get(target) === json) continue
      await ipc.stateSave(target, data)
      written.set(target, json)
    }
    if (failures) setPersistStatus({ state: 'ok' })
    failures = 0
  } catch (e) {
    const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    setPersistStatus({ state: 'error', message })
    const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]
    failures++
    timer = setTimeout(() => void flush(), delay)
  }
}

function schedule() {
  if (!enabled || readonlyMode) return
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), SAVE_DELAY)
}

/** Call once, after hydrate. Saves only what changed since the files on disk. */
export function startPersistence(dec: Pick<Decoded, 'readonly'>) {
  if (enabled) return
  enabled = true
  readonlyMode = !!dec.readonly
  if (dec.readonly) setPersistStatus({ state: 'readonly', message: dec.readonly })
  for (const [target, data] of targets(getState())) written.set(target, JSON.stringify(data))
  useApp.subscribe(
    (s) => [s.workspace, s.layout, s.notes, s.ui.theme, s.ui.warm, s.ui.warmth, s.ui.warmWhen, s.ui.warmFrom, s.ui.warmTo, s.ui.warmPlace, s.ui.fontSize, s.ui.limits, s.ui.apps] as const,
    schedule,
    { equalityFn: (a, b) => a.every((x, i) => x === b[i]) },
  )
  window.addEventListener('pagehide', () => {
    if (timer) void flush()
  })
}

/** Test hook: the healed state `decode` + `hydrate` would produce. */
export const healed = (dec: Decoded, base: AppState) =>
  produce(base, (d) => {
    d.workspace.workspaces = dec.workspaces
    d.workspace.sessions = dec.sessions
    d.workspace.activeId = dec.activeId
    d.layout.byWorkspace = dec.layouts
    d.notes.byWorkspace = dec.notes
    repair(d)
  })

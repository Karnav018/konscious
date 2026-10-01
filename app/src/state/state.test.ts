import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forksNeeded } from '../lib/restore'
import { DEFAULT_K } from '../lib/warmth'
import type { SessionInfo, SessionMeta } from '../types'
import { act, actionLog, onInvariantViolation } from './act'
import { hidePane, layoutOf, openPane, toggleFocus } from './commands/layout'
import { applyInfo, markStarting } from './commands/runtime'
import { openNewSessionDraft, setPaneMenu, setWarmValue } from './commands/ui'
import { addSession, addWorkspace, removeSession, setActiveWorkspace, updateSession } from './commands/workspace'
import { checkInvariants } from './invariants'
import { decide } from './machine'
import { decode, hydrate, migrate, NewerSchemaError, serialize } from './persistence'
import { byLastUsed } from './selectors'
import { getState, initialState, useApp } from './store'

let violations: string[] = []
onInvariantViolation((_type, v) => violations.push(...v))

beforeEach(() => {
  useApp.setState(initialState(), true)
  violations = []
})

const meta = (id: string, workspaceId: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  workspaceId,
  name: id,
  kind: 'claude',
  cwd: '/p',
  claudeSessionId: '00000000-0000-4000-8000-000000000000',
  wasRunning: true,
  fontSize: null,
  createdAt: 1,
  lastActiveAt: 1,
  ...extra,
})

const info = (id: string, runId: number, status: SessionInfo['status'], running: boolean): SessionInfo => ({
  id, kind: 'claude', runId, status, running, pid: running ? 42 : null, exitCode: null, exitSignal: null,
  hooksActive: true, claudeSessionId: null, cwd: '/p', startedAt: 1, resumeFailed: false, cols: 120, rows: 32,
})

function seed(n = 2) {
  const ws = addWorkspace('/p/hawk')
  for (let i = 0; i < n; i++) addSession(meta(`s${i}`, ws.id))
  return ws.id
}

describe('act — the single write path', () => {
  it('commits frozen immutable state and logs named actions', () => {
    const before = getState()
    const wsId = seed(1)
    const after = getState()
    expect(after).not.toBe(before)
    expect(Object.isFrozen(after.workspace.sessions)).toBe(true)
    expect(() => {
      ;(after.workspace.sessions as Record<string, unknown>).x = 1
    }).toThrow()
    expect(actionLog().slice(-2).map((a) => a.type)).toEqual(['workspace/add', 'session/add'])
    expect(after.layout.byWorkspace[wsId]).toBeDefined()
  })

  it('drops no-op writes: no new state, no log entry', () => {
    seed(1)
    const s = getState()
    const n = actionLog().length
    updateSession('s0', { name: 's0' })
    expect(act('noop', () => {})).toBe(false)
    expect(getState()).toBe(s)
    expect(actionLog().length).toBe(n)
  })

  it('repairs and reports a write that breaks an invariant', () => {
    const wsId = seed(1)
    act('buggy/write', (d) => {
      d.layout.byWorkspace[wsId].open.push('ghost')
      d.layout.byWorkspace[wsId].selected = 'ghost'
    })
    expect(violations.some((v) => v.includes('ghost'))).toBe(true)
    expect(layoutOf(getState().layout.byWorkspace, wsId)).toMatchObject({ open: [], selected: null })
    expect(checkInvariants(getState())).toEqual([])
    expect(actionLog()[actionLog().length - 1]?.repaired?.length).toBeGreaterThan(0)
  })
})

describe('commands', () => {
  it('opens panes with the design cap and LRU eviction', () => {
    const wsId = seed(7)
    for (let i = 0; i < 6; i++) expect(openPane(`s${i}`)).toBeNull()
    openPane('s0') // most recent again
    expect(openPane('s6')).toBe('s1')
    const l = layoutOf(getState().layout.byWorkspace, wsId)
    expect(l.open).toHaveLength(6)
    expect(l.selected).toBe('s6')
    expect(violations).toEqual([])
  })

  it('removing a session cascades through layout, runtime and UI', () => {
    const wsId = seed(2)
    openPane('s0')
    openPane('s1')
    toggleFocus(wsId, 's1')
    applyInfo(info('s1', 1, 'working', true))
    setPaneMenu('s1')
    removeSession('s1')
    const s = getState()
    expect(s.workspace.sessions.s1).toBeUndefined()
    expect(s.runtime.bySession.s1).toBeUndefined()
    expect(s.ui.paneMenu).toBeNull()
    expect(layoutOf(s.layout.byWorkspace, wsId)).toMatchObject({ open: ['s0'], selected: 's0', mode: 'grid' })
    expect(violations).toEqual([])
  })

  it('hiding the focused pane falls back to the grid', () => {
    const wsId = seed(2)
    openPane('s0')
    openPane('s1')
    toggleFocus(wsId, 's1')
    hidePane('s1')
    expect(layoutOf(getState().layout.byWorkspace, wsId)).toMatchObject({ mode: 'grid', open: ['s0'], selected: 's0' })
  })

  it('a new-session draft for a missing workspace is repaired away', () => {
    seed(0)
    openNewSessionDraft({ kind: 'claude', workspaceId: 'nope', name: '', dir: '/' })
    expect(getState().ui.newSession).toBeNull()
    expect(violations.length).toBe(1)
  })
})

describe('workspaces order themselves by use', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const added = (path: string, at: number) => {
    vi.setSystemTime(at)
    return addWorkspace(path)
  }
  const order = () => byLastUsed(getState().workspace.workspaces).map((w) => w.id)

  it('puts the one just used first and the longest-untouched last', () => {
    const a = added('/p/a', 1_000)
    const b = added('/p/b', 2_000)
    const c = added('/p/c', 3_000)
    vi.setSystemTime(4_000)
    setActiveWorkspace(a.id)
    expect(order()).toEqual([a.id, c.id, b.id])
    expect(violations).toEqual([])
  })

  it('counts opening a pane as using that workspace', () => {
    const a = added('/p/a', 1_000)
    const b = added('/p/b', 2_000)
    addSession(meta('s1', a.id))
    vi.setSystemTime(5_000)
    openPane('s1') // activates a without going through setActiveWorkspace
    expect(getState().workspace.activeId).toBe(a.id)
    expect(order()).toEqual([a.id, b.id])
    expect(violations).toEqual([])
  })

  it('leaves equally stale workspaces in the order they were added', () => {
    const a = added('/p/a', 1_000)
    const b = added('/p/b', 1_000)
    expect(order()).toEqual([a.id, b.id])
  })

  it('never reorders the stored list — only what the lists show', () => {
    const a = added('/p/a', 1_000)
    added('/p/b', 2_000)
    vi.setSystemTime(3_000)
    setActiveWorkspace(a.id)
    expect(getState().workspace.workspaces.map((w) => w.id)).toEqual([a.id, 'b'])
  })
})

describe('lifecycle machine', () => {
  it('rejects stale runs and late reports for an exited run', () => {
    seed(1)
    expect(applyInfo(info('s0', 2, 'working', true))).not.toBeNull()
    expect(applyInfo(info('s0', 1, 'idle', true))).toBeNull() // stale run
    expect(applyInfo(info('s0', 2, 'completed', false))).not.toBeNull()
    expect(applyInfo(info('s0', 2, 'working', true))).toBeNull() // after exit
    expect(getState().runtime.bySession.s0.status).toBe('completed')
    expect(applyInfo(info('s0', 3, 'starting', true))).not.toBeNull() // new run
  })

  it('ignores reports for unknown sessions and local "starting" for running ones', () => {
    seed(1)
    expect(applyInfo(info('ghost', 1, 'idle', true))).toBeNull()
    applyInfo(info('s0', 1, 'working', true))
    markStarting('s0')
    expect(getState().runtime.bySession.s0.status).toBe('working')
  })

  it('decide() is pure', () => {
    expect(decide(undefined, info('a', 1, 'idle', true))).toEqual({ accept: true })
  })
})

describe('persistence', () => {
  it('serialize → decode → hydrate round-trips the state', () => {
    const wsId = seed(3)
    openPane('s0')
    openPane('s2')
    toggleFocus(wsId, 's2')
    const files = serialize()
    const snap = { config: files.config, workspaces: files.workspaces, layouts: files.layouts, corrupt: [], restored: [] }
    const before = getState()
    useApp.setState(initialState(), true)
    hydrate(decode(snap))
    const after = getState()
    expect(after.workspace).toEqual(before.workspace)
    expect(after.layout).toEqual(before.layout)
    expect(violations).toEqual([])
  })

  it('round-trips the warm-colours setting, and defaults it for older configs', () => {
    seed(1)
    setWarmValue(true, 2800)
    const files = serialize()
    expect(files.config).toMatchObject({ warm: true, warmth: 2800 })
    useApp.setState(initialState(), true)
    hydrate(decode({ config: files.config, workspaces: files.workspaces, layouts: files.layouts, corrupt: [], restored: [] }))
    expect(getState().ui).toMatchObject({ warm: true, warmth: 2800 })

    // A config written before warmth existed loads with it switched off.
    const old = decode({ config: { version: 2, theme: 'dark' }, workspaces: null, layouts: {}, corrupt: [], restored: [] })
    expect(old.warm).toBe(false)
    expect(old.warmth).toBe(DEFAULT_K)
    // So does a nonsense temperature.
    const bad = decode({ config: { version: 2, theme: 'dark', warmth: 99 }, workspaces: null, layouts: {}, corrupt: [], restored: [] })
    expect(bad.warmth).toBe(DEFAULT_K)
    expect(violations).toEqual([])
  })

  it('drops invalid entries, counts them, and heals dangling references', () => {
    const dec = decode({
      config: { version: 2, theme: 'light', activeWorkspace: 'missing' },
      workspaces: {
        version: 2,
        workspaces: [
          { id: '../evil', path: '/x' },
          {
            id: 'ok', path: '/ok',
            sessions: [{ id: 'good', cwd: '/ok', kind: 'shell', claudeSessionId: 'bogus' }, { id: 'no-cwd' }, 'junk'],
          },
        ],
      },
      layouts: { ok: { version: 2, mode: 'focus', open: ['good', 'ghost'], recent: [], selected: 'ghost' } },
      corrupt: [],
      restored: [],
    })
    expect(dec.skipped).toBe(3)
    hydrate(dec)
    const s = getState()
    expect(s.workspace.activeId).toBe('ok')
    expect(s.workspace.sessions.good).toMatchObject({ kind: 'shell', claudeSessionId: null, name: 'Untitled' })
    expect(layoutOf(s.layout.byWorkspace, 'ok')).toMatchObject({ open: ['good'], selected: 'good', mode: 'focus' })
    expect(s.ui.theme).toBe('light')
    expect(checkInvariants(s)).toEqual([])
  })

  it('migrates stepwise and refuses data from a newer schema', () => {
    const table = { 0: (r: Record<string, unknown>) => ({ ...r, renamed: r.old }) }
    expect(migrate('config', { old: 1 }, table, 1)).toEqual({ old: 1, renamed: 1, version: 1 })
    expect(() => migrate('config', { version: 0 }, {}, 1)).toThrow(/no migration/)
    expect(() => migrate('config', { version: 9 })).toThrow(NewerSchemaError)
  })

  it('newer-version files load read-only instead of being overwritten', () => {
    const dec = decode({
      config: { version: 3, theme: 'dark', activeWorkspace: null },
      workspaces: { version: 2, workspaces: [] },
      layouts: {},
      corrupt: [],
      restored: [],
    })
    expect(dec.readonly).toMatch(/newer/)
  })
})

describe('last known plan usage', () => {
  it('survives a restart, restored as not-live', () => {
    seed(1)
    act('test/limits', (d) => {
      d.ui.limits = { fiveHour: { pct: 11, resetsAt: 1 }, sevenDay: null }
      d.ui.limitsAt = 123
      d.ui.limitsLive = true
    })
    const files = serialize()
    useApp.setState(initialState(), true)
    hydrate(decode({ config: files.config, workspaces: files.workspaces, layouts: files.layouts, corrupt: [], restored: [] }))
    expect(getState().ui).toMatchObject({ limits: { fiveHour: { pct: 11, resetsAt: 1 }, sevenDay: null }, limitsAt: 123, limitsLive: false })
  })
})

describe('schema v1 → v2 migration', () => {
  it('upgrades v1 files: old default font moves to 12, sessions gain fontSize null', () => {
    const dec = decode({
      config: { version: 1, theme: 'dark', fontSize: 12.5, activeWorkspace: 'w' },
      workspaces: {
        version: 1,
        workspaces: [{ id: 'w', path: '/w', sessions: [{ id: 's1', cwd: '/w', kind: 'claude', name: 'A' }] }],
      },
      layouts: { w: { version: 1, mode: 'grid', open: ['s1'], recent: ['s1'], selected: 's1' } },
      corrupt: [],
      restored: [],
    })
    expect(dec.skipped).toBe(0)
    expect(dec.readonly).toBeNull()
    expect(dec.fontSize).toBe(12)
    expect(dec.sessions.s1.fontSize).toBeNull()
    expect(dec.layouts.w.open).toEqual(['s1'])
  })

  it('keeps a font size the user chose', () => {
    const dec = decode({ config: { version: 1, theme: 'dark', fontSize: 15, activeWorkspace: null }, workspaces: null, layouts: {}, corrupt: [], restored: [] })
    expect(dec.fontSize).toBe(15)
  })
})

describe('restore planning', () => {
  it('keeps the most recent pane on a shared conversation and forks the rest', () => {
    const s = (id: string, conv: string | null, last: number, kind: 'claude' | 'shell' = 'claude') =>
      meta(id, 'w', { claudeSessionId: conv, lastActiveAt: last, kind })
    const forks = forksNeeded([s('a', 'c1', 10), s('b', 'c1', 30), s('c', 'c1', 20), s('d', 'c2', 5), s('e', null, 1, 'shell')])
    expect([...forks].sort()).toEqual(['a', 'c'])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// No terminal engine or Tauri: just what the tools ask of them.
vi.mock('../lib/terminals', () => ({
  terminals: {
    ensure: vi.fn(),
    fit: vi.fn(),
    size: vi.fn(() => ({ cols: 80, rows: 24 })),
    channel: vi.fn(),
    started: vi.fn(),
    focus: vi.fn(),
    setAppearance: vi.fn(),
  },
  setStartHook: vi.fn(),
  requestStart: vi.fn(),
}))
vi.mock('../lib/ipc', () => ({
  ipc: {
    agentReply: vi.fn(async () => {}),
    fsIsDir: vi.fn(async () => true),
    sessionStart: vi.fn(),
    sessionStop: vi.fn(async () => {}),
    gitInfo: vi.fn(async () => null),
    notify: vi.fn(),
    mediaNow: vi.fn(async () => ({ now: null, denied: false, failed: false })),
    mediaControl: vi.fn(async () => true),
  },
  errorMessage: (e: unknown) => String(e),
}))

import { ipc, type AgentCall } from '../lib/ipc'
import { addSession, addWorkspace } from '../state/commands/workspace'
import { getState, initialState, useApp } from '../state/store'
import type { SessionInfo, SessionMeta } from '../types'
import { answerAgentAsk, handleAgentCall, OPEN_LIMIT, recentOpens, resolveFolder } from './agent'

let wsId = ''
let calls = 0

const meta = (id: string, name: string): SessionMeta =>
  ({ id, workspaceId: wsId, kind: 'claude', name, cwd: '/p/backend', claudeSessionId: null, wasRunning: true, fontSize: null, createdAt: 1, lastActiveAt: 1 }) as SessionMeta

const call = (sessionId: string, tool: string, args: Record<string, unknown> = {}): AgentCall => ({ callId: ++calls, sessionId, tool, args })

/** The text and ok flag the tool sent back to Claude. */
const lastReply = () => {
  const all = vi.mocked(ipc.agentReply).mock.calls
  const c = all[all.length - 1]
  return { ok: c[1], text: c[2] }
}

/** Runs a tool that asks the person, and answers for them. */
async function asked(c: AgentCall, open: boolean) {
  const done = handleAgentCall(c)
  await vi.waitFor(() => expect(getState().ui.agentAsk?.callId).toBe(c.callId))
  const ask = getState().ui.agentAsk!
  answerAgentAsk(open)
  await done
  return ask
}

beforeEach(() => {
  useApp.setState(initialState(), true)
  vi.clearAllMocks()
  vi.mocked(ipc.sessionStart).mockImplementation(
    async (spec) =>
      ({ id: spec.id, kind: spec.kind, runId: 1, status: 'starting', running: true, pid: 1, exitCode: null, exitSignal: null, hooksActive: false, claudeSessionId: null, cwd: spec.cwd, startedAt: 1, cols: 80, rows: 24, resumeFailed: false }) as unknown as SessionInfo,
  )
  wsId = addWorkspace('/p').id
})

describe('folders', () => {
  it('resolves absolute, relative and Windows paths', () => {
    expect(resolveFolder('', '/p/backend', false)).toBe('/p/backend')
    expect(resolveFolder('/srv/app', '/p/backend', false)).toBe('/srv/app')
    expect(resolveFolder('./api/v2', '/p/backend', false)).toBe('/p/backend/api/v2')
    expect(resolveFolder('D:\\work', 'C:\\p', true)).toBe('D:\\work')
    expect(resolveFolder('api', 'C:\\p', true)).toBe('C:\\p\\api')
  })

  it('forgets opens older than the window', () => {
    expect(recentOpens([0, 50, 99], 100, 60)).toEqual([50, 99])
  })
})

describe('list_sessions', () => {
  it('names every session in the workspace and marks the caller', async () => {
    addSession(meta('s1', 'Backend'))
    addSession(meta('s2', 'Reviewer'))
    useApp.setState((s) => ({ runtime: { bySession: { ...s.runtime.bySession, s2: { status: 'waiting' } as never } } }))
    await handleAgentCall(call('s1', 'list_sessions'))
    const r = lastReply()
    expect(r.ok).toBe(true)
    expect(r.text).toContain('Backend (you): Claude, stopped')
    expect(r.text).toContain('Reviewer: Claude, waiting for the person')
  })

  it('refuses a caller Konscious no longer knows', async () => {
    await handleAgentCall(call('gone', 'list_sessions'))
    expect(lastReply().ok).toBe(false)
  })
})

describe('new_session', () => {
  it('opens nothing when the person says no', async () => {
    addSession(meta('s1', 'Backend'))
    await asked(call('s1', 'new_session', { task: 'run the auth tests' }), false)
    expect(lastReply().text).toContain('chose not to open')
    expect(Object.keys(getState().workspace.sessions)).toEqual(['s1'])
    expect(ipc.sessionStart).not.toHaveBeenCalled()
  })

  it('names the session from its task and hands it the task', async () => {
    addSession(meta('s1', 'Backend'))
    const ask = await asked(call('s1', 'new_session', { task: 'run the auth tests', folder: '.' }), true)
    expect(ask).toMatchObject({ from: 'Backend', asks: 'wants to open a session', avatar: 'Auth Tests', confirm: 'Open session' })
    expect(ask.rows).toContainEqual({ label: 'Folder', value: '/p/backend', mono: true })
    expect(ask.rows).toContainEqual({ label: 'Task', value: 'run the auth tests', long: true })
    const spec = vi.mocked(ipc.sessionStart).mock.calls[0][0]
    expect(spec.name).toBe('Auth Tests')
    expect(spec.prompt).toBe('run the auth tests')
    expect(lastReply()).toMatchObject({ ok: true })
    expect(lastReply().text).toContain('Opened “Auth Tests”')
  })

  it('a session a tool opened can’t open more', async () => {
    addSession(meta('s3', 'Lead'))
    await asked(call('s3', 'new_session', { task: 'write the migration' }), true)
    const child = Object.values(getState().workspace.sessions).find((m) => m.id !== 's3')!
    await handleAgentCall(call(child.id, 'new_session', { task: 'anything' }))
    expect(lastReply().ok).toBe(false)
    expect(getState().ui.agentAsk).toBeNull()
  })

  it(`stops after ${OPEN_LIMIT} opens in a short while`, async () => {
    addSession(meta('s4', 'Busy'))
    for (let i = 0; i < OPEN_LIMIT; i++) await asked(call('s4', 'new_session', { kind: 'terminal' }), true)
    await handleAgentCall(call('s4', 'new_session', { kind: 'terminal' }))
    expect(lastReply().ok).toBe(false)
    expect(lastReply().text).toContain('in the last 10 minutes')
    const names = Object.values(getState().workspace.sessions).map((m) => m.name)
    expect(names).toEqual(['Busy', 'Terminal', 'Terminal 2', 'Terminal 3'])
  })

  it('refuses a folder that isn’t there', async () => {
    addSession(meta('s5', 'Backend'))
    vi.mocked(ipc.fsIsDir).mockResolvedValueOnce(false)
    await handleAgentCall(call('s5', 'new_session', { folder: '/nope' }))
    expect(lastReply()).toMatchObject({ ok: false, text: 'There is no folder at /nope.' })
  })
})

describe('arrange', () => {
  it('rejects values it doesn’t know, and names it can’t find', async () => {
    addSession(meta('s1', 'Backend'))
    useApp.setState((s) => ({ workspace: { ...s.workspace, activeId: wsId } }))
    await handleAgentCall(call('s1', 'arrange', { view: 'sideways' }))
    expect(lastReply().ok).toBe(false)
    await handleAgentCall(call('s1', 'arrange', { focus: 'Nobody' }))
    expect(lastReply().text).toContain('No session called')
    await handleAgentCall(call('s1', 'arrange', {}))
    expect(lastReply().ok).toBe(false)
  })
})

const running = (...ids: string[]) =>
  useApp.setState((s) => ({
    runtime: { bySession: { ...s.runtime.bySession, ...Object.fromEntries(ids.map((id) => [id, { status: 'working', running: true }])) } as never },
  }))

describe('manage_session', () => {
  it('renames a session by name, keeping names unique', async () => {
    addSession(meta('s1', 'Backend'))
    addSession(meta('s2', 'Reviewer'))
    await handleAgentCall(call('s1', 'manage_session', { session: 'review', action: 'rename', name: 'Backend' }))
    expect(lastReply().text).toBe('Renamed “Reviewer” to “Backend 2”.')
    expect(getState().workspace.sessions.s2.name).toBe('Backend 2')
  })

  it('stops another session only when the person allows it, and never itself', async () => {
    addSession(meta('s1', 'Backend'))
    addSession(meta('s2', 'Reviewer'))
    running('s1', 's2')
    await handleAgentCall(call('s1', 'manage_session', { session: 'Backend', action: 'stop' }))
    expect(lastReply().ok).toBe(false)
    const ask = await asked(call('s1', 'manage_session', { session: 'Reviewer', action: 'stop' }), true)
    expect(ask.confirm).toBe('Stop session')
    expect(ipc.sessionStop).toHaveBeenCalledWith('s2')
  })
})

describe('workspaces', () => {
  it('lists them and won’t stop the caller’s own', async () => {
    addSession(meta('s1', 'Backend'))
    await handleAgentCall(call('s1', 'workspaces', { action: 'list' }))
    expect(lastReply().text).toContain('(yours')
    await handleAgentCall(call('s1', 'workspaces', { action: 'stop_all', workspace: 'p' }))
    expect(lastReply()).toMatchObject({ ok: false })
    expect(lastReply().text).toContain('stop you too')
  })
})

describe('notes', () => {
  it('adds, ticks off and links tasks, and appends to the scratch pad', async () => {
    addSession(meta('s1', 'Backend'))
    addSession(meta('s2', 'Reviewer'))
    await handleAgentCall(call('s1', 'notes', { action: 'add', text: 'Rotate refresh tokens' }))
    await handleAgentCall(call('s1', 'notes', { action: 'add', text: 'Review the rotation' }))
    expect(lastReply().text).toBe('Added as task 1: Review the rotation')
    await handleAgentCall(call('s1', 'notes', { action: 'done', task: 2 }))
    await handleAgentCall(call('s1', 'notes', { action: 'link', task: 1, session: 'Reviewer' }))
    await handleAgentCall(call('s1', 'notes', { action: 'append', text: 'Tokens expire after 30 days' }))
    await handleAgentCall(call('s1', 'notes', { action: 'list' }))
    const text = lastReply().text
    expect(text).toContain('1. [ ] Review the rotation (→ Reviewer)')
    expect(text).toContain('2. [x] Rotate refresh tokens')
    expect(text).toContain('Tokens expire after 30 days')
    await handleAgentCall(call('s1', 'notes', { action: 'done', task: 9 }))
    expect(lastReply().ok).toBe(false)
  })
})

describe('dock apps', () => {
  it('switches apps on, moves the dock and runs the pomodoro', async () => {
    addSession(meta('s1', 'Backend'))
    await handleAgentCall(call('s1', 'dock', { action: 'on', app: 'Caffeine' }))
    expect(getState().ui.apps.on.caff).toBe(true)
    await handleAgentCall(call('s1', 'dock', { action: 'move', edge: 'left' }))
    expect(getState().ui.apps.edge).toBe('left')
    await handleAgentCall(call('s1', 'dock', { action: 'on', app: 'jukebox' }))
    expect(lastReply().ok).toBe(false)

    await handleAgentCall(call('s1', 'pomodoro', { action: 'start', focus_minutes: 50 }))
    expect(getState().ui.apps.pomo.phase).toBe('focus')
    expect(getState().ui.apps.pomoSet.focusMin).toBe(50)
    expect(lastReply().text).toContain('Focus 50 min')

    await handleAgentCall(call('s1', 'caffeine', { action: 'log', drink: 'espresso', size: 'm' }))
    expect(lastReply().text).toContain('Logged a medium espresso (63 mg)')
    expect(getState().ui.apps.caff.log).toHaveLength(1)

    await handleAgentCall(call('s1', 'reminders', { reminder: 'water', action: 'every', minutes: 45 }))
    expect(getState().ui.apps.every.water).toBe(45)
  })
})

describe('notify', () => {
  it('shows a message, at most one every 10 seconds per session', async () => {
    addSession(meta('s1', 'Backend'))
    await handleAgentCall(call('s1', 'notify', { title: 'Auth tests passed' }))
    expect(getState().ui.toast).toBe('Backend: Auth tests passed')
    await handleAgentCall(call('s1', 'notify', { title: 'Again' }))
    expect(lastReply().ok).toBe(false)
  })
})

describe('settings', () => {
  it('reports without asking, and asks before changing', async () => {
    addSession(meta('s1', 'Backend'))
    await handleAgentCall(call('s1', 'settings', {}))
    expect(lastReply().text).toContain('Nothing to change')
    const ask = await asked(call('s1', 'settings', { terminal_size: 15 }), true)
    expect(ask.rows).toEqual([{ label: 'Text', value: `${initialState().ui.fontSize}px → 15px` }])
    expect(getState().ui.fontSize).toBe(15)
  })

  it('rejects a theme it doesn’t have', async () => {
    addSession(meta('s1', 'Backend'))
    await handleAgentCall(call('s1', 'settings', { theme: 'neon' }))
    expect(lastReply().ok).toBe(false)
  })
})

it('an unknown tool is an error, not a crash', async () => {
  addSession(meta('s1', 'Backend'))
  await handleAgentCall(call('s1', 'toString'))
  expect(lastReply()).toMatchObject({ ok: false })
})

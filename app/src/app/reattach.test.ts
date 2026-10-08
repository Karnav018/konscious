import { beforeEach, describe, expect, it, vi } from 'vitest'

// No terminal engine or Tauri: just what reattaching asks of them.
vi.mock('../lib/terminals', () => ({
  terminals: {
    has: vi.fn(() => false),
    clear: vi.fn(),
    ensure: vi.fn(),
    hold: vi.fn(),
    channel: vi.fn(),
    whenWritten: vi.fn(async () => {}),
    release: vi.fn(),
    started: vi.fn(),
    nudge: vi.fn(),
  },
  setStartHook: vi.fn(),
  requestStart: vi.fn(),
}))
vi.mock('../lib/ipc', () => ({
  ipc: { sessionAttach: vi.fn() },
  errorMessage: (e: unknown) => String(e),
}))

import { ipc } from '../lib/ipc'
import { terminals } from '../lib/terminals'
import { addSession, addWorkspace } from '../state/commands/workspace'
import { initialState, useApp } from '../state/store'
import type { SessionInfo, SessionMeta } from '../types'
import { reattachSession } from './actions'

const info = (running: boolean) =>
  ({ id: 's1', kind: 'shell', runId: 1, status: 'idle', running, pid: 1, exitCode: null, exitSignal: null, hooksActive: false, claudeSessionId: null, cwd: '/p', startedAt: 1, cols: 80, rows: 24, replayBytes: 0 }) as unknown as SessionInfo

beforeEach(() => {
  useApp.setState(initialState(), true)
  vi.clearAllMocks()
  const ws = addWorkspace('/p')
  addSession({ id: 's1', workspaceId: ws.id, kind: 'shell', name: 'zsh', cwd: '/p', claudeSessionId: null, wasRunning: true, fontSize: null, createdAt: 1, lastActiveAt: 1 } as SessionMeta)
})

describe('after the page reloads', () => {
  it('a session that is still running takes typing again', async () => {
    vi.mocked(ipc.sessionAttach).mockResolvedValue(info(true) as never)
    await reattachSession(info(true))
    expect(terminals.started).toHaveBeenCalledWith('s1', null)
  })

  it('a session that has ended waits to be started, as before', async () => {
    vi.mocked(ipc.sessionAttach).mockResolvedValue(info(false) as never)
    await reattachSession(info(false))
    expect(terminals.started).not.toHaveBeenCalled()
  })
})

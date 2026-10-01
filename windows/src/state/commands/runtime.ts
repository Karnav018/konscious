// Runtime (process) state. Rust reports are filtered by the lifecycle
// machine before they touch the store.
import type { ContextUsage, GitInfo, Runtime, SessionInfo } from '../../types'
import { act } from '../act'
import { decide } from '../machine'
import { getState } from '../store'

export const idleRuntime = (): Runtime => ({
  status: 'stopped',
  runId: 0,
  running: false,
  pid: null,
  exitCode: null,
  hooksActive: false,
  startedAt: null,
  lastActivityAt: null,
  unread: false,
  resumeFailed: false,
  git: null,
  context: null,
})

const IDLE = idleRuntime()
export const runtimeOf = (bySession: Record<string, Runtime>, id: string | null | undefined): Runtime =>
  (id && bySession[id]) || IDLE

/** Returns the previous runtime when the report was accepted, `null` when rejected. */
export function applyInfo(info: SessionInfo): { prev: Runtime | undefined } | null {
  const s = getState()
  if (!s.workspace.sessions[info.id]) return null
  const prev = s.runtime.bySession[info.id]
  if (!decide(prev, info).accept) return null
  act(`runtime/report:${info.status}`, (d) => {
    const base = d.runtime.bySession[info.id] ?? idleRuntime()
    d.runtime.bySession[info.id] = {
      ...base,
      status: info.status,
      runId: info.runId,
      running: info.running,
      pid: info.pid,
      exitCode: info.exitCode,
      hooksActive: info.hooksActive,
      startedAt: info.startedAt,
      resumeFailed: info.resumeFailed,
      lastActivityAt: base.status !== info.status ? Date.now() : base.lastActivityAt,
    }
  })
  return { prev }
}

function patch(type: string, id: string, fn: (r: Runtime) => Partial<Runtime> | null) {
  const s = getState()
  if (!s.workspace.sessions[id]) return
  const cur = s.runtime.bySession[id] ?? IDLE
  const p = fn(cur)
  if (!p || (Object.keys(p) as (keyof Runtime)[]).every((k) => cur[k] === p[k])) return
  act(type, (d) => {
    d.runtime.bySession[id] = { ...(d.runtime.bySession[id] ?? idleRuntime()), ...p }
  })
}

/** Local transition while waiting for Rust; only from a non-running state. */
export const markStarting = (id: string) =>
  patch('runtime/starting', id, (r) => (r.running ? null : { status: 'starting', resumeFailed: false }))

export const markSpawnFailed = (id: string) =>
  patch('runtime/spawnFailed', id, () => ({ status: 'failed', running: false }))

export const setUnread = (id: string, unread: boolean) => patch('runtime/unread', id, () => ({ unread }))

export const setContext = (usage: ContextUsage) =>
  patch('runtime/context', usage.id, (r) =>
    r.context?.pct === usage.pct && r.context?.used === usage.used && r.context?.size === usage.size ? null : { context: usage },
  )

export const setGit = (id: string, git: GitInfo | null) =>
  patch('runtime/git', id, (r) => (r.git?.branch === git?.branch && r.git?.commit === git?.commit ? null : { git }))

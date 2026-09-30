// Session lifecycle rules. Rust is the authority on process state; this
// decides which of its reports (and which local UI transitions) may apply.
//
//   stopped ──start──► starting ──► idle ⇄ working ⇄ waiting
//      ▲                                  │
//      └──────── resume / restart ◄── completed | failed   (final per run)
//
// Reports arrive over two paths (events and command results), so they can
// arrive out of order. Each run has a monotonic runId: older runs are stale,
// and once a run has exited, a late "running" report for it is ignored.
import type { Runtime, SessionInfo, Status } from '../types'

export const FINAL: ReadonlySet<Status> = new Set<Status>(['completed', 'failed'])

export type Decision = { accept: true } | { accept: false; reason: 'stale-run' | 'after-exit' }

export function decide(prev: Runtime | undefined, info: SessionInfo): Decision {
  if (!prev || prev.runId === 0) return { accept: true }
  if (info.runId < prev.runId) return { accept: false, reason: 'stale-run' }
  if (info.runId === prev.runId && !prev.running && FINAL.has(prev.status) && info.running) {
    return { accept: false, reason: 'after-exit' }
  }
  return { accept: true }
}

/** Resume/Start is offered only when nothing is running. */
export const canStart = (r: Runtime | undefined) => !r || !r.running

export const isEnded = (s: Status) => s === 'stopped' || FINAL.has(s)

// The one write path. Every state change is a named action:
//
//   act('layout/openPane', draft => { ... })
//     → immer produces the next immutable (frozen) state
//     → no-op changes are dropped (no re-render, no save, no log noise)
//     → invariants are checked; violations are repaired and reported
//     → committed, then recorded in a bounded action log for diagnostics
import { type Draft, produce } from 'immer'

import { checkInvariants, repair } from './invariants'
import { type AppState, useApp } from './store'

export interface ActionRecord {
  seq: number
  at: number
  type: string
  /** Time spent producing + validating, in ms. */
  ms: number
  repaired?: string[]
}

const LOG_CAP = 300
const log: ActionRecord[] = []
let seq = 0

type Reporter = (type: string, violations: string[]) => void
let report: Reporter = (type, violations) => console.error(`[state] "${type}" broke invariants — repaired:`, violations)

/** Tests capture violations instead of logging them. */
export function onInvariantViolation(fn: Reporter) {
  report = fn
}

export function act(type: string, recipe: (draft: Draft<AppState>) => void): boolean {
  const t0 = performance.now()
  const prev = useApp.getState()
  let next = produce(prev, recipe)
  if (next === prev) return false
  const violations = checkInvariants(next)
  if (violations.length) {
    next = produce(next, repair)
    report(type, violations)
  }
  useApp.setState(next, true)
  log.push({
    seq: ++seq,
    at: Date.now(),
    type,
    ms: Math.round((performance.now() - t0) * 100) / 100,
    ...(violations.length ? { repaired: violations } : {}),
  })
  if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
  return true
}

/** Most recent actions, oldest first. */
export const actionLog = (): readonly ActionRecord[] => log

/** Snapshot for bug reports: recent actions + state shape (no terminal output). */
export function diagnostics() {
  const s = useApp.getState()
  return {
    actions: log.slice(-100),
    counts: {
      workspaces: s.workspace.workspaces.length,
      sessions: Object.keys(s.workspace.sessions).length,
      running: Object.values(s.runtime.bySession).filter((r) => r.running).length,
    },
    persist: s.ui.persist,
    violations: checkInvariants(s),
  }
}

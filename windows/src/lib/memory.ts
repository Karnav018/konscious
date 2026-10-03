// What each session costs in memory, polled from the engine while something
// is on screen to show it.
//
// Owned here rather than in the store, like the terminals in lib/terminals.ts:
// the figure changes every few seconds, is never persisted, and routing it
// through `act()` would fill the action log and wake the save queue with noise
// no one reads. Polling runs only while a component is subscribed.
//
// The number is resident bytes for the session's whole process tree, because
// Claude spawns subagents and MCP servers of its own (see src-tauri/memory.rs).
import { useSyncExternalStore } from 'react'

import { ipc } from './ipc'
import type { Runtime, SessionMemory } from '../types'

/** Slow enough to cost nothing, quick enough to watch a session grow. */
export const POLL_MS = 4000

/** A session idle at least this long, holding at least this much, is worth
 *  offering to restart: Claude Code grows over a long session, and a restart
 *  resumes the same conversation. */
export const STALE_MS = 20 * 60 * 1000
export const HEAVY_BYTES = 100 * 1024 * 1024

type Snapshot = Readonly<Record<string, SessionMemory>>

const EMPTY: Snapshot = Object.freeze({})
let snapshot: Snapshot = EMPTY
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

async function poll() {
  try {
    const rows = await ipc.sessionMemory()
    const next: Record<string, SessionMemory> = {}
    for (const row of rows) next[row.id] = row
    snapshot = Object.freeze(next)
    for (const l of listeners) l()
  } catch {
    /* a session ended mid-measure, or the engine is busy: keep the last figures */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    void poll()
    timer = setInterval(() => void poll(), POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/** Live memory per session. Subscribing starts the polling; the last
 *  component to unsubscribe stops it. */
export const useSessionMemory = (): Snapshot =>
  useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)

/* ── pure helpers ─────────────────────────────────────────────────── */

/** "512 MB", "1.4 GB" — two significant figures past a gigabyte. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return '<1 MB'
  if (mb < 1024) return `${Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** Resident bytes across `ids`; sessions with no figure yet count as zero. */
export function totalOf(memory: Snapshot, ids: readonly string[]): number {
  return ids.reduce((sum, id) => sum + (memory[id]?.bytes ?? 0), 0)
}

/** True when restarting would plainly reclaim memory: running, idle a good
 *  while, and holding a lot. Never for a session still working — the point is
 *  to offer, not to interrupt. */
export function worthRestarting(
  memory: SessionMemory | undefined,
  rt: Pick<Runtime, 'running' | 'status' | 'lastActivityAt'>,
  now = Date.now(),
): boolean {
  if (!memory || !rt.running || rt.status !== 'idle') return false
  if (memory.bytes < HEAVY_BYTES) return false
  return rt.lastActivityAt !== null && now - rt.lastActivityAt >= STALE_MS
}

// This machine's figures for the dock gauge, polled while the gauge is on
// screen. Owned here rather than in the store, like lib/memory.ts: they change
// every few seconds, are never saved, and would otherwise fill the action log.
import { useSyncExternalStore } from 'react'

import { ipc } from './ipc'
import type { Stats } from '../types'

/** The gauge cycles every 5s, so reading a little faster keeps it honest. */
export const POLL_MS = 4000

const listeners = new Set<() => void>()
let snapshot: Stats | null = null
let timer: ReturnType<typeof setInterval> | undefined
let reading = false

async function poll() {
  if (reading) return // a read samples the CPU over an interval; never overlap
  reading = true
  try {
    snapshot = await ipc.systemStats()
    for (const l of listeners) l()
  } catch {
    /* keep the last figures */
  } finally {
    reading = false
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

/** Live figures, or null until the first read lands. Subscribing starts the
 *  polling; the last component to unsubscribe stops it. */
export const useStats = (): Stats | null =>
  useSyncExternalStore(subscribe, () => snapshot, () => null)

/* ── pure ─────────────────────────────────────────────────────────── */

/** "6.2 of 10 cores busy", "10.1 of 32 GB in use" — the line under a stat. */
export function statDetail(key: 'cpu' | 'ram' | 'ssd' | 'tmp', s: Stats): string {
  const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1)
  if (key === 'cpu') return `${((s.cpu / 100) * s.cores).toFixed(1)} of ${s.cores} cores busy`
  if (key === 'ram') return `${gb(s.ramUsed)} of ${gb(s.ramTotal)} GB in use`
  if (key === 'ssd') return `${gb(s.ssdUsed)} of ${gb(s.ssdTotal)} GB used`
  if (s.tmp === null) return 'this machine does not report it'
  return `CPU package · fans ${s.tmp > 75 ? 'audible' : s.tmp > 60 ? 'low' : 'off'}`
}

/** The reading for a stat, or null when there is nothing to show. */
export const statValue = (key: 'cpu' | 'ram' | 'ssd' | 'tmp', s: Stats): number | null =>
  key === 'tmp' ? s.tmp : s[key]

/** Which stat the gauge shows: it cycles, but holds still while a session is
 *  waiting for you, and holds on one stat if you picked one. Stats the machine
 *  will not report are skipped rather than shown empty. */
export function shownMetric(
  available: readonly ('cpu' | 'ram' | 'ssd' | 'tmp')[],
  tick: number,
  pinned: 'cpu' | 'ram' | 'ssd' | 'tmp' | null,
): 'cpu' | 'ram' | 'ssd' | 'tmp' | null {
  if (pinned && available.includes(pinned)) return pinned
  if (!available.length) return null
  return available[((tick % available.length) + available.length) % available.length]
}

/** The stats this machine will actually report. */
export const availableMetrics = (s: Stats | null): ('cpu' | 'ram' | 'ssd' | 'tmp')[] =>
  s === null ? [] : (['cpu', 'ram', 'ssd', 'tmp'] as const).filter((k) => statValue(k, s) !== null)

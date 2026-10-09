// What is playing. Polled while something is watching, like lib/stats.ts, and
// owned here rather than in the store for the same reason: a position that
// moves every two seconds would fill the action log with nothing.
//
// The island shows this as a live activity, which puts one constraint on the
// shape: the moment it carries has to be when playback STARTED, not when we
// last looked. A timestamp that moved every poll would always be the newest
// activity and would starve every alert behind it — the same trap the
// pomodoro handover fell into.
import { useCallback, useSyncExternalStore } from 'react'

import { ipc } from './ipc'
import type { MediaState, NowPlaying } from '../types'

/** Often enough that the progress bar does not visibly lag. */
export const PLAYING_MS = 2000
/** Rarely enough to cost nothing while the music is paused or absent. */
export const IDLE_MS = 6000

/** The exact pane of System Settings that governs this. Opened from the two
 *  places that can report a refusal, so the user is not left hunting. */
export const AUTOMATION_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'

/** Five bars, because that reads as a spectrum and still fits beside a title
 *  in a 220px pill. */
export const BARS = 5

export interface Snapshot {
  now: NowPlaying | null
  /** When playback last started, for the island's ranking. */
  since: number | null
  /** macOS refused Automation. Polling stops; the catalog offers the fix. */
  denied: boolean
  /** Reading failed in a way that is our bug. Polling stops and the catalog
   *  says so, rather than showing the same blank as "nothing is playing". */
  failed: boolean
}

export const EMPTY: Snapshot = { now: null, since: null, denied: false, failed: false }

/* ── pure ─────────────────────────────────────────────────────────── */

/** Whether two readings are the same track, so a continuing song is not
 *  mistaken for a new one. */
export const sameTrack = (a: NowPlaying | null, b: NowPlaying | null): boolean =>
  !!a && !!b && a.app === b.app && a.title === b.title && a.artist === b.artist

/**
 * When the current run of playback began.
 *
 * The same track still playing keeps the moment it started. A different
 * track, or a resume after a pause, is a new start. Nothing playing has no
 * start at all.
 */
export function startedAt(prev: Snapshot, next: NowPlaying | null, at: number): number | null {
  if (!next?.playing) return null
  const continuing = prev.since !== null && !!prev.now?.playing && sameTrack(prev.now, next)
  return continuing ? prev.since : at
}

/** How long until the next read. */
export const pollAfter = (s: Snapshot): number => (s.now?.playing ? PLAYING_MS : IDLE_MS)

/** How far through the track, 0–1. Zero when the player will not say. */
export function progress(now: NowPlaying | null): number {
  if (!now || now.durationMs <= 0) return 0
  return Math.max(0, Math.min(1, now.positionMs / now.durationMs))
}

/** "Title — Artist", or just the title when the artist is unknown. */
export const trackLabel = (now: NowPlaying): string =>
  now.artist.trim() ? `${now.title} — ${now.artist}` : now.title

/** A title long enough to need scrolling rather than an ellipsis. */
export const needsMarquee = (label: string, room = 26): boolean => label.length > room

/**
 * Each bar's animation, staggered so they never move as one block. Durations
 * run 0.9s to 1.4s and the delays are deliberately not multiples of each
 * other, which is what stops the row looking like a wave.
 */
export const barTiming = (i: number): { durationMs: number; delayMs: number } => ({
  durationMs: 900 + ((i * 127) % 500),
  delayMs: (i * 170) % 600,
})

/* ── the poller ───────────────────────────────────────────────────── */

const listeners = new Set<() => void>()
let snapshot: Snapshot = EMPTY
let timer: ReturnType<typeof setTimeout> | undefined
let reading = false

function announce() {
  for (const l of listeners) l()
}

async function poll() {
  if (reading) return
  reading = true
  try {
    const got: MediaState = await ipc.mediaNow()
    const at = Date.now()
    snapshot = { now: got.now, since: startedAt(snapshot, got.now, at), denied: got.denied, failed: got.failed }
    announce()
  } catch {
    /* keep the last reading rather than blink the island off */
  } finally {
    reading = false
  }
  // Neither a refusal nor a broken script relents on its own: macOS will not
  // ask twice, and a script that does not compile will not start. Either way,
  // asking again every two seconds would burn a subprocess for an answer that
  // cannot come. The catalog takes over, and switching the app off and on is
  // what tries again.
  if (snapshot.denied || snapshot.failed) return
  if (listeners.size > 0) timer = setTimeout(() => void poll(), pollAfter(snapshot))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    // A fresh start is also the one chance to try again after a refusal.
    snapshot = { ...snapshot, denied: false, failed: false }
    void poll()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearTimeout(timer)
      timer = undefined
    }
  }
}

/** Live now-playing, polled only while `enabled`. Switched off, nothing is
 *  asked of the system at all — which for macOS means no Apple events, so no
 *  permission prompt for someone who never turns the app on. */
export function useNowPlaying(enabled: boolean): Snapshot {
  const sub = useCallback(
    (listener: () => void) => (enabled ? subscribe(listener) : () => {}),
    [enabled],
  )
  return useSyncExternalStore(
    sub,
    () => (enabled ? snapshot : EMPTY),
    () => EMPTY,
  )
}

/** Tests need the module to forget what it has seen. */
export function resetNowPlaying() {
  clearTimeout(timer)
  timer = undefined
  reading = false
  snapshot = EMPTY
  listeners.clear()
}

// Sitting: how long you have actually been at the desk.
//
// From the brief of 9 Oct 2026. This is the opposite of Stand up, which is a
// fixed timer and will nudge you at 50 minutes whether you have been sitting
// or out at lunch. Sitting is measured: the system tells us how long since
// your last key or click, and three minutes of that means you got up, so the
// streak ends. What it reports is time you were really there.
//
// The awkward part is time we cannot account for. The machine sleeps, the
// screen locks, or the timer is throttled while the window is hidden — and
// then one poll arrives fifteen hours after the last one. A lid shut at 18:00
// and opened at 09:00 must end the streak, not post a fifteen-hour one, so a
// gap longer than the away threshold is treated as "we were not running":
// nothing in it is credited and the streak is over.
//
// Everything here is pure. app/sitting.ts does the polling.
import { dayKey } from './format'

/** Idle this long means you left the desk. Three minutes: long enough that a
 *  pause to read or think does not end a streak, short enough that a coffee
 *  run does. */
export const AWAY_SEC = 3 * 60

/** How often the idle time is read. Cheap — one syscall. */
export const POLL_MS = 15_000

/** A gap longer than this means we were not running. It is the away
 *  threshold on purpose: a span we cannot account for, which is also long
 *  enough to have got up in. */
export const MAX_GAP_MS = AWAY_SEC * 1000

export const ALERT_CHOICES = [30, 45, 60, 90] as const
export const DEFAULT_ALERT_MIN = 45

export interface SitState {
  /** When the current streak began, or null while you are away. */
  streakSince: number | null
  /** Milliseconds sat today, and the day that belongs to. */
  todayMs: number
  todayOn: string
  /** The longest streak we have seen. Not reset daily. */
  longestMs: number
  /** Minutes before the nudge. */
  alertMin: number
  /** Whether this streak has had its nudge. One per streak, like a reminder
   *  is due once per interval. */
  alerted: boolean
}

export const freshSit = (): SitState => ({
  streakSince: null,
  todayMs: 0,
  todayOn: '',
  longestMs: 0,
  alertMin: DEFAULT_ALERT_MIN,
  alerted: false,
})

export interface Poll {
  state: SitState
  /** Seconds since the last key or click, from the system. */
  idleSec: number
  now: number
  /** When we last polled, or null on the first one. */
  last: number | null
}

export interface Advanced {
  state: SitState
  /** The streak has just crossed its threshold: say so, once. */
  alert: boolean
}

/**
 * One poll's worth of change.
 *
 * Reading counts as sitting, so the whole gap is credited until the idle
 * time says you have gone. Noticing takes up to AWAY_SEC, though, so by then
 * we have already credited that idle stretch — it is given back, because the
 * streak ended at your last input rather than when we happened to look.
 */
export function advance({ state, idleSec, now, last }: Poll): Advanced {
  const gap = last === null ? 0 : Math.max(0, now - last)
  const stale = gap > MAX_GAP_MS
  const away = idleSec >= AWAY_SEC
  const ends = away || stale

  const day = dayKey(now)
  const before = state.todayOn === day ? state.todayMs : 0
  const held = state.streakSince === null ? 0 : Math.max(0, now - state.streakSince)

  // Nothing is credited for a gap we were away for, or one we cannot account
  // for at all.
  const sat = ends ? 0 : gap
  const back = away && !stale ? Math.min(idleSec * 1000, held, before) : 0

  // What the streak really came to. After a sleep, `held` counts the sleep
  // too, so the honest length is what ran before the gap opened.
  const ran = stale ? Math.max(0, held - gap) : away ? Math.max(0, held - idleSec * 1000) : held

  const streakSince = ends ? null : (state.streakSince ?? now)
  const alert =
    !ends && streakSince !== null && !state.alerted && now - streakSince >= state.alertMin * 60_000

  return {
    state: {
      ...state,
      streakSince,
      todayMs: Math.max(0, before + sat - back),
      todayOn: day,
      longestMs: Math.max(state.longestMs, ran),
      alerted: ends ? false : state.alerted || alert,
    },
    alert,
  }
}

/** How long the current streak has run; 0 while you are away. */
export const streakMs = (state: SitState, now: number): number =>
  state.streakSince === null ? 0 : Math.max(0, now - state.streakSince)

/** How far round the tile's ring: this streak against its threshold. */
export const sitFill = (state: SitState, now: number): number =>
  state.alertMin <= 0 ? 0 : Math.max(0, Math.min(1, streakMs(state, now) / (state.alertMin * 60_000)))

/** "45 min", "1h 12m" — a duration as the tile and the panel read it. */
export function span(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** What the nudge says when a streak crosses its threshold. */
export const sitNotice = (ms: number): { title: string; body: string } => ({
  title: `Sitting ${span(ms)} — stand and stretch?`,
  body: 'Measured from your last break, not a timer.',
})

/** The streak ended, by hand or because you got up. Today's total and the
 *  longest stretch are facts and stay; the streak does not. */
export const withoutStreak = (state: SitState): SitState => ({ ...state, streakSince: null, alerted: false })

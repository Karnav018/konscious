// Caffeine: what you have had, and how much of it is still in you.
//
// From the brief of 9 Oct 2026. The useful number is not the day's total but
// what is still circulating, because that is what keeps you awake. Caffeine
// leaves on a half-life of about five hours, so a 95 mg coffee at 16:00 is
// still worth about 48 mg at 21:00 and about 24 mg at 02:00 — which is the
// honest answer to "why am I awake".
//
// Two different clocks, on purpose:
//
//   · inBody runs on a rolling day. A coffee at 23:30 is still in you at
//     00:30, and a log cleared at midnight would claim otherwise.
//   · todayTotal runs on the calendar day, because that is what a daily
//     limit means.
//
// Everything here is pure.
import { dayKey } from './format'

/** One drink, logged. */
export interface Dose {
  at: number
  mg: number
}

/** Caffeine's half-life in a typical adult, in hours. Varies a lot between
 *  people — this is the usual figure, not a measurement of you. */
export const HALF_LIFE_H = 5

/** The quick-add row. Published averages for an ordinary serving. */
export const DRINKS = [
  { id: 'espresso', name: 'Espresso', mg: 63 },
  { id: 'coffee', name: 'Coffee', mg: 95 },
  { id: 'tea', name: 'Tea', mg: 47 },
  { id: 'energy', name: 'Energy drink', mg: 80 },
] as const

export type DrinkId = (typeof DRINKS)[number]['id']

/** The FDA's figure for what a healthy adult can have in a day. */
export const DEFAULT_LIMIT_MG = 400
/** After this, a cup is likely to still be with you at bedtime. 14:00. */
export const DEFAULT_CUTOFF_MIN = 14 * 60

export const LIMIT_CHOICES = [200, 300, 400, 500] as const
/** Cutoff choices, as minutes from midnight: midday to 18:00. */
export const CUTOFF_CHOICES = [12 * 60, 14 * 60, 16 * 60, 18 * 60] as const

/** The most a single custom entry can be: a mistyped 950 is not a drink. */
export const MAX_MG = 500

/** How long a dose is kept. A rolling day — see the note above. */
export const KEEP_MS = 24 * 60 * 60 * 1000

export interface CaffState {
  log: Dose[]
  limitMg: number
  /** Minutes from midnight, after which a cup earns a warning. */
  cutoffMin: number
}

export const freshCaff = (): CaffState => ({ log: [], limitMg: DEFAULT_LIMIT_MG, cutoffMin: DEFAULT_CUTOFF_MIN })

/** Doses still worth keeping. Older than a rolling day and less than 3% of a
 *  dose remains, which rounds to nothing. */
export const trim = (log: readonly Dose[], now: number): Dose[] => log.filter((d) => now - d.at < KEEP_MS)

export const withDose = (log: readonly Dose[], mg: number, now: number): Dose[] =>
  trim([...log, { at: now, mg }], now)

/** Still circulating, in mg: every dose halved once per half-life since it
 *  was taken, summed. */
export function inBody(log: readonly Dose[], now: number, halfLifeH = HALF_LIFE_H): number {
  let mg = 0
  for (const d of log) {
    // A dose logged in the future has not happened yet. Clock changes and
    // imported data both produce them.
    if (d.at > now) continue
    mg += d.mg * Math.pow(0.5, (now - d.at) / (halfLifeH * 3_600_000))
  }
  return mg
}

/** Everything taken today, by the calendar: what the limit is measured on. */
export function todayTotal(log: readonly Dose[], now: number): number {
  const today = dayKey(now)
  return log.reduce((sum, d) => (dayKey(d.at) === today ? sum + d.mg : sum), 0)
}

/** How full the cup on the tile is: what is in you against the day's limit. */
export const cupFill = (log: readonly Dose[], now: number, limitMg: number): number =>
  limitMg <= 0 ? 0 : Math.max(0, Math.min(1, inBody(log, now) / limitMg))

/** Whether a dose at this moment lands after the cutoff. */
export function pastCutoff(at: number, cutoffMin: number): boolean {
  const d = new Date(at)
  return d.getHours() * 60 + d.getMinutes() >= cutoffMin
}

/** When half of a dose is still left — the number the warning quotes. */
export const halfGoneAt = (at: number, halfLifeH = HALF_LIFE_H): number => at + halfLifeH * 3_600_000

/** "63 mg" / "1.2 g" — a reading, kept short for a tile. */
export function mg(n: number): string {
  const r = Math.round(n)
  return r >= 1000 ? `${(r / 1000).toFixed(1)} g` : `${r} mg`
}

/** 14 * 60 → "14:00", for the cutoff setting. */
export function atClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Whether the day's total has gone past the limit. */
export const overLimit = (log: readonly Dose[], now: number, limitMg: number): boolean =>
  todayTotal(log, now) > limitMg

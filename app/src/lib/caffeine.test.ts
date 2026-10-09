import { describe, expect, it } from 'vitest'

import {
  atClock,
  cupFill,
  DEFAULT_CUTOFF_MIN,
  DEFAULT_LIMIT_MG,
  type Dose,
  DRINKS,
  freshCaff,
  halfGoneAt,
  HALF_LIFE_H,
  inBody,
  KEEP_MS,
  MAX_MG,
  mg,
  overLimit,
  pastCutoff,
  todayTotal,
  trim,
  withDose,
} from './caffeine'
import { dayKey } from './format'

const H = 3_600_000
/** A fixed local noon, so the calendar-day tests do not depend on the zone. */
const noon = new Date(2026, 9, 9, 12, 0, 0).getTime()

describe('what is still in you', () => {
  it('counts a fresh dose in full', () => {
    expect(inBody([{ at: noon, mg: 95 }], noon)).toBeCloseTo(95, 5)
  })

  it('halves it over a half-life', () => {
    expect(inBody([{ at: noon, mg: 95 }], noon + HALF_LIFE_H * H)).toBeCloseTo(47.5, 5)
    expect(inBody([{ at: noon, mg: 95 }], noon + 2 * HALF_LIFE_H * H)).toBeCloseTo(23.75, 5)
  })

  it('sums what several drinks leave behind', () => {
    const log: Dose[] = [
      { at: noon, mg: 95 },
      { at: noon + HALF_LIFE_H * H, mg: 95 },
    ]
    // The first is half gone, the second is whole.
    expect(inBody(log, noon + HALF_LIFE_H * H)).toBeCloseTo(142.5, 5)
  })

  it('ignores a dose logged in the future', () => {
    expect(inBody([{ at: noon + H, mg: 95 }], noon)).toBe(0)
  })

  it('counts a late coffee after midnight, which is the whole point', () => {
    // 23:30, read at 00:30. A log cleared at midnight would say zero.
    const late = new Date(2026, 9, 9, 23, 30).getTime()
    const after = new Date(2026, 9, 10, 0, 30).getTime()
    expect(inBody([{ at: late, mg: 95 }], after)).toBeGreaterThan(80)
  })

  it('is nothing with nothing logged', () => {
    expect(inBody([], noon)).toBe(0)
    expect(freshCaff()).toEqual({ log: [], limitMg: DEFAULT_LIMIT_MG, cutoffMin: DEFAULT_CUTOFF_MIN })
  })
})

describe('the day’s total', () => {
  it('adds up the calendar day, undecayed: that is what a limit means', () => {
    const log: Dose[] = [
      { at: noon, mg: 95 },
      { at: noon + 4 * H, mg: 63 },
    ]
    expect(todayTotal(log, noon + 5 * H)).toBe(158)
  })

  it('leaves out yesterday, even while it is still in you', () => {
    const late = new Date(2026, 9, 9, 23, 30).getTime()
    const after = new Date(2026, 9, 10, 0, 30).getTime()
    expect(todayTotal([{ at: late, mg: 95 }], after)).toBe(0)
    // Still circulating, though, which is the difference between the two.
    expect(inBody([{ at: late, mg: 95 }], after)).toBeGreaterThan(80)
  })

  it('knows when the day has gone over', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ at: noon + i * H, mg: 95 }))
    expect(overLimit(five, noon + 5 * H, DEFAULT_LIMIT_MG)).toBe(true)
    expect(overLimit(five.slice(0, 4), noon + 5 * H, DEFAULT_LIMIT_MG)).toBe(false)
  })

  it('keys the day locally, not in UTC', () => {
    // 23:30 local and 00:30 local are different days wherever you run this.
    expect(dayKey(new Date(2026, 9, 9, 23, 30).getTime())).toBe('2026-10-09')
    expect(dayKey(new Date(2026, 9, 10, 0, 30).getTime())).toBe('2026-10-10')
  })
})

describe('keeping the log small', () => {
  it('drops a dose older than a rolling day', () => {
    const log: Dose[] = [
      { at: noon - KEEP_MS - 1, mg: 95 },
      { at: noon - H, mg: 63 },
    ]
    expect(trim(log, noon)).toEqual([{ at: noon - H, mg: 63 }])
  })

  it('keeps last night’s, which a calendar trim would have thrown away', () => {
    const late = new Date(2026, 9, 9, 23, 30).getTime()
    const after = new Date(2026, 9, 10, 0, 30).getTime()
    expect(trim([{ at: late, mg: 95 }], after)).toHaveLength(1)
  })

  it('adds a dose and trims in one go', () => {
    const old: Dose[] = [{ at: noon - KEEP_MS - 1, mg: 95 }]
    expect(withDose(old, 63, noon)).toEqual([{ at: noon, mg: 63 }])
  })
})

describe('the cutoff', () => {
  it('passes a morning coffee', () => {
    expect(pastCutoff(new Date(2026, 9, 9, 9, 0).getTime(), DEFAULT_CUTOFF_MIN)).toBe(false)
  })

  it('catches one at the cutoff and after it', () => {
    expect(pastCutoff(new Date(2026, 9, 9, 14, 0).getTime(), DEFAULT_CUTOFF_MIN)).toBe(true)
    expect(pastCutoff(new Date(2026, 9, 9, 16, 30).getTime(), DEFAULT_CUTOFF_MIN)).toBe(true)
  })

  it('says when half of it will still be there', () => {
    const at = new Date(2026, 9, 9, 14, 0).getTime()
    expect(halfGoneAt(at)).toBe(at + HALF_LIFE_H * H)
  })
})

describe('what the tile and the panel show', () => {
  it('fills the cup against the limit', () => {
    expect(cupFill([{ at: noon, mg: 200 }], noon, 400)).toBeCloseTo(0.5, 5)
    expect(cupFill([], noon, 400)).toBe(0)
  })

  it('never overflows the cup, however much you drink', () => {
    const lots = Array.from({ length: 20 }, (_, i) => ({ at: noon + i * 60_000, mg: 95 }))
    expect(cupFill(lots, noon + 20 * 60_000, 400)).toBe(1)
  })

  it('does not divide by a limit of zero', () => {
    expect(cupFill([{ at: noon, mg: 95 }], noon, 0)).toBe(0)
  })

  it('reads a dose back short', () => {
    expect(mg(63)).toBe('63 mg')
    expect(mg(63.4)).toBe('63 mg')
    expect(mg(1200)).toBe('1.2 g')
  })

  it('reads the cutoff as a time', () => {
    expect(atClock(14 * 60)).toBe('14:00')
    expect(atClock(9 * 60 + 5)).toBe('09:05')
    expect(atClock(0)).toBe('00:00')
  })
})

describe('the quick-add row', () => {
  it('offers four drinks with sane figures', () => {
    expect(DRINKS.map((d) => d.id)).toEqual(['espresso', 'coffee', 'tea', 'energy'])
    for (const d of DRINKS) {
      expect(d.mg).toBeGreaterThan(0)
      expect(d.mg).toBeLessThanOrEqual(MAX_MG)
    }
  })
})

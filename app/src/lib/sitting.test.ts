import { describe, expect, it } from 'vitest'

import {
  advance,
  ALERT_CHOICES,
  AWAY_SEC,
  DEFAULT_ALERT_MIN,
  freshSit,
  MAX_GAP_MS,
  POLL_MS,
  sitFill,
  type SitState,
  sitNotice,
  span,
  streakMs,
} from './sitting'
import { dayKey } from './format'

const MIN = 60_000
/** A fixed local time, so the day-rollover tests do not depend on the zone. */
const nine = new Date(2026, 9, 9, 9, 0, 0).getTime()

const sitting = (over: Partial<SitState> = {}): SitState => ({
  ...freshSit(),
  streakSince: nine,
  todayOn: dayKey(nine),
  ...over,
})

/** One poll: present (idle 2s) unless told otherwise. */
const poll = (state: SitState, now: number, last: number | null, idleSec = 2) =>
  advance({ state, idleSec, now, last })

describe('sitting down', () => {
  it('starts a streak on the first poll with someone there', () => {
    const got = poll(freshSit(), nine, null)
    expect(got.state.streakSince).toBe(nine)
    expect(got.alert).toBe(false)
  })

  it('does not start one if nobody is there', () => {
    expect(poll(freshSit(), nine, null, AWAY_SEC).state.streakSince).toBeNull()
  })

  it('credits the gap between polls', () => {
    const got = poll(sitting({ todayMs: 10 * MIN }), nine + POLL_MS, nine)
    expect(got.state.todayMs).toBe(10 * MIN + POLL_MS)
  })

  it('counts reading as sitting, not as being away', () => {
    // Two minutes without a keystroke is still someone at the desk.
    const got = poll(sitting({ todayMs: 10 * MIN }), nine + POLL_MS, nine, 120)
    expect(got.state.streakSince).toBe(nine)
    expect(got.state.todayMs).toBe(10 * MIN + POLL_MS)
  })
})

describe('getting up', () => {
  it('ends the streak once the idle time says you have gone', () => {
    const got = poll(sitting({ todayMs: 40 * MIN }), nine + 40 * MIN, nine + 40 * MIN - POLL_MS, AWAY_SEC)
    expect(got.state.streakSince).toBeNull()
  })

  it('credits nothing for the gap it noticed in', () => {
    const before = 40 * MIN
    const got = poll(sitting({ todayMs: before }), nine + 40 * MIN, nine + 40 * MIN - POLL_MS, AWAY_SEC)
    // And gives back the idle stretch it had already credited while waiting
    // to be sure, so the total is the time actually spent there.
    expect(got.state.todayMs).toBe(before - AWAY_SEC * 1000)
  })

  it('never takes the day’s total below zero', () => {
    const got = poll(sitting({ todayMs: 10_000 }), nine + 10_000, nine, AWAY_SEC * 4)
    expect(got.state.todayMs).toBe(0)
  })

  it('records the streak’s honest length, not the time until we looked', () => {
    const got = poll(sitting({ todayMs: 40 * MIN }), nine + 40 * MIN, nine + 40 * MIN - POLL_MS, AWAY_SEC)
    expect(got.state.longestMs).toBe(40 * MIN - AWAY_SEC * 1000)
  })

  it('lets the next streak nudge again', () => {
    const got = poll(sitting({ alerted: true }), nine + 50 * MIN, nine + 50 * MIN - POLL_MS, AWAY_SEC)
    expect(got.state.alerted).toBe(false)
  })
})

describe('time we cannot account for', () => {
  it('ends the streak when the lid was shut at 18:00 and opened at 09:00', () => {
    // The machine slept. One poll arrives fifteen hours after the last, and
    // the user has just woken it, so the idle time is small — which must not
    // be read as fifteen hours of sitting.
    const six = new Date(2026, 9, 9, 18, 0).getTime()
    const next = new Date(2026, 9, 10, 9, 0).getTime()
    const state = sitting({ streakSince: six - 50 * MIN, todayMs: 50 * MIN, todayOn: dayKey(six) })
    const got = advance({ state, idleSec: 2, now: next, last: six })
    expect(got.state.streakSince).toBeNull()
    // A new day, so today's total starts over — and nothing of the night is
    // in it either way.
    expect(got.state.todayOn).toBe(dayKey(next))
    expect(got.state.todayMs).toBe(0)
    // The fifty minutes before the lid shut were real, and are remembered.
    expect(got.state.longestMs).toBe(50 * MIN)
  })

  it('credits nothing for a long gap even on the same day', () => {
    const state = sitting({ todayMs: 20 * MIN })
    const got = advance({ state, idleSec: 1, now: nine + 4 * 60 * MIN, last: nine + 20 * MIN })
    expect(got.state.todayMs).toBe(20 * MIN)
    expect(got.state.streakSince).toBeNull()
  })

  it('treats a gap just over the limit as unaccountable, and one under it as real', () => {
    const state = sitting({ todayMs: 0 })
    const over = advance({ state, idleSec: 1, now: nine + MAX_GAP_MS + 1, last: nine })
    expect(over.state.streakSince).toBeNull()
    const under = advance({ state, idleSec: 1, now: nine + MAX_GAP_MS, last: nine })
    expect(under.state.streakSince).toBe(nine)
    expect(under.state.todayMs).toBe(MAX_GAP_MS)
  })
})

describe('the nudge', () => {
  it('fires once the streak crosses the threshold', () => {
    const got = poll(sitting(), nine + DEFAULT_ALERT_MIN * MIN, nine + DEFAULT_ALERT_MIN * MIN - POLL_MS)
    expect(got.alert).toBe(true)
    expect(got.state.alerted).toBe(true)
  })

  it('does not fire before it', () => {
    expect(poll(sitting(), nine + 44 * MIN, nine + 44 * MIN - POLL_MS).alert).toBe(false)
  })

  it('fires once per streak, not once per poll', () => {
    const first = poll(sitting(), nine + 45 * MIN, nine + 45 * MIN - POLL_MS)
    expect(first.alert).toBe(true)
    const again = poll(first.state, nine + 45 * MIN + POLL_MS, nine + 45 * MIN)
    expect(again.alert).toBe(false)
    const later = poll(again.state, nine + 90 * MIN, nine + 90 * MIN - POLL_MS)
    expect(later.alert).toBe(false)
  })

  it('says how long it has been, and that it was measured', () => {
    const said = sitNotice(45 * MIN)
    expect(said.title).toContain('45 min')
    expect(said.body).toMatch(/not a timer/)
  })

  it('offers sensible thresholds', () => {
    expect(ALERT_CHOICES).toContain(DEFAULT_ALERT_MIN)
  })
})

describe('the day, and what the tile shows', () => {
  it('starts today’s total over on a new day', () => {
    const state = sitting({ todayMs: 300 * MIN, todayOn: '2026-10-08' })
    expect(poll(state, nine, nine - POLL_MS).state.todayMs).toBe(POLL_MS)
  })

  it('keeps the longest streak across a day change', () => {
    const state = sitting({ longestMs: 90 * MIN, todayOn: '2026-10-08' })
    expect(poll(state, nine, nine - POLL_MS).state.longestMs).toBe(90 * MIN)
  })

  it('fills the ring against the threshold, and stops at full', () => {
    const state = sitting()
    expect(sitFill(state, nine + 22.5 * MIN)).toBeCloseTo(0.5, 5)
    expect(sitFill(state, nine + 200 * MIN)).toBe(1)
    expect(sitFill(freshSit(), nine)).toBe(0)
  })

  it('has no streak to measure while you are away', () => {
    expect(streakMs(freshSit(), nine)).toBe(0)
  })

  it('reads a duration the way a person would', () => {
    expect(span(45 * MIN)).toBe('45 min')
    expect(span(72 * MIN)).toBe('1h 12m')
    expect(span(0)).toBe('0 min')
    expect(span(-5)).toBe('0 min')
  })
})

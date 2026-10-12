import { describe, expect, it } from 'vitest'

import { afterWake, BLIND_GAP_MS, freshPomo, freshReminder, PHASE_GRACE_MS, sleptThrough, startFocus } from './apps'
import { AWAY_SEC } from './sitting'

const MIN = 60_000
const now = new Date(2026, 9, 12, 9, 0).getTime()
const set = { focusMin: 25, breakMin: 5 }

/** A focus stretch that ended `ago` ms before now. */
const ranOut = (ago: number, rounds = 2) => ({
  ...startFocus(set, { ...freshPomo(), rounds }, now - set.focusMin * MIN - ago),
  rounds,
})

const wake = (over: Partial<Parameters<typeof afterWake>[0]> = {}) =>
  afterWake({ pomo: freshPomo(), stand: freshReminder(now - 10 * MIN), gapMs: 0, idleSec: null, now, ...over })

describe('telling sleep from a throttled window', () => {
  it('ignores a gap too short to be either', () => {
    expect(sleptThrough(5_000, 5)).toBe(false)
  })

  it('believes a long gap the system confirms you were away for', () => {
    expect(sleptThrough(20 * MIN, 20 * 60)).toBe(true)
  })

  it('refuses a throttled window, where the gap is long and the idle is not', () => {
    // The window was hidden and its timers slowed; the user was working in
    // another app the whole time. Ten minutes of gap, five seconds of idle.
    expect(sleptThrough(10 * MIN, 5)).toBe(false)
  })

  it('falls back to a longer gap when the platform cannot say', () => {
    expect(sleptThrough(3 * MIN, null)).toBe(false)
    expect(sleptThrough(BLIND_GAP_MS + 1, null)).toBe(true)
  })
})

describe('a pomodoro that slept', () => {
  it('stops rather than hand you half a stretch three hours late', () => {
    const got = wake({ pomo: ranOut(3 * 60 * MIN), gapMs: 3 * 60 * MIN, idleSec: 3 * 60 * 60 })
    expect(got.stopped).toBe(true)
    expect(got.pomo.phase).toBe('idle')
    expect(got.pomo.endsAt).toBeNull()
  })

  it('keeps the rounds, because those stretches were real', () => {
    expect(wake({ pomo: ranOut(3 * 60 * MIN), gapMs: 3 * 60 * MIN, idleSec: 3 * 60 * 60 }).pomo.rounds).toBe(2)
  })

  it('advances as usual for a lid shut briefly on the boundary', () => {
    // A minute's sleep across the end of a stretch is still that stretch
    // ending; the break should start as it always would.
    const got = wake({ pomo: ranOut(MIN), gapMs: MIN, idleSec: 60 })
    expect(got.stopped).toBe(false)
    expect(got.pomo.phase).toBe('focus')
    expect(PHASE_GRACE_MS).toBeGreaterThan(MIN)
  })

  it('leaves a stretch that is still running alone', () => {
    const running = startFocus(set, freshPomo(), now - 5 * MIN)
    const got = wake({ pomo: running, gapMs: 20 * MIN, idleSec: 20 * 60 })
    expect(got.stopped).toBe(false)
    expect(got.pomo).toEqual(running)
  })

  it('leaves an idle pomodoro alone', () => {
    expect(wake({ gapMs: 3 * 60 * MIN, idleSec: 3 * 60 * 60 }).stopped).toBe(false)
  })
})

describe('a stand-up nudge that slept', () => {
  it('counts a sleep as having stood', () => {
    const got = wake({ gapMs: 20 * MIN, idleSec: 20 * 60 })
    expect(got.stood).toBe(true)
    expect(got.stand.since).toBe(now)
    expect(got.stand.dueAt).toBeNull()
  })

  it('clears one that was already due before the lid closed', () => {
    const due = { ...freshReminder(now - 60 * MIN), dueAt: now - 30 * MIN }
    const got = wake({ stand: due, gapMs: 20 * MIN, idleSec: 20 * 60 })
    expect(got.stood).toBe(true)
    expect(got.stand.dueAt).toBeNull()
  })

  it('does not count a sleep shorter than leaving the desk', () => {
    // Ninety seconds is long enough to be sleep but not long enough to be
    // a break, and Sitting uses the same three minutes for the same reason.
    const got = wake({ gapMs: 90_000, idleSec: 90 })
    expect(got.stood).toBe(false)
    expect(AWAY_SEC * 1000).toBeGreaterThan(90_000)
  })

  it('leaves it alone when the window was only throttled', () => {
    const got = wake({ pomo: ranOut(3 * 60 * MIN), gapMs: 10 * MIN, idleSec: 5 })
    expect(got.stood).toBe(false)
    expect(got.stopped).toBe(false)
  })
})

describe('what waking never touches', () => {
  it('has nothing to say about water', () => {
    // "You have not had a drink in a while" is as true after a nap as
    // before one, so water is deliberately not in the result at all.
    const got = wake({ gapMs: 3 * 60 * MIN, idleSec: 3 * 60 * 60 })
    expect(Object.keys(got).sort()).toEqual(['pomo', 'stand', 'stood', 'stopped'])
  })

  it('changes nothing at all when it was not asleep', () => {
    const pomo = ranOut(3 * 60 * MIN)
    const stand = freshReminder(now - 60 * MIN)
    const got = afterWake({ pomo, stand, gapMs: 10 * MIN, idleSec: 2, now })
    expect(got).toEqual({ pomo, stand, stopped: false, stood: false })
  })
})

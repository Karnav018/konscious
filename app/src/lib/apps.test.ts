import { describe, expect, it } from 'vitest'

import {
  acknowledged,
  alongEdge,
  APPS,
  appById,
  BREAK_CHOICES,
  FOCUS_CHOICES,
  freshPomo,
  freshReminder,
  gaugeFill,
  HOLD_MS,
  HOT_PCT,
  isDue,
  isReminder,
  isVertical,
  metricTone,
  nearestEdge,
  nextDueAt,
  pomoAdvance,
  pomoClock,
  pomoLeft,
  pomoNotice,
  pomoOver,
  pomoProgress,
  skipped,
  startFocus,
  stopPomo,
  snoozed,
  TEMP_MAX,
} from './apps'

const now = 1_700_000_000_000
const min = (n: number) => n * 60_000
const due = (over: Partial<Parameters<typeof isDue>[0]> = {}) =>
  isDue({ every: 40, state: freshReminder(now - min(41)), sessionWaiting: false, now, ...over })

describe('the catalog', () => {
  it('ships every app in a category, in catalog order', () => {
    expect(APPS.map((a) => a.id)).toEqual(['water', 'stand', 'pomo', 'warm', 'sys'])
    expect(APPS.filter((a) => a.category === 'Reminders').map((a) => a.id)).toEqual(['water', 'stand'])
    expect(APPS.filter((a) => a.category === 'Timers').map((a) => a.id)).toEqual(['pomo'])
    expect(APPS.filter((a) => a.category === 'Display').map((a) => a.id)).toEqual(['warm'])
    expect(APPS.filter((a) => a.category === 'System').map((a) => a.id)).toEqual(['sys'])
  })

  it('separates reminders from the gauge by whether they have an interval', () => {
    expect(isReminder(appById('water'))).toBe(true)
    expect(isReminder(appById('stand'))).toBe(true)
    expect(isReminder(appById('sys'))).toBe(false)
    expect(appById('water').everyMin).toBe(40)
    expect(appById('stand').everyMin).toBe(50)
  })

  it('never uses a session colour for an app', () => {
    // --ok, --warn, --err and --info are how a pane says what it is doing.
    const status = ['var(--ok)', 'var(--warn)', 'var(--err)', 'var(--info)']
    // Amber would have been the obvious hue for warmth, and amber is --warn.
    for (const app of APPS) expect(status).not.toContain(app.hue)
  })

  it('says what every app can do, for the catalog and later the permissions', () => {
    for (const app of APPS) expect(app.can.length).toBeGreaterThan(0)
  })
})

describe('when a reminder is due', () => {
  it('comes due once the interval has passed since the last acknowledgement', () => {
    expect(due()).toBe(true)
    expect(due({ state: freshReminder(now - min(39)) })).toBe(false)
  })

  it('holds while a session is waiting, but only for five minutes', () => {
    const justReady = freshReminder(now - min(40))
    expect(due({ state: justReady, sessionWaiting: true })).toBe(false)
    const longOverdue = freshReminder(now - min(40) - HOLD_MS - 1)
    expect(due({ state: longOverdue, sessionWaiting: true })).toBe(true)
  })

  it('stays due until it is dealt with, and does not stack', () => {
    const firing = { ...freshReminder(now - min(80)), dueAt: now - min(40) }
    expect(due({ state: firing })).toBe(true)
    // Two intervals late is still one nudge, and a waiting session cannot
    // hold a nudge that already fired.
    expect(due({ state: firing, sessionWaiting: true })).toBe(true)
  })

  it('restarts the interval from the tap, not from when it fired', () => {
    const acked = acknowledged(now)
    expect(acked.since).toBe(now)
    expect(acked.dueAt).toBeNull()
    expect(due({ state: acked })).toBe(false)
    expect(nextDueAt(40, acked, now)).toBe(now + min(40))
  })

  it('goes quiet for exactly the snooze, then comes back', () => {
    const later = snoozed(freshReminder(now - min(41)), 10, now)
    expect(due({ state: later })).toBe(false)
    expect(nextDueAt(40, later, now)).toBe(now + min(10))
    expect(due({ state: later, now: now + min(10) + 1 })).toBe(true)
  })

  it('treats a skip as a full interval, not an immediate repeat', () => {
    expect(due({ state: skipped(now) })).toBe(false)
  })

  it('has no next time while one is already due', () => {
    expect(nextDueAt(40, { ...freshReminder(now - min(80)), dueAt: now })).toBeNull()
  })
})

describe('the system stats gauge', () => {
  it('scales temperature to 105 degrees, not to 100', () => {
    expect(gaugeFill('tmp', TEMP_MAX)).toBe(1)
    expect(gaugeFill('tmp', 52)).toBeCloseTo(52 / 105, 5)
    expect(gaugeFill('cpu', 52)).toBeCloseTo(0.52, 5)
  })

  it('clamps a reading that is out of range', () => {
    expect(gaugeFill('cpu', 140)).toBe(1)
    expect(gaugeFill('ram', -5)).toBe(0)
  })

  it('is dim when idle, its own hue normally, and hot under load', () => {
    expect(metricTone('cpu', 12)).toBe('quiet')
    expect(metricTone('cpu', 55)).toBe('normal')
    expect(metricTone('cpu', HOT_PCT)).toBe('hot')
    // 90°C is hot on a gauge that tops out at 105.
    expect(metricTone('tmp', 90)).toBe('hot')
    expect(metricTone('tmp', 60)).toBe('normal')
  })
})

describe('where the dock sits', () => {
  it('stands the dock up on the sides and lays it down on top and bottom', () => {
    expect([isVertical('left'), isVertical('right')]).toEqual([true, true])
    expect([isVertical('top'), isVertical('bottom')]).toEqual([false, false])
  })

  it('picks the edge the pointer is nearest', () => {
    expect(nearestEdge(10, 400, 1200, 800)).toBe('left')
    expect(nearestEdge(1190, 400, 1200, 800)).toBe('right')
    expect(nearestEdge(600, 5, 1200, 800)).toBe('top')
    expect(nearestEdge(600, 795, 1200, 800)).toBe('bottom')
  })

  it('measures position along the edge the dock is on', () => {
    expect(alongEdge('right', 1190, 200, 1200, 800)).toBeCloseTo(0.25, 5)
    expect(alongEdge('top', 300, 5, 1200, 800)).toBeCloseTo(0.25, 5)
  })

  it('keeps a dragged dock inside the window', () => {
    expect(alongEdge('right', 1190, -40, 1200, 800)).toBe(0)
    expect(alongEdge('bottom', 5000, 790, 1200, 800)).toBe(1)
  })
})

describe('the pomodoro', () => {
  const set = { focusMin: 25, breakMin: 5 }
  const idle = freshPomo()

  it('offers the focus lengths asked for, and shorter breaks', () => {
    expect(FOCUS_CHOICES).toEqual([5, 15, 25, 30])
    expect(BREAK_CHOICES).toEqual([5, 10, 15])
  })

  it('is not a session colour, and is its own category', () => {
    const pomo = appById('pomo')
    expect(pomo.hue).toBe('var(--pomo)')
    expect(pomo.category).toBe('Timers')
    expect(isReminder(pomo)).toBe(false)
  })

  it('runs a focus stretch for the length chosen', () => {
    const running = startFocus(set, idle, now)
    expect(running.phase).toBe('focus')
    expect(pomoLeft(running, now)).toBe(min(25))
    expect(pomoLeft(running, now + min(10))).toBe(min(15))
    expect(pomoOver(running, now + min(25))).toBe(true)
    expect(pomoOver(running, now + min(24))).toBe(false)
  })

  it('earns a break and counts the round when focus ends', () => {
    const ended = startFocus(set, idle, now)
    const next = pomoAdvance(ended, set, now + min(25))
    expect(next.phase).toBe('break')
    expect(next.rounds).toBe(1)
    expect(pomoLeft(next, now + min(25))).toBe(min(5))
  })

  it('goes back to focus after the break, keeping the tally', () => {
    const onBreak = { phase: 'break' as const, endsAt: now + min(5), rounds: 3 }
    const back = pomoAdvance(onBreak, set, now + min(5))
    expect(back.phase).toBe('focus')
    expect(back.rounds).toBe(3)
    expect(pomoLeft(back, now + min(5))).toBe(min(25))
  })

  it('shows nothing left and no progress while idle', () => {
    expect(pomoLeft(idle, now)).toBe(0)
    expect(pomoProgress(idle, set, now)).toBe(0)
    expect(pomoOver(idle, now)).toBe(false)
    expect(pomoAdvance(idle, set, now)).toEqual(idle)
  })

  it('fills the ring across the phase, not across the whole cycle', () => {
    const running = startFocus(set, idle, now)
    expect(pomoProgress(running, set, now)).toBe(0)
    expect(pomoProgress(running, set, now + min(12.5))).toBeCloseTo(0.5, 5)
    expect(pomoProgress(running, set, now + min(25))).toBe(1)
    // A break is shorter, so the same elapsed time is further through it.
    const onBreak = { phase: 'break' as const, endsAt: now + min(5), rounds: 1 }
    expect(pomoProgress(onBreak, set, now + min(2.5))).toBeCloseTo(0.5, 5)
  })

  it('keeps the day’s tally when stopped', () => {
    const stopped = stopPomo({ phase: 'focus', endsAt: now + min(9), rounds: 4 })
    expect(stopped).toEqual({ phase: 'idle', endsAt: null, rounds: 4 })
  })

  it('says the right thing at each handover', () => {
    expect(pomoNotice('focus', set).title).toBe('Time for a break')
    expect(pomoNotice('focus', set).body).toContain('5 minutes')
    expect(pomoNotice('break', set).title).toBe('Back to it')
    expect(pomoNotice('break', set).body).toContain('25 minutes')
  })

  it('counts down in minutes and seconds', () => {
    expect(pomoClock(min(25))).toBe('25:00')
    expect(pomoClock(61_000)).toBe('1:01')
    expect(pomoClock(1)).toBe('0:01')
    expect(pomoClock(0)).toBe('0:00')
    expect(pomoClock(-5)).toBe('0:00')
  })
})

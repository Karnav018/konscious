import { beforeEach, describe, expect, it, vi } from 'vitest'

// No terminal engine; the idle reading is the only thing we stand in for.
vi.mock('../lib/terminals', () => ({
  terminals: {
    has: vi.fn(() => false),
    clear: vi.fn(),
    ensure: vi.fn(),
    hold: vi.fn(),
    channel: vi.fn(),
    whenWritten: vi.fn(async () => {}),
    release: vi.fn(),
    started: vi.fn(),
    nudge: vi.fn(),
    paint: vi.fn(),
  },
  setStartHook: vi.fn(),
  requestStart: vi.fn(),
}))
vi.mock('../lib/ipc', () => ({
  ipc: { notify: vi.fn(), notifyAllowed: vi.fn(async () => false), systemIdleSecs: vi.fn(async () => 2) },
  errorMessage: (e: unknown) => String(e),
}))

import { ipc } from '../lib/ipc'
import { pollSitting, resetSittingPoll } from './sitting'
import { AWAY_SEC, POLL_MS } from '../lib/sitting'
import { setAppOn } from '../state/commands/apps'
import { getState, initialState, useApp } from '../state/store'

const idle = ipc.systemIdleSecs as unknown as ReturnType<typeof vi.fn>
/** One poll, awaited: the reading comes back from a promise. */
const poll = async (at: number, idleSec = 2) => {
  idle.mockResolvedValueOnce(idleSec)
  pollSitting(at)
  await Promise.resolve()
  await Promise.resolve()
}

describe('polling for idle time', () => {
  beforeEach(() => {
    useApp.setState(initialState(), true)
    resetSittingPoll()
    idle.mockReset()
    idle.mockResolvedValue(2)
  })

  it('does not ask while the app is off', async () => {
    await poll(Date.now())
    expect(idle).not.toHaveBeenCalled()
  })

  it('starts a streak once it is on and someone is there', async () => {
    setAppOn('sit', true)
    await poll(Date.now())
    expect(idle).toHaveBeenCalledTimes(1)
    expect(getState().ui.apps.sit.streakSince).not.toBeNull()
  })

  it('paces itself, however often the tick offers', async () => {
    setAppOn('sit', true)
    const t = Date.now()
    await poll(t)
    for (let i = 1; i < 10; i++) {
      pollSitting(t + i * 1000)
      await Promise.resolve()
    }
    // One second apart, so only the first one asked.
    expect(idle).toHaveBeenCalledTimes(1)
    await poll(t + POLL_MS + 1000)
    expect(idle).toHaveBeenCalledTimes(2)
  })

  it('ends the streak when the reading says you got up', async () => {
    setAppOn('sit', true)
    const t = Date.now()
    await poll(t)
    expect(getState().ui.apps.sit.streakSince).not.toBeNull()
    await poll(t + POLL_MS + 1, AWAY_SEC)
    expect(getState().ui.apps.sit.streakSince).toBeNull()
  })

  it('stops asking where the platform cannot say', async () => {
    setAppOn('sit', true)
    idle.mockResolvedValue(null)
    pollSitting(Date.now())
    await Promise.resolve()
    await Promise.resolve()
    expect(idle).toHaveBeenCalledTimes(1)
    pollSitting(Date.now() + POLL_MS * 4)
    await Promise.resolve()
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it('nudges once the streak crosses the threshold, through the notch', async () => {
    setAppOn('sit', true)
    const t = Date.now()
    await poll(t)
    const alertMin = getState().ui.apps.sit.alertMin
    // Polled all the way there, fifteen seconds at a time. Jumping straight
    // to the threshold would be a gap we cannot account for, and the tracker
    // would rightly end the streak instead of nudging.
    for (let at = t + POLL_MS; at <= t + alertMin * 60_000; at += POLL_MS) await poll(at)
    const events = getState().ui.island.events
    expect(events).toHaveLength(1)
    expect(events[0].app).toBe('sit')
    expect(events[0].title).toMatch(/Sitting .* stand and stretch\?/)
  })

  it('survives the reading failing, without crediting the gap', async () => {
    setAppOn('sit', true)
    const t = Date.now()
    await poll(t)
    const before = getState().ui.apps.sit.todayMs
    idle.mockRejectedValueOnce(new Error('no answer'))
    pollSitting(t + POLL_MS + 1)
    await Promise.resolve()
    await Promise.resolve()
    expect(getState().ui.apps.sit.todayMs).toBe(before)
  })

  it('counts the time it walked through into the day’s total', async () => {
    setAppOn('sit', true)
    const t = Date.now()
    await poll(t)
    for (let i = 1; i <= 8; i++) await poll(t + i * POLL_MS)
    expect(getState().ui.apps.sit.todayMs).toBe(8 * POLL_MS)
  })

  it('forgets the gap when the app is switched off', async () => {
    setAppOn('sit', true)
    const t = Date.now()
    await poll(t)
    setAppOn('sit', false)
    pollSitting(t + POLL_MS + 1)
    await Promise.resolve()
    setAppOn('sit', true)
    // Back on, and the first poll is allowed through rather than held off by
    // the stale timestamp from before.
    await poll(t + POLL_MS + 2000)
    expect(idle).toHaveBeenCalledTimes(2)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// No terminal engine or Tauri: logging a drink touches neither.
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
  ipc: { notify: vi.fn(), notifyAllowed: vi.fn(async () => false), systemIdleSecs: vi.fn(async () => null) },
  errorMessage: (e: unknown) => String(e),
}))

import { logCaffeine } from './caffeine'
import { DEFAULT_LIMIT_MG } from '../lib/caffeine'
import { setAppOn } from '../state/commands/apps'
import { setAppIsland } from '../state/commands/island'
import { getState, initialState, useApp } from '../state/store'

/** Mid-morning, so the cutoff is not in play unless a test wants it. */
const morning = new Date(2026, 9, 9, 9, 0).getTime()
const evening = new Date(2026, 9, 9, 19, 0).getTime()

const events = () => getState().ui.island.events
const titles = () => events().map((e) => e.title)

describe('logging a drink', () => {
  beforeEach(() => {
    useApp.setState(initialState(), true)
    setAppOn('caff', true)
  })

  it('records what you drank', () => {
    logCaffeine(95, morning)
    expect(getState().ui.apps.caff.log).toEqual([{ at: morning, mg: 95 }])
  })

  it('says nothing about an ordinary morning coffee', () => {
    logCaffeine(95, morning)
    expect(events()).toEqual([])
  })

  it('says something once the day goes over the limit', () => {
    // Four coffees is 380mg, under 400. The fifth crosses it.
    for (let i = 0; i < 4; i++) logCaffeine(95, morning + i * 60_000)
    expect(events()).toEqual([])
    logCaffeine(95, morning + 4 * 60_000)
    expect(titles()).toEqual(['Over your caffeine limit'])
  })

  it('does not say it again for every cup after that', () => {
    for (let i = 0; i < 6; i++) logCaffeine(95, morning + i * 60_000)
    // One event, because a later cup replaces rather than stacks — and the
    // crossing itself is only announced once.
    expect(events()).toHaveLength(1)
    expect(titles()).toEqual(['Over your caffeine limit'])
  })

  it('warns about a cup after the cutoff', () => {
    logCaffeine(95, evening)
    expect(titles()).toEqual(['That one will still be with you'])
    expect(events()[0].body).toMatch(/still in you at \d\d:\d\d/)
  })

  it('prefers the limit warning when a late cup does both', () => {
    for (let i = 0; i < 4; i++) logCaffeine(95, morning + i * 60_000)
    logCaffeine(95, evening)
    expect(titles()).toEqual(['Over your caffeine limit'])
  })

  it('keeps quiet in the notch for an app told not to use it', () => {
    setAppIsland('caff', false)
    for (let i = 0; i < 5; i++) logCaffeine(95, morning + i * 60_000)
    expect(events()).toEqual([])
    // The drink is still logged; only the nudge is suppressed.
    expect(getState().ui.apps.caff.log).toHaveLength(5)
  })

  it('warns again the next day, once that day goes over', () => {
    for (let i = 0; i < 5; i++) logCaffeine(95, morning + i * 60_000)
    expect(titles()).toEqual(['Over your caffeine limit'])
    const tomorrow = new Date(2026, 9, 10, 9, 0).getTime()
    // Yesterday's drinks are no longer in the day's total, so the first cup
    // of the new day is under the limit again.
    logCaffeine(95, tomorrow)
    expect(getState().ui.apps.caff.limitMg).toBe(DEFAULT_LIMIT_MG)
    expect(titles()).toEqual(['Over your caffeine limit'])
  })
})

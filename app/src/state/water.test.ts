import { beforeEach, describe, expect, it } from 'vitest'

import { acknowledge, setAppOn } from './commands/apps'
import { getState, initialState, useApp } from './store'

/** Built from local-time components, so this says the same thing in every
 *  timezone — and says the right thing in the one the user is actually in. */
const at = (hour: number, minute = 0, day = 12) => new Date(2026, 9, day, hour, minute).getTime()

describe('the day a glass of water is counted on', () => {
  beforeEach(() => {
    useApp.setState(initialState(), true)
    setAppOn('water', true)
  })

  it('counts two glasses drunk on the same local day', () => {
    // This is the regression. The count used to be filed under the UTC date,
    // so in IST a glass at 01:00 landed on the previous day and the one at
    // 09:00 started a "new" day — the tally reset at 05:30 every morning
    // instead of at midnight. Under TZ=Asia/Kolkata this fails on the old
    // code and passes on the new.
    acknowledge('water', at(1))
    expect(getState().ui.apps.glasses).toBe(1)
    acknowledge('water', at(9))
    expect(getState().ui.apps.glasses).toBe(2)
  })

  it('starts again after local midnight', () => {
    acknowledge('water', at(23, 50, 11))
    expect(getState().ui.apps.glasses).toBe(1)
    acknowledge('water', at(0, 10, 12))
    expect(getState().ui.apps.glasses).toBe(1)
  })

  it('files the glass under the local day it was drunk', () => {
    acknowledge('water', at(1))
    expect(getState().ui.apps.glassesOn).toBe('2026-10-12')
  })
})

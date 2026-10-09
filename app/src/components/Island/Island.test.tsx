// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Island } from './Island'
import { COLLAPSE_MS } from '../../lib/island'
import { setAppOn } from '../../state/commands/apps'
import { pushIsland, setAppIsland } from '../../state/commands/island'
import { getState, initialState, useApp } from '../../state/store'

const rect = (left: number, right: number): DOMRect =>
  ({ left, right, width: right - left, top: 0, bottom: 46, height: 46, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

/** happy-dom does not lay anything out, so the island measures zeros and
 *  shows — which is what we want for every test but the two about room. This
 *  gives the bar and its spacer real edges instead. */
function layout(barW: number, gapLeft: number, gapRight: number) {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.hasAttribute?.('data-bar-gap') ? rect(gapLeft, gapRight) : rect(0, barW)
  } as Element['getBoundingClientRect']
}

/** A title bar around the island, as TitleBar renders it. */
const inBar = () => (
  <div>
    <div data-bar-gap />
    <Island />
  </div>
)

describe('the notch island', () => {
  const realRect = Element.prototype.getBoundingClientRect

  beforeEach(() => {
    useApp.setState(initialState(), true)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Element.prototype.getBoundingClientRect = realRect
  })

  it('is a sliver with nothing to say', () => {
    const r = render(<Island />)
    const el = r.container.querySelector('[data-island]') as HTMLElement
    expect(el).not.toBeNull()
    expect(el.textContent).toBe('')
    // Nothing to click through to, so it must not eat the drag region.
    expect(el.style.pointerEvents).toBe('none')
  })

  it('never carries the drag region, which would eat its own clicks', () => {
    pushIsland({ app: 'water', title: 'Drink water' })
    const r = render(<Island />)
    const el = r.container.querySelector('[data-island]') as HTMLElement
    expect(el.hasAttribute('data-tauri-drag-region')).toBe(false)
  })

  it('shows an alert that was pushed', () => {
    pushIsland({ app: 'water', title: 'Drink water', body: 'A glass now and then.' })
    const r = render(<Island />)
    expect(r.getByText('Drink water')).toBeTruthy()
    expect(r.getByText('A glass now and then.')).toBeTruthy()
  })

  it('stays out of a bar whose clusters leave no room in the middle', () => {
    // 1280 wide with the waiting and update chips showing: the left cluster
    // reaches 930 and the right starts at 1000, so a 220px island centred at
    // 640 would run through the left one.
    layout(1280, 930, 1000)
    pushIsland({ app: 'water', title: 'Drink water' })
    const r = render(inBar())
    expect(r.container.querySelector('[data-island]')).toBeNull()
  })

  it('shows once the bar is wide enough for it', () => {
    layout(1920, 700, 1200)
    pushIsland({ app: 'water', title: 'Drink water' })
    const r = render(inBar())
    expect(r.container.querySelector('[data-island]')).not.toBeNull()
    expect(r.getByText('Drink water')).toBeTruthy()
  })

  it('collapses a fresh alert once it has stopped being news', () => {
    vi.useFakeTimers()
    pushIsland({ app: 'water', title: 'Drink water', body: 'A glass now and then.' })
    const r = render(<Island />)
    expect(r.queryByText('A glass now and then.')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(COLLAPSE_MS + 1500))
    // The title stays — it is still an activity — but the body goes with the
    // expanded size.
    expect(r.queryByText('A glass now and then.')).toBeNull()
    expect(r.getByText('Drink water')).toBeTruthy()
  })

  it('offers the reminder’s own actions when an alert is clicked', () => {
    pushIsland({ app: 'water', title: 'Drink water' })
    const r = render(<Island />)
    expect(r.queryByText('Had a glass')).toBeNull()
    fireEvent.click(r.container.querySelector('[data-island]')!)
    expect(r.getByText('Had a glass')).toBeTruthy()
    expect(r.getByText(/In \d+ min/)).toBeTruthy()
    expect(r.getByText('Skip')).toBeTruthy()
  })

  it('acknowledges through the same command the dock uses, and clears itself', () => {
    pushIsland({ app: 'water', title: 'Drink water' })
    const r = render(<Island />)
    fireEvent.click(r.container.querySelector('[data-island]')!)
    fireEvent.click(r.getByText('Had a glass'))
    // The glass is counted, which is the dock popover's job too, and the
    // island has nothing left to show.
    expect(getState().ui.apps.glasses).toBe(1)
    expect(getState().ui.island.events).toEqual([])
  })

  it('dismisses one activity without touching the reminder', () => {
    pushIsland({ app: 'water', title: 'Drink water' })
    const r = render(<Island />)
    fireEvent.click(r.getByTitle('Dismiss'))
    expect(getState().ui.island.events).toEqual([])
    expect(getState().ui.apps.glasses).toBe(0)
  })

  it('shows a dot per activity once there is more than one', () => {
    pushIsland({ app: 'water', title: 'Drink water' }, Date.now() - 2000)
    pushIsland({ app: 'stand', title: 'Stand up' }, Date.now() - 1000)
    const r = render(<Island />)
    expect(r.container.querySelectorAll('[data-island-dot]')).toHaveLength(2)
    // Newest first, so the one on show is the stand-up nudge.
    expect(r.getByText('Stand up')).toBeTruthy()
  })

  it('counts a running pomodoro as a live activity', () => {
    setAppOn('pomo', true)
    useApp.setState(
      (s) => ({ ui: { ...s.ui, apps: { ...s.ui.apps, pomo: { phase: 'focus', endsAt: Date.now() + 60_000, rounds: 0 } } } }),
      false,
    )
    const r = render(<Island />)
    // A clock, not a title: the live tile shows how much is left.
    expect(r.container.querySelector('[data-island]')!.textContent).toMatch(/\d+:\d\d/)
  })

  it('says nothing for an app told not to use the notch', () => {
    pushIsland({ app: 'water', title: 'Drink water' })
    setAppIsland('water', false)
    const r = render(<Island />)
    expect(r.queryByText('Drink water')).toBeNull()
  })
})

// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The panes are terminals; here they only need to be placed.
vi.mock('../SessionPane/SessionPane', () => ({
  SessionPane: (p: { id: string; highlight?: boolean; reorder: { handle: object } | null }) => (
    <div data-testid={`pane-${p.id}`} data-lit={p.highlight ? 'y' : 'n'} {...p.reorder?.handle} />
  ),
}))
// Dropping really reorders, as the app's action does.
vi.mock('../../app/actions', async () => {
  const { movePaneOnto } = await import('../../state/commands/layout')
  return { movePaneOnto }
})

import { layoutOf, openPane, toggleFocus } from '../../state/commands/layout'
import { addSession, addWorkspace, setActiveWorkspace } from '../../state/commands/workspace'
import { getState, initialState, useApp } from '../../state/store'
import type { SessionMeta } from '../../types'
import { SessionGrid } from './SessionGrid'

/** SessionGrid's HOVER_INTENT_MS. */
const HOVER_INTENT_MS = 1000

let wsId = ''
const layout = () => layoutOf(getState().layout.byWorkspace, wsId)
const slot = (id: string) => screen.getByTestId(`pane-${id}`).parentElement as HTMLElement

beforeEach(() => {
  useApp.setState(initialState(), true)
  wsId = addWorkspace('/p/hawk').id
  setActiveWorkspace(wsId)
  for (const id of ['a', 'b', 'c', 'd']) {
    addSession({ id, workspaceId: wsId, kind: 'claude', name: id, cwd: '/p', claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1 } as SessionMeta)
    openPane(id)
  }
  // happy-dom lays nothing out: give the stage a size.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
  HTMLElement.prototype.setPointerCapture = () => {}
})
afterEach(cleanup)

describe('the grid', () => {
  it('places four panes 2 × 2, with a gap handle beside every pair of panes', () => {
    render(<SessionGrid />)
    expect(slot('a').style.left).toBe('calc(0% + 2px)')
    expect(slot('d').style.left).toBe('calc(50% + 2px)')
    expect(slot('d').style.top).toBe('calc(50% + 2px)')
    // Two height gaps (one per column), the width gap in two (one per row).
    expect(screen.getAllByRole('separator')).toHaveLength(4)
  })

  it('a height gap resizes just the two panes in its column, and lights them', () => {
    render(<SessionGrid />)
    // The left column's gap: a above c.
    const left = screen.getAllByRole('separator').find((d) => d.getAttribute('aria-orientation') === 'horizontal' && d.style.left === '0%')!
    const lit = () => screen.getAllByTestId(/^pane-/).filter((p) => p.dataset.lit === 'y').map((p) => p.dataset.testid)
    // Passing over a gap lights nothing; resting on it for a second does.
    vi.useFakeTimers()
    fireEvent.pointerEnter(left)
    act(() => void vi.advanceTimersByTime(HOVER_INTENT_MS - 100))
    expect(lit()).toEqual([])
    fireEvent.pointerLeave(left)
    fireEvent.pointerEnter(left)
    act(() => void vi.advanceTimersByTime(HOVER_INTENT_MS))
    vi.useRealTimers()
    expect(lit()).toEqual(['pane-a', 'pane-c'])
    fireEvent.pointerDown(left, { button: 0, clientX: 100, clientY: 300 })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 360 })
    fireEvent.pointerUp(window)
    expect(slot('a').style.height).toBe('calc(60% - 4px)')
    expect(slot('c').style.top).toBe('calc(60% + 2px)')
    // The right column keeps its own heights.
    expect(slot('b').style.height).toBe('calc(50% - 4px)')
    expect(slot('d').style.top).toBe('calc(50% + 2px)')
    // Double-click: that split goes back to even.
    fireEvent.doubleClick(left)
    expect(slot('a').style.height).toBe('calc(50% - 4px)')
  })

  it('the width gap beside two panes resizes just their row', () => {
    render(<SessionGrid />)
    const widthGap = (top: string) =>
      screen.getAllByRole('separator').find((d) => d.getAttribute('aria-orientation') === 'vertical' && d.style.top === top)!
    // A click alone changes nothing.
    fireEvent.pointerDown(widthGap('0%'), { button: 0, clientX: 500, clientY: 100 })
    fireEvent.pointerUp(window)
    expect(layout().trees).toEqual({})
    // Drag the top row's gap 100px right: a and b change, c and d don't.
    fireEvent.pointerDown(widthGap('0%'), { button: 0, clientX: 500, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 600, clientY: 100 })
    fireEvent.pointerUp(window)
    expect(slot('a').style.width).toBe('calc(60% - 4px)')
    expect(slot('b').style.left).toBe('calc(60% + 2px)')
    expect(slot('c').style.width).toBe('calc(50% - 4px)')
    expect(slot('d').style.left).toBe('calc(50% + 2px)')
  })

  it('then a height gap under one pane resizes just its column again', () => {
    render(<SessionGrid />)
    const vertical = screen.getAllByRole('separator').find((d) => d.getAttribute('aria-orientation') === 'vertical' && d.style.top === '0%')!
    fireEvent.pointerDown(vertical, { button: 0, clientX: 500, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 600, clientY: 100 })
    fireEvent.pointerUp(window)
    // Built as rows now: the height gap comes in one segment per column.
    const underA = screen.getAllByRole('separator').find((d) => d.getAttribute('aria-orientation') === 'horizontal' && d.style.left === '0%')!
    fireEvent.pointerDown(underA, { button: 0, clientX: 100, clientY: 300 })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 360 })
    fireEvent.pointerUp(window)
    expect(slot('a').style.height).toBe('calc(60% - 4px)')
    expect(slot('b').style.height).toBe('calc(50% - 4px)')
    // The two rows' column lines (60% and 50%) met in the middle.
    expect(slot('b').style.left).toBe('calc(55% + 2px)')
  })

  it('Focus shows one pane over the whole stage, without dividers', () => {
    toggleFocus(wsId, 'b')
    render(<SessionGrid />)
    expect(screen.queryAllByTestId(/^pane-/)).toHaveLength(1)
    expect(slot('b').style.width).toBe('calc(100% - 4px)')
    expect(screen.queryAllByRole('separator')).toHaveLength(0)
  })

  it('keeps panes in one DOM order whatever the grid order', () => {
    render(<SessionGrid />)
    const ids = () => screen.getAllByTestId(/^pane-/).map((p) => p.dataset.testid)
    const before = ids()
    act(() =>
      useApp.setState((s) => {
        const l = s.layout.byWorkspace[wsId]
        return { layout: { byWorkspace: { ...s.layout.byWorkspace, [wsId]: { ...l, open: ['d', 'c', 'b', 'a'] } } } }
      }),
    )
    expect(ids()).toEqual(before)
    expect(slot('d').style.left).toBe('calc(0% + 2px)')
  })

  it('a dragged pane follows the pointer while the others slide over', () => {
    render(<SessionGrid />)
    const a = screen.getByTestId('pane-a')
    fireEvent.pointerDown(a, { button: 0, clientX: 100, clientY: 100 })
    // Over b's slot (top right).
    fireEvent.pointerMove(a, { clientX: 700, clientY: 100 })
    expect(slot('a').style.transform).toBe('translate(600px, 0px)')
    expect(slot('b').style.left).toBe('calc(0% + 2px)')
    // Across the gap: the preview holds.
    fireEvent.pointerMove(a, { clientX: 500, clientY: 100 })
    expect(slot('b').style.left).toBe('calc(0% + 2px)')
    fireEvent.pointerMove(a, { clientX: 700, clientY: 100 })
    fireEvent.pointerUp(a)
    // Dropped: the order is made, and a glides into its new slot.
    expect(layout().open).toEqual(['b', 'a', 'c', 'd'])
    expect(slot('a').style.left).toBe('calc(50% + 2px)')
    expect(slot('a').style.transform).toBe('none')
  })

  it('back over its own slot, nothing moves', () => {
    render(<SessionGrid />)
    const a = screen.getByTestId('pane-a')
    fireEvent.pointerDown(a, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(a, { clientX: 700, clientY: 100 })
    fireEvent.pointerMove(a, { clientX: 120, clientY: 110 })
    expect(slot('b').style.left).toBe('calc(50% + 2px)')
    fireEvent.pointerUp(a)
    expect(layout().open).toEqual(['a', 'b', 'c', 'd'])
  })
})

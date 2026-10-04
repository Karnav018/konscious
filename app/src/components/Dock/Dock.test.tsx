// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Dock } from './Dock'
import { setAppOn } from '../../state/commands/apps'
import { getState, initialState, useApp } from '../../state/store'

// The dock is draggable and its tiles are clickable, which are in tension:
// taking pointer capture on press retargets every later event — the click
// included — to the dock, so a tile never hears its own click. That shipped
// once. Capture must wait until a drag has actually begun.
describe('the dock does not swallow its own clicks', () => {
  let capture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    useApp.setState(initialState(), true)
    capture = vi.fn()
    Element.prototype.setPointerCapture = capture as unknown as Element['setPointerCapture']
    Element.prototype.releasePointerCapture = vi.fn() as unknown as Element['releasePointerCapture']
  })
  afterEach(cleanup)

  const press = (el: Element, x = 100, y = 100) =>
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: x, clientY: y })
  const move = (el: Element, x: number, y = 100) => fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y })

  it('takes no pointer capture on a plain press', () => {
    const r = render(<Dock />)
    press(r.container.querySelector('[data-dock]')!)
    expect(capture).not.toHaveBeenCalled()
  })

  it('still takes none for a press that barely moves', () => {
    const r = render(<Dock />)
    const dock = r.container.querySelector('[data-dock]')!
    press(dock, 100)
    move(dock, 102)
    expect(capture).not.toHaveBeenCalled()
  })

  it('takes capture once the pointer has really moved', () => {
    const r = render(<Dock />)
    const dock = r.container.querySelector('[data-dock]')!
    press(dock, 100)
    move(dock, 140)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('shows the Apps button even with every app switched off', () => {
    // Without it there is no way into the catalog but the keyboard, which is
    // how the dock looked empty on first run.
    const r = render(<Dock />)
    expect(r.container.querySelector('[data-dock]')).not.toBeNull()
    expect(r.getByTitle(/Apps/)).toBeTruthy()
  })

  it('opens the catalog when the Apps button is clicked', () => {
    const r = render(<Dock />)
    fireEvent.click(r.getByTitle(/Apps/))
    expect(getState().ui.appPanel).toBe('catalog')
  })

  it('puts a tile in the dock once an app is on', () => {
    setAppOn('water', true)
    const r = render(<Dock />)
    expect(r.getByTitle(/Drink water/)).toBeTruthy()
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { noDrag, paneCell, usePaneDrag } from './usePaneDrag'

// Two panes side by side: "a" left of x=100, "b" right of it. The hook maps a
// point to a pane through document.elementFromPoint, which happy-dom has no
// layout for, so the test supplies the hit test.
function Panes({ onDrop }: { onDrop: (id: string, targetId: string) => void }) {
  const { drag, handle } = usePaneDrag(onDrop)
  return (
    <>
      {['a', 'b'].map((id) => (
        <div key={id} {...paneCell(id)} data-testid={`pane-${id}`}>
          <div {...handle(id)} data-testid={`header-${id}`}>
            {drag?.id === id && 'dragging'}
            {drag?.over === id && 'drop-here'}
            <div {...noDrag} data-testid={`button-${id}`}>⋯</div>
          </div>
        </div>
      ))}
    </>
  )
}

const press = (el: Element, x = 10) => fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: x, clientY: 10 })
const move = (el: Element, x: number) => fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: 10 })
const release = (el: Element) => fireEvent.pointerUp(el, { pointerId: 1 })

describe('usePaneDrag', () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    document.elementFromPoint = ((x: number) =>
      document.querySelector(`[data-pane-id="${x < 100 ? 'a' : 'b'}"]`)) as typeof document.elementFromPoint
  })
  afterEach(cleanup)

  it('drops a pane on the one under the pointer', () => {
    const onDrop = vi.fn()
    const r = render(<Panes onDrop={onDrop} />)
    const header = r.getByTestId('header-a')
    press(header, 10)
    move(header, 150)
    expect(r.getByTestId('header-a').textContent).toContain('dragging')
    expect(r.getByTestId('header-b').textContent).toContain('drop-here')
    release(header)
    expect(onDrop).toHaveBeenCalledWith('a', 'b')
  })

  it('a press that barely moves is a click, not a reorder', () => {
    const onDrop = vi.fn()
    const r = render(<Panes onDrop={onDrop} />)
    const header = r.getByTestId('header-a')
    press(header, 10)
    move(header, 12) // inside the threshold
    release(header)
    expect(onDrop).not.toHaveBeenCalled()
    expect(r.getByTestId('header-a').textContent).not.toContain('dragging')
  })

  it('dropping a pane on itself changes nothing', () => {
    const onDrop = vi.fn()
    const r = render(<Panes onDrop={onDrop} />)
    const header = r.getByTestId('header-a')
    press(header, 10)
    move(header, 60) // still over "a"
    expect(r.getByTestId('header-a').textContent).toContain('dragging')
    expect(r.getByTestId('header-a').textContent).not.toContain('drop-here')
    release(header)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('Escape puts the pane back', () => {
    const onDrop = vi.fn()
    const r = render(<Panes onDrop={onDrop} />)
    const header = r.getByTestId('header-a')
    press(header, 10)
    move(header, 150)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(r.getByTestId('header-a').textContent).not.toContain('dragging')
    release(header)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('never starts from a header control, or from a non-primary button', () => {
    const onDrop = vi.fn()
    const r = render(<Panes onDrop={onDrop} />)
    const header = r.getByTestId('header-a')

    press(r.getByTestId('button-a'), 10) // the ⋯ button bubbles to the header
    move(header, 150)
    release(header)
    expect(onDrop).not.toHaveBeenCalled()

    fireEvent.pointerDown(header, { button: 2, pointerId: 1, clientX: 10, clientY: 10 })
    move(header, 150)
    release(header)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('leaves the cursor as it found it', () => {
    document.body.style.cursor = 'default'
    const r = render(<Panes onDrop={vi.fn()} />)
    const header = r.getByTestId('header-a')
    press(header, 10)
    move(header, 150)
    expect(document.body.style.cursor).toBe('grabbing')
    release(header)
    expect(document.body.style.cursor).toBe('default')
  })
})

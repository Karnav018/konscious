// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SPINNER_FRAMES, StatusGlyph } from './StatusGlyph'

describe('StatusGlyph', () => {
  afterEach(cleanup)

  it('renders the design spinner strip (CSS-animated) while working', () => {
    const { container } = render(<StatusGlyph status="working" />)
    const strip = container.querySelector('.cw-spinner-strip')!
    expect([...strip.children].map((c) => c.textContent)).toEqual([...SPINNER_FRAMES])
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Working')
  })

  it('is a static dot or ring otherwise', () => {
    const { container, rerender } = render(<StatusGlyph status="idle" />)
    expect(container.textContent).toBe('●')
    expect(container.querySelector('.cw-spinner')).toBeNull()
    rerender(<StatusGlyph status="completed" />)
    expect(container.textContent).toBe('○')
  })
})

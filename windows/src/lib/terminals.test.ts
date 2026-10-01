// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { autoFontSize } from './terminals'

describe('autoFontSize', () => {
  it('is the default size in every pane', () => {
    for (const w of [200, 460, 700, 1400]) expect(autoFontSize(w, 12, 0.6)).toBe(12)
  })
  it('follows the base size', () => {
    expect(autoFontSize(900, 14, 0.6)).toBe(14)
  })
})

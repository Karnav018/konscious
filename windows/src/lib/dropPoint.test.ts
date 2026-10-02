import { describe, expect, it } from 'vitest'

import { dropPoint } from './dropPoint'

describe('where a file drop landed', () => {
  it('uses macOS points as CSS pixels, whatever the Retina scale', () => {
    // A drop on the bottom-right pane of a 1440×900 window stays there.
    expect(dropPoint(1200, 700, 2, false)).toEqual({ x: 1200, y: 700 })
  })

  it('turns Windows screen pixels into CSS pixels', () => {
    expect(dropPoint(2400, 1400, 2, true)).toEqual({ x: 1200, y: 700 })
    expect(dropPoint(150, 90, 1.5, true)).toEqual({ x: 100, y: 60 })
    expect(dropPoint(100, 60, 0, true)).toEqual({ x: 100, y: 60 })
  })
})

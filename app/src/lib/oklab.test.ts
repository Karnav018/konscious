import { describe, expect, it } from 'vitest'

import { chroma, deltaE, fromLch, hexOf, hueAngle, oklab, rgbOf } from './oklab'

describe('reading a hex colour', () => {
  it('takes the long form and the short', () => {
    expect(rgbOf('#ffffff')).toEqual([1, 1, 1])
    expect(rgbOf('#000')).toEqual([0, 0, 0])
    expect(rgbOf('f00')).toEqual([1, 0, 0])
  })

  it('refuses anything else, because a bad token is a bug not a colour', () => {
    expect(() => rgbOf('#12345')).toThrow(/not a hex colour/)
    expect(() => rgbOf('rebeccapurple')).toThrow()
    expect(() => rgbOf('')).toThrow()
  })
})

describe('OKLab', () => {
  // Ottosson's reference values for the sRGB primaries.
  it('puts white at L 1 with no colour in it', () => {
    const w = oklab('#ffffff')
    expect(w.L).toBeCloseTo(1, 3)
    expect(chroma('#ffffff')).toBeCloseTo(0, 3)
  })

  it('puts black at L 0', () => {
    expect(oklab('#000000').L).toBeCloseTo(0, 3)
  })

  it('matches the published figure for sRGB red', () => {
    const r = oklab('#ff0000')
    expect(r.L).toBeCloseTo(0.6279, 3)
    expect(r.a).toBeCloseTo(0.2249, 3)
    expect(r.b).toBeCloseTo(0.1258, 3)
  })

  it('keeps grey grey at every level', () => {
    for (const g of ['#222222', '#808080', '#dddddd']) expect(chroma(g)).toBeCloseTo(0, 2)
  })

  it('reads hue angles round the wheel', () => {
    expect(hueAngle('#ff0000')).toBeCloseTo(29, 0)
    expect(hueAngle('#00ff00')).toBeCloseTo(142, 0)
    expect(hueAngle('#0000ff')).toBeCloseTo(264, 0)
  })
})

describe('distance', () => {
  it('is nothing between a colour and itself', () => {
    expect(deltaE('#8fce9f', '#8fce9f')).toBe(0)
  })

  it('does not care which way round', () => {
    expect(deltaE('#8fce9f', '#f07a7a')).toBeCloseTo(deltaE('#f07a7a', '#8fce9f'), 12)
  })

  it('separates colours a person would call different', () => {
    // Green and red, which is the whole point of the status palette.
    expect(deltaE('#8fce9f', '#f07a7a')).toBeGreaterThan(0.2)
  })

  it('reports the near-identical pair that started all this as near-identical', () => {
    // The first --sit against --ok. Different hex, same colour.
    expect(deltaE('#7fd6a8', '#8fce9f')).toBeLessThan(0.03)
  })

  it('stays small for a just-noticeable step', () => {
    expect(deltaE('#8fce9f', '#90cfa0')).toBeLessThan(0.01)
  })
})

describe('going back to sRGB', () => {
  it('round-trips a colour through Lab and out again', () => {
    for (const hex of ['#96ad35', '#ab8a72', '#212121', '#fbf5e5', '#c890a7']) {
      expect(hexOf(oklab(hex))).toBe(hex)
    }
  })

  it('builds a colour from lightness, chroma and hue', () => {
    const hex = hexOf(fromLch(0.71, 0.145, 120))
    expect(hex).not.toBeNull()
    expect(hueAngle(hex!)).toBeCloseTo(120, 0)
    expect(chroma(hex!)).toBeCloseTo(0.145, 2)
  })

  it('says nothing rather than clamp a colour outside the gamut', () => {
    // Far more chroma than sRGB can hold at that lightness.
    expect(hexOf(fromLch(0.5, 0.5, 140))).toBeNull()
  })
})

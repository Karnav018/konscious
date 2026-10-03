// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import {
  clampK,
  DEFAULT_K,
  effectiveK,
  isWarm,
  kelvinAt,
  multipliers,
  NEUTRAL_K,
  atLocalMinutes,
  kelvinFor,
  nextBoundary,
  paintWarmth,
  percentAt,
  WARMED_TOKENS,
  WARMEST_K,
  warmColor,
  warmStrength,
} from './warmth'

describe('colour temperature', () => {
  it('leaves everything alone at the neutral white point', () => {
    expect(multipliers(NEUTRAL_K)).toEqual([1, 1, 1])
    expect(isWarm(NEUTRAL_K)).toBe(false)
    expect(warmColor('#c890a7', NEUTRAL_K)).toBe('#c890a7')
    expect(warmColor('rgba(251, 245, 229, 0.075)', NEUTRAL_K)).toBe('rgba(251, 245, 229, 0.075)')
  })

  it('holds red and drops blue the warmer it gets', () => {
    const [r, g, b] = multipliers(DEFAULT_K)
    expect(r).toBe(1)
    expect(g).toBeGreaterThan(b)
    expect(g).toBeLessThan(1)
    // Warmer still means less of both, and never a negative channel.
    const warmest = multipliers(WARMEST_K)
    expect(warmest[1]).toBeLessThan(g)
    expect(warmest[2]).toBeLessThan(b)
    expect(warmest.every((x) => x >= 0 && x <= 1)).toBe(true)
  })

  it('warms hex and rgba, keeping the shape and the alpha', () => {
    expect(warmColor('#ffffff', DEFAULT_K)).toMatch(/^#ff[0-9a-f]{4}$/)
    expect(warmColor('#fff', DEFAULT_K)).toBe(warmColor('#ffffff', DEFAULT_K))
    expect(warmColor('rgba(251, 245, 229, 0.075)', DEFAULT_K)).toMatch(/^rgba\(251, \d+, \d+, 0\.075\)$/)
    expect(warmColor('rgb(10, 20, 30)', DEFAULT_K)).toMatch(/^rgb\(10, \d+, \d+\)$/)
  })

  it('never produces a colour outside the channel range', () => {
    for (const k of [WARMEST_K, 2500, DEFAULT_K, 5000, NEUTRAL_K]) {
      const out = warmColor('#ffffff', k)
      expect(out).toMatch(/^#[0-9a-f]{6}$/)
      expect(warmColor('#000000', k)).toBe('#000000') // black has nothing to warm
    }
  })

  it('passes through anything that is not a plain colour', () => {
    expect(warmColor('0 30px 80px rgba(0, 0, 0, 0.55)', DEFAULT_K)).toBe('0 30px 80px rgba(0, 0, 0, 0.55)')
    expect(warmColor('none', DEFAULT_K)).toBe('none')
    expect(warmColor('', DEFAULT_K)).toBe('')
  })
})

describe('the warmth setting', () => {
  it('clamps to the slider range and treats off as neutral', () => {
    expect(clampK(99_000)).toBe(NEUTRAL_K)
    expect(clampK(0)).toBe(WARMEST_K)
    expect(effectiveK(false, DEFAULT_K)).toBe(NEUTRAL_K)
    expect(effectiveK(true, DEFAULT_K)).toBe(DEFAULT_K)
  })

  it('maps slider position to temperature, right being warmer', () => {
    expect(kelvinAt(0)).toBe(NEUTRAL_K)
    expect(kelvinAt(100)).toBe(WARMEST_K)
    expect(kelvinAt(50)).toBeLessThan(NEUTRAL_K)
    expect(kelvinAt(50)).toBeGreaterThan(WARMEST_K)
    expect(percentAt(kelvinAt(40))).toBe(40)
    expect(percentAt(NEUTRAL_K)).toBe(0)
    expect(percentAt(WARMEST_K)).toBe(100)
  })

  it('keeps the status palette out of the warm pass', () => {
    // Reading "working / waiting / failed / idle" must not depend on the hour.
    for (const status of ['--ok', '--warn', '--err', '--info', '--addBg', '--delBg']) {
      expect(WARMED_TOKENS).not.toContain(status)
    }
    expect(WARMED_TOKENS).toContain('--pane')
    expect(WARMED_TOKENS).toContain('--text')
    expect(WARMED_TOKENS).toContain('--accent')
  })
})

describe('painting the window', () => {
  const root = document.documentElement
  // Stand in for tokens.css: the base palette the warm pass must read.
  const style = document.createElement('style')
  style.textContent = ':root { --pane: #292626; --text: #fbf5e5; --accent: #c890a7; --ok: #8fce9f; --err: #f07a7a; }'
  document.head.appendChild(style)
  const override = (token: string) => root.style.getPropertyValue(token)

  it('warms the tokens from the stylesheet and clears them again', () => {
    paintWarmth('dark', DEFAULT_K)
    expect(override('--pane')).toBe(warmColor('#292626', DEFAULT_K))
    expect(override('--text')).toBe(warmColor('#fbf5e5', DEFAULT_K))

    paintWarmth('dark', NEUTRAL_K)
    expect(override('--pane')).toBe('')
    expect(getComputedStyle(root).getPropertyValue('--pane').trim()).toBe('#292626')
  })

  it('never touches the status palette', () => {
    paintWarmth('dark', WARMEST_K)
    expect(override('--ok')).toBe('')
    expect(override('--err')).toBe('')
    expect(getComputedStyle(root).getPropertyValue('--ok').trim()).toBe('#8fce9f')
  })

  it('does not compound when warmed repeatedly', () => {
    paintWarmth('dark', DEFAULT_K)
    const once = override('--pane')
    paintWarmth('dark', 2600)
    paintWarmth('dark', 3000)
    paintWarmth('dark', DEFAULT_K)
    expect(override('--pane')).toBe(once)
  })
})

describe('when it warms', () => {
  // A window from 20:00 to 06:00, as instants on one day.
  const day = new Date(2026, 9, 3, 0, 0, 0, 0).getTime()
  const at = (h: number, m = 0) => day + h * 3_600_000 + m * 60_000
  const on = at(20)
  const off = at(6)

  it('is fully warm in the middle of the window and neutral outside it', () => {
    expect(warmStrength(at(23), on, off)).toBe(1)
    expect(warmStrength(at(2), on, off)).toBe(1)
    expect(warmStrength(at(13), on, off)).toBe(0)
    expect(warmStrength(at(9), on, off)).toBe(0)
  })

  it('eases across a boundary rather than snapping', () => {
    // Twenty minutes either side of 20:00.
    expect(warmStrength(at(19, 40), on, off)).toBeCloseTo(0, 2)
    expect(warmStrength(at(20), on, off)).toBeCloseTo(0.5, 2)
    expect(warmStrength(at(20, 20), on, off)).toBeCloseTo(1, 2)
    // And back down around 06:00.
    expect(warmStrength(at(5, 40), on, off)).toBeCloseTo(1, 2)
    expect(warmStrength(at(6), on, off)).toBeCloseTo(0.5, 2)
    expect(warmStrength(at(6, 20), on, off)).toBeCloseTo(0, 2)
  })

  it('handles a window that does not cross midnight', () => {
    const noon = at(11)
    const three = at(15)
    expect(warmStrength(at(13), noon, three)).toBe(1)
    expect(warmStrength(at(22), noon, three)).toBe(0)
    expect(warmStrength(at(3), noon, three)).toBe(0)
  })

  it('knows when the schedule next changes its mind', () => {
    expect(nextBoundary(at(23), on, off)).toBe(off + 86_400_000)
    expect(nextBoundary(at(13), on, off)).toBe(on)
    // An override taken out at dusk lasts until dawn, not for a fixed hour.
    expect(nextBoundary(at(21), on, off) - at(21)).toBeGreaterThan(8 * 3_600_000)
  })

  it('reads minutes from midnight on the right day', () => {
    expect(new Date(atLocalMinutes(at(13), 21 * 60)).getHours()).toBe(21)
    expect(new Date(atLocalMinutes(at(13), 0)).getHours()).toBe(0)
  })

  it('paints neutral at no strength and the chosen warmth at full', () => {
    expect(kelvinFor(3400, 0)).toBe(NEUTRAL_K)
    expect(kelvinFor(3400, 1)).toBe(3400)
    expect(kelvinFor(3400, 0.5)).toBe(Math.round((NEUTRAL_K + 3400) / 2))
    // Half warm is still warm enough to be rewriting tokens.
    expect(isWarm(kelvinFor(3400, 0.5))).toBe(true)
    expect(isWarm(kelvinFor(3400, 0))).toBe(false)
  })
})

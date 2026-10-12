import { describe, expect, it } from 'vitest'

import { envelope, GAIN, lengthMs, NOTES } from './chime'

describe('the nudge chime', () => {
  it('is two notes, rising', () => {
    expect(NOTES).toHaveLength(2)
    expect(NOTES[1].hz).toBeGreaterThan(NOTES[0].hz)
  })

  it('overlaps them, so it is one sound rather than two beeps', () => {
    const [first, second] = NOTES
    expect(second.atMs).toBeLessThan(first.atMs + first.forMs)
  })

  it('is over before you could look up', () => {
    expect(lengthMs()).toBeLessThan(250)
  })

  it('is quiet enough to live with', () => {
    // Loud enough to hear over a fan, quiet enough not to be the thing you
    // switch off. Anything near 1 would be a klaxon.
    expect(GAIN).toBeGreaterThan(0)
    expect(GAIN).toBeLessThan(0.15)
  })

  it('ramps rather than steps, because a square edge on a sine clicks', () => {
    const { start, peak, end } = envelope(NOTES[0], 10)
    expect(start).toBe(10)
    expect(peak).toBeGreaterThan(start)
    expect(peak - start).toBeLessThan(0.02)
    expect(end).toBeCloseTo(10 + NOTES[0].forMs / 1000, 6)
  })

  it('places the second note after the first begins', () => {
    const one = envelope(NOTES[0], 0)
    const two = envelope(NOTES[1], 0)
    expect(two.start).toBeGreaterThan(one.start)
    expect(two.end).toBeGreaterThan(one.end)
  })

  it('measures its own length from the last note to finish', () => {
    expect(lengthMs([{ hz: 440, atMs: 0, forMs: 50 }, { hz: 660, atMs: 500, forMs: 10 }])).toBe(510)
    expect(lengthMs([])).toBe(0)
  })
})

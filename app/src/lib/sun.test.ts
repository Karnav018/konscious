import { describe, expect, it } from 'vitest'

import { fromOffset, isPlace, placeFromTimezone, sunTimes } from './sun'

/** Hours past midnight UTC, which is how these are easiest to check. */
const utcHour = (ms: number) => new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60

describe('sunrise and sunset', () => {
  it('splits the day at six and six on the equator at the equinox', () => {
    const { sunrise, sunset } = sunTimes(Date.UTC(2026, 2, 20, 12), { lat: 0, lon: 0 })
    expect(utcHour(sunrise!)).toBeCloseTo(6, 0)
    expect(utcHour(sunset!)).toBeCloseTo(18, 0)
  })

  it('shifts with longitude: four minutes a degree', () => {
    const at = Date.UTC(2026, 2, 20, 12)
    const here = sunTimes(at, { lat: 0, lon: 0 }).sunset!
    const east = sunTimes(at, { lat: 0, lon: 15 }).sunset!
    // 15° east means the sun sets an hour earlier in UTC.
    expect(utcHour(here) - utcHour(east)).toBeCloseTo(1, 1)
  })

  it('gives a long northern day in June and a short one in December', () => {
    const berlin = { lat: 52.5, lon: 13.4 }
    const june = sunTimes(Date.UTC(2026, 5, 21, 12), berlin)
    const dec = sunTimes(Date.UTC(2026, 11, 21, 12), berlin)
    const length = (t: ReturnType<typeof sunTimes>) => (t.sunset! - t.sunrise!) / 3_600_000
    expect(length(june)).toBeGreaterThan(16)
    expect(length(dec)).toBeLessThan(8.5)
  })

  it('reports no sunset inside the Arctic circle in midsummer', () => {
    const tromso = sunTimes(Date.UTC(2026, 5, 21, 12), { lat: 69.65, lon: 18.96 })
    expect(tromso.sunrise).toBeNull()
    expect(tromso.sunset).toBeNull()
    expect(tromso.alwaysUp).toBe(true)
  })

  it('reports no sunrise there in midwinter', () => {
    const tromso = sunTimes(Date.UTC(2026, 11, 21, 12), { lat: 69.65, lon: 18.96 })
    expect(tromso.sunrise).toBeNull()
    expect(tromso.alwaysUp).toBe(false)
  })

  it('puts sunrise before sunset, every month, north and south', () => {
    for (const place of [{ lat: 22, lon: 77 }, { lat: -33.9, lon: 151.2 }]) {
      for (let m = 0; m < 12; m++) {
        const t = sunTimes(Date.UTC(2026, m, 15, 12), place)
        expect(t.sunset! - t.sunrise!).toBeGreaterThan(0)
      }
    }
  })
})

describe('where we think we are', () => {
  it('knows the common timezones', () => {
    expect(placeFromTimezone('Asia/Kolkata', 330)).toEqual({ lat: 22.0, lon: 77.0 })
    expect(placeFromTimezone('Europe/Berlin', 120)).toEqual({ lat: 51.2, lon: 10.4 })
    expect(placeFromTimezone('Australia/Sydney', 660).lat).toBeLessThan(0)
  })

  it('falls back to the UTC offset for one it does not', () => {
    expect(placeFromTimezone('Mars/Olympus', 330).lon).toBeCloseTo(82.5, 1)
    expect(fromOffset(-480)).toEqual({ lat: 35, lon: -120 })
    expect(fromOffset(0)).toEqual({ lat: 35, lon: 0 })
  })

  it('keeps a nonsense offset on the planet', () => {
    expect(Math.abs(fromOffset(99_999).lon)).toBeLessThanOrEqual(180)
  })

  it('recognises a usable place and rejects the rest', () => {
    expect(isPlace({ lat: 22, lon: 77 })).toBe(true)
    expect(isPlace({ lat: 99, lon: 0 })).toBe(false)
    expect(isPlace({ lat: 0, lon: 999 })).toBe(false)
    expect(isPlace({ lat: Number.NaN, lon: 0 })).toBe(false)
    expect(isPlace(null)).toBe(false)
  })
})

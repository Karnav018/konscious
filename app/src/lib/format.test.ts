import { describe, expect, it } from 'vitest'

import { ago, relTo, resetsIn, tildify, tokens } from './format'

describe('format', () => {
  it('shows compact relative times', () => {
    const now = new Date('2026-09-30T13:10:00').getTime()
    expect(ago(now - 10_000, now)).toBe('now')
    expect(ago(now - 6 * 60_000, now)).toBe('6m')
    expect(ago(new Date('2026-09-30T09:05:00').getTime(), now)).toBe('09:05')
    expect(ago(new Date('2026-09-29T09:05:00').getTime(), now)).toBe('yesterday')
  })

  it('shortens paths', () => {
    expect(tildify('/Users/k/projects/hawk', '/Users/k')).toBe('~/projects/hawk')
    expect(tildify('/Users/kx/a', '/Users/k')).toBe('/Users/kx/a')
    expect(relTo('/p/hawk/backend', '/p/hawk')).toBe('./backend')
    expect(relTo('/p/hawk', '/p/hawk')).toBe('.')
  })

  it('formats tokens and reset times', () => {
    expect(tokens(791_000)).toBe('791k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(null)).toBe('—')
    const now = new Date('2026-09-30T13:00:00').getTime()
    expect(resetsIn(now / 1000 + 2 * 3600 + 14 * 60, now)).toBe('resets in 2h 14m')
    expect(resetsIn(now / 1000 + 20 * 60, now)).toBe('resets in 20m')
    expect(resetsIn(new Date('2026-10-01T09:00:00').getTime() / 1000 + 86400, now)).toMatch(/^resets \w+ 09:00$/)
  })
})

import { describe, expect, it } from 'vitest'

import { byNewest, compareVersions, newest } from './features'

describe('which setting gets the title-bar button', () => {
  const theme = { id: 'theme', since: '0.1.0' }
  const warmth = { id: 'warmth', since: '0.2.0' }

  it('compares versions as numbers, not text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('1.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('is the newest feature; the rest stay in Settings', () => {
    expect(newest([theme, warmth])?.id).toBe('warmth')
    expect(byNewest([theme, warmth]).map((f) => f.id)).toEqual(['warmth', 'theme'])
  })

  it('moves to a feature that lands later, with nothing else changed', () => {
    const later = { id: 'later', since: '0.10.0' }
    expect(newest([theme, warmth, later])?.id).toBe('later')
    expect(byNewest([later, theme, warmth]).map((f) => f.id)).toEqual(['later', 'warmth', 'theme'])
  })
})

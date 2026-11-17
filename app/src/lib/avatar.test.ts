import { describe, expect, it } from 'vitest'

import { AVATAR_HUES, avatarOf } from './avatar'

describe('avatarOf', () => {
  it('is the same for the same name, whatever the case or spacing', () => {
    expect(avatarOf(' Auth Tests ')).toEqual(avatarOf('auth tests'))
  })

  it('is mirrored, inside the 5×5 grid, and never near-empty', () => {
    for (const name of ['Backend', 'Auth Tests', 'a', 'Terminal 2', 'RLS Research', '']) {
      const { cells, hue } = avatarOf(name)
      expect(cells.length).toBeGreaterThanOrEqual(3)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(AVATAR_HUES)
      const set = new Set(cells.map(([x, y]) => `${x},${y}`))
      for (const [x, y] of cells) {
        expect(x >= 0 && x <= 4 && y >= 0 && y <= 4).toBe(true)
        expect(set.has(`${4 - x},${y}`)).toBe(true)
      }
    }
  })

  it('tells different names apart', () => {
    const names = ['Backend', 'Frontend', 'Reviewer', 'Research', 'Auth Tests', 'Usage Chart', 'Docs', 'Migrations']
    const looks = new Set(names.map((n) => JSON.stringify(avatarOf(n))))
    expect(looks.size).toBe(names.length)
  })
})

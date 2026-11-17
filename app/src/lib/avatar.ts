// A session's pixel avatar: a 5×5 pattern mirrored left to right, in one of
// four hues, both drawn from its name, so the same name always looks the
// same. The hues (--av0…--av3 in tokens.css) stay clear of the status colours
// — green, amber, red, violet — so an avatar never reads as working or
// waiting. Pure, unit tested.

export const AVATAR_HUES = 4

/** FNV-1a: small, fast, and spreads short names well. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface Avatar {
  /** Filled cells as [x, y], each 0–4. */
  cells: [number, number][]
  hue: number
}

export function avatarOf(name: string): Avatar {
  const h = hash(name.trim().toLowerCase())
  const cells: [number, number][] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (!((h >>> (y * 3 + x)) & 1)) continue
      cells.push([x, y])
      if (x < 2) cells.push([4 - x, y])
    }
  }
  // A near-empty pattern says nothing; fill the spine so every avatar has a shape.
  if (cells.length < 6) for (let y = 1; y < 4; y++) if (!cells.some(([x, cy]) => x === 2 && cy === y)) cells.push([2, y])
  return { cells, hue: (h >>> 16) % AVATAR_HUES }
}

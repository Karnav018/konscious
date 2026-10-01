import { describe, expect, it } from 'vitest'

import { CAP, emptyLayout, gridDims, hidePane, openPane, toggleFocus, visiblePanes } from './grid'

const openMany = (ids: string[]) =>
  ids.reduce((l, id) => openPane(l, id).layout, emptyLayout())

describe('gridDims', () => {
  it('shapes the grid by count like the design', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => gridDims(n, false))).toEqual([
      { cols: 1, rows: 1 },
      { cols: 2, rows: 1 },
      { cols: 3, rows: 1 },
      { cols: 2, rows: 2 },
      { cols: 3, rows: 2 },
      { cols: 3, rows: 2 },
    ])
    expect(gridDims(5, true)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('openPane', () => {
  it('appends, selects and records recency', () => {
    const l = openMany(['a', 'b'])
    expect(l.open).toEqual(['a', 'b'])
    expect(l.selected).toBe('b')
    expect(l.recent).toEqual(['b', 'a'])
  })

  it('evicts the least recently used pane past the cap, never the new one', () => {
    let l = openMany(['a', 'b', 'c', 'd', 'e', 'f'])
    l = openPane(l, 'a').layout // a becomes most recent
    const { layout, evicted } = openPane(l, 'g')
    expect(evicted).toBe('b')
    expect(layout.open).toHaveLength(CAP)
    expect(layout.open).not.toContain('b')
    expect(layout.open).toContain('g')
    expect(layout.selected).toBe('g')
  })

  it('re-opening a visible pane never evicts', () => {
    const l = openMany(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(openPane(l, 'c').evicted).toBeNull()
  })
})

describe('focus and hide', () => {
  it('focus shows only the selected pane and toggles back', () => {
    const l = toggleFocus(openMany(['a', 'b', 'c']), 'b')
    expect(l.mode).toBe('focus')
    expect(visiblePanes(l)).toEqual(['b'])
    const back = toggleFocus(l, 'b')
    expect(back.mode).toBe('grid')
    expect(visiblePanes(back)).toEqual(['a', 'b', 'c'])
  })

  it('hiding the focused pane returns to the grid and reselects', () => {
    const l = hidePane(toggleFocus(openMany(['a', 'b']), 'b'), 'b')
    expect(l.mode).toBe('grid')
    expect(l.open).toEqual(['a'])
    expect(l.selected).toBe('a')
  })
})

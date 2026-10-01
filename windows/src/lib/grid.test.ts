import { describe, expect, it } from 'vitest'

import {
  CAP,
  emptyLayout,
  gridDims,
  hidePane,
  movePane,
  movePaneOnto,
  nudgePane,
  openPane,
  toggleFocus,
  visiblePanes,
} from './grid'

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

describe('reordering panes', () => {
  it('insert-and-shift: the dragged pane takes the slot, the rest slide along', () => {
    const l = openMany(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(movePaneOnto(l, 'a', 'c').open).toEqual(['b', 'c', 'a', 'd', 'e', 'f'])
    expect(movePaneOnto(l, 'f', 'a').open).toEqual(['f', 'a', 'b', 'c', 'd', 'e'])
  })

  it('keeps selection and recency — only the display order changes', () => {
    const l = openMany(['a', 'b', 'c'])
    const moved = movePaneOnto(l, 'c', 'a')
    expect(moved.selected).toBe(l.selected)
    expect(moved.recent).toEqual(l.recent)
    expect([...moved.open].sort()).toEqual(['a', 'b', 'c'])
  })

  it('clamps out-of-range targets and no-ops when nothing moves', () => {
    const l = openMany(['a', 'b', 'c'])
    expect(movePane(l, 'a', -5).open).toEqual(['a', 'b', 'c'])
    expect(movePane(l, 'a', 99).open).toEqual(['b', 'c', 'a'])
    expect(movePane(l, 'b', 1)).toBe(l)
    expect(movePaneOnto(l, 'b', 'b')).toBe(l)
  })

  it('ignores panes that are not open', () => {
    const l = openMany(['a', 'b'])
    expect(movePane(l, 'zz', 0)).toBe(l)
    expect(movePaneOnto(l, 'a', 'zz')).toBe(l)
    expect(nudgePane(l, 'zz', 1)).toBe(l)
  })

  it('nudges one slot and stops at the ends', () => {
    const l = openMany(['a', 'b', 'c'])
    expect(nudgePane(l, 'b', 1).open).toEqual(['a', 'c', 'b'])
    expect(nudgePane(l, 'b', -1).open).toEqual(['b', 'a', 'c'])
    expect(nudgePane(l, 'a', -1)).toBe(l)
    expect(nudgePane(l, 'c', 1)).toBe(l)
  })
})

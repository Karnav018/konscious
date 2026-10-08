import { describe, expect, it } from 'vitest'

import type { GridLayoutId, Kind } from '../types'
import {
  arrange,
  arrangementKey,
  cycleFrom,
  type Divider,
  dividerBetween,
  fits,
  GRID_LAYOUTS,
  layRects,
  layTree,
  normalize,
  regroup,
  resizeSplit,
  setWeights,
  suggestFor,
  unavailable,
} from './layouts'

const C: Kind = 'claude'
const T: Kind = 'shell'
const round = (r: { x: number; y: number; w: number; h: number }) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10)
const rectsOf = (id: GridLayoutId, kinds: Kind[]) => arrange(id, kinds).rects.sort((a, b) => a.i - b.i).map(round)
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ i, terminal: false }))
const seg = (ds: Divider[], row: boolean, side: number) => ds.find((d) => d.cross && d.row === row && d.cross.side === side)!

describe('every layout', () => {
  it('fills the stage with every pane exactly once, 1 to 6 panes', () => {
    for (const { id } of GRID_LAYOUTS) {
      for (let n = 1; n <= 6; n++) {
        const kinds = Array.from({ length: n }, (_, i) => (i % 3 === 2 ? T : C))
        const { rects } = arrange(id, kinds)
        expect(rects.map((r) => r.i).sort()).toEqual(kinds.map((_, i) => i))
        expect(rects.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(100 * 100, 6)
      }
    }
  })

  it('one pane fills the stage, with nothing to drag', () => {
    for (const { id } of GRID_LAYOUTS) {
      const { rects, dividers } = arrange(id, [C])
      expect(rects.map(round)).toEqual([[0, 0, 100, 100]])
      expect(dividers).toEqual([])
    }
  })
})

describe('the arrangements', () => {
  it('balanced rows: three across, then two rows in columns', () => {
    expect(rectsOf('balanced', [C, C, C])).toEqual([[0, 0, 33.3, 100], [33.3, 0, 33.3, 100], [66.7, 0, 33.3, 100]])
    expect(rectsOf('balanced', [C, C, C, C])).toEqual([[0, 0, 50, 50], [50, 0, 50, 50], [0, 50, 50, 50], [50, 50, 50, 50]])
    // Five: 2 + 2 + 1, the last pane full height.
    expect(rectsOf('balanced', [C, C, C, C, C])).toEqual([
      [0, 0, 33.3, 50], [33.3, 0, 33.3, 50], [66.7, 0, 33.3, 100],
      [0, 50, 33.3, 50], [33.3, 50, 33.3, 50],
    ])
  })

  it('lead + stack: the first pane leads, the rest stack beside it', () => {
    expect(rectsOf('lead', [C, C, C])).toEqual([[0, 0, 60, 100], [60, 0, 40, 50], [60, 50, 40, 50]])
    const six = rectsOf('lead', [C, C, C, C, C, C])
    expect(six[0][2]).toBeCloseTo(52.4, 1)
    expect(six.slice(1).every(([, , w]) => w < 25)).toBe(true)
  })

  it('column stacks: terminals are shorter than sessions', () => {
    const r = rectsOf('columns', [C, C, C, T])
    expect(r[1]).toEqual([50, 0, 50, 62.5])
    expect(r[3]).toEqual([50, 62.5, 50, 37.5])
  })

  it('terminal strip: sessions on top, terminals in one row below', () => {
    const r = rectsOf('strip', [C, T, C, T])
    expect(r[0]).toEqual([0, 0, 50, 70])
    expect(r[2]).toEqual([50, 0, 50, 70])
    expect(r[1]).toEqual([0, 70, 50, 30])
    expect(r[3]).toEqual([50, 70, 50, 30])
  })

  it('terminal strip with only terminals: one across the bottom, the rest above', () => {
    expect(rectsOf('strip', [T, T, T])).toEqual([[0, 0, 50, 70], [50, 0, 50, 70], [0, 70, 100, 30]])
    expect(rectsOf('strip', [T, T])).toEqual([[0, 0, 100, 70], [0, 70, 100, 30]])
    // Five: four as 2 × 2 above, the fifth the strip.
    expect(rectsOf('strip', [T, T, T, T, T])[4]).toEqual([0, 70, 100, 30])
    expect(rectsOf('strip', [T, T, T, T, T])[0]).toEqual([0, 0, 50, 35])
  })

  it('free splits: each new pane halves the biggest one, across its longer side', () => {
    expect(rectsOf('free', [C, C])).toEqual([[0, 0, 50, 100], [50, 0, 50, 100]])
    expect(rectsOf('free', [C, C, C])).toEqual([[0, 0, 50, 50], [50, 0, 50, 100], [0, 50, 50, 50]])
  })

  it('trees are kept simple: a row in a row joins it', () => {
    const t = normalize({ dir: 'row', kids: [{ leaf: 0 }, { dir: 'row', kids: [{ leaf: 1 }, { leaf: 2 }], w: [1, 1] }], w: [2, 2] })
    expect(t).toEqual({ dir: 'row', kids: [{ leaf: 0 }, { leaf: 1 }, { leaf: 2 }], w: [0.5, 0.25, 0.25] })
  })
})

describe('gaps', () => {
  it('a gap between two groups of as many panes comes in one segment per pair', () => {
    const { dividers } = arrange('balanced', [C, C, C, C])
    // 2 × 2 as columns: each column's height gap is its own…
    const plain = dividers.filter((d) => !d.cross)
    expect(plain.map((d) => [d.row, d.a, d.b])).toEqual([[false, [0], [2]], [false, [1], [3]]])
    // …and the width gap between the columns comes in two, one per row.
    expect(seg(dividers, true, 0)).toMatchObject({ from: 0, len: 50, a: [0], b: [1] })
    expect(seg(dividers, true, 1)).toMatchObject({ from: 50, len: 50, a: [2], b: [3] })
  })

  it('so does a strip of terminals under as many sessions', () => {
    const { dividers } = arrange('strip', [C, C, T, T])
    expect(dividers.filter((d) => d.cross).map((d) => [d.a, d.b])).toEqual([[[0], [2]], [[1], [3]]])
  })

  it('groups of different sizes share their gap: there is no other way', () => {
    // Three sessions over two terminals; the lead pane beside its stack.
    expect(arrange('strip', [C, C, C, T, T]).dividers.some((d) => d.cross)).toBe(false)
    expect(arrange('lead', [C, C, C]).dividers.some((d) => d.cross)).toBe(false)
  })

  it('dragged weights reshape their split', () => {
    const tree = layTree('balanced', items(2))
    expect(layRects(setWeights(tree, 'r', [3, 1])).rects.map(round)).toEqual([[0, 0, 75, 100], [75, 0, 25, 100]])
  })

  it('a drag trades space between the two panes, down to the minimum', () => {
    expect(resizeSplit([0.5, 0.5], 0, 200, 1000, 240)).toEqual([0.7, 0.30000000000000004])
    expect(resizeSplit([0.5, 0.5], 0, 900, 1000, 240)[1]).toBeCloseTo(0.24)
    expect(resizeSplit([0.2, 0.2, 0.6], 0, -500, 1000, 240)[0]).toBeCloseTo(0.18)
  })
})

describe('the gap you grab decides', () => {
  const pane = (tree: ReturnType<typeof layTree>, i: number) => round(layRects(tree).rects.find((r) => r.i === i)!)

  it('grabbing the width gap in one row pairs the rows up: heights meet in the middle', () => {
    // Columns with their own heights: left 60/40, right 40/60.
    let tree = layTree('balanced', items(4))
    tree = setWeights(setWeights(tree, 'r.0', [0.6, 0.4]), 'r.1', [0.4, 0.6])
    const r = regroup(tree, seg(layRects(tree).dividers, true, 0))!
    expect([r.a, r.b]).toEqual([[0], [1]])
    expect(pane(r.tree, 0)).toEqual([0, 0, 50, 50])
    expect(pane(r.tree, 3)).toEqual([50, 50, 50, 50])
    // Now the top row's gap is its own: dragging it leaves the bottom row alone.
    const top = dividerBetween(layRects(r.tree).dividers, true, r.a, r.b)!
    const moved = setWeights(r.tree, top.path, [0.7, 0.3])
    expect(pane(moved, 0)).toEqual([0, 0, 70, 50])
    expect(pane(moved, 2)).toEqual([0, 50, 50, 50])
  })

  it('and back: grabbing a height gap pairs the columns up again', () => {
    let tree = layTree('balanced', items(4))
    tree = regroup(tree, seg(layRects(tree).dividers, true, 0))!.tree
    const top = dividerBetween(layRects(tree).dividers, true, [0], [1])!
    tree = setWeights(tree, top.path, [0.7, 0.3])
    // Rows: top 70/30, bottom 50/50. The height gap comes in two segments.
    const under1 = seg(layRects(tree).dividers, false, 1)
    expect([under1.a, under1.b]).toEqual([[1], [3]])
    const r = regroup(tree, under1)!
    // The two rows' column lines (70 and 50) meet at 60.
    expect(pane(r.tree, 1)).toEqual([60, 0, 40, 50])
    expect(pane(r.tree, 2)).toEqual([0, 50, 60, 50])
  })

  it('works the same with terminals: a session and the terminal under it', () => {
    const tree = layTree('strip', [{ i: 0, terminal: false }, { i: 1, terminal: false }, { i: 2, terminal: true }, { i: 3, terminal: true }])
    const r = regroup(tree, seg(layRects(tree).dividers, false, 0))!
    const gap = dividerBetween(layRects(r.tree).dividers, false, r.a, r.b)!
    const moved = setWeights(r.tree, gap.path, [0.5, 0.5])
    expect(pane(moved, 0)).toEqual([0, 0, 50, 50])
    // The other session keeps its 70%.
    expect(pane(moved, 1)).toEqual([50, 0, 50, 70])
  })

  it('in a split of three, only the two grabbed groups pair up', () => {
    // Six panes as three columns of two: grab the gap between the first two.
    const tree = layTree('balanced', items(6))
    const r = regroup(tree, seg(layRects(tree).dividers, true, 0))!
    expect(pane(r.tree, 2)).toEqual([66.7, 0, 33.3, 50])
    expect(fits(r.tree, 6)).toBe(true)
  })

  it('a gap beside a single pane has nothing to pair', () => {
    const tree = layTree('lead', items(3))
    expect(regroup(tree, layRects(tree).dividers[0])).toBeNull()
  })
})

describe('saved arrangements', () => {
  it('are used only when they fit the panes', () => {
    const two = layTree('balanced', items(2))
    expect(fits(two, 2)).toBe(true)
    expect(fits(two, 3)).toBe(false)
    expect(fits({ dir: 'row', kids: [{ leaf: 0 }, { leaf: 0 }], w: [1, 1] }, 2)).toBe(false)
    expect(fits({ dir: 'row', kids: [{ leaf: 0 }, { leaf: 1 }], w: [1, -1] }, 2)).toBe(false)
    const saved = { 'balanced:2': setWeights(two, 'r', [3, 1]) }
    expect(arrange('balanced', [C, C], saved).rects[0].w).toBe(75)
    expect(arrange('balanced', [C, C], saved).dragged).toBe(true)
    expect(arrange('balanced', [C, C, C], saved).dragged).toBe(false)
  })
})

describe('choosing a layout', () => {
  it('arrangements are kept per pane count, or per session/terminal order where that matters', () => {
    expect(arrangementKey('balanced', [C, T, C])).toBe('balanced:3')
    expect(arrangementKey('strip', [C, T, C])).toBe('strip:CTC')
    expect(arrangementKey('columns', [T, C])).toBe('columns:TC')
  })

  it('the strip needs a terminal, and nothing more', () => {
    expect(unavailable('strip', 3, 0)).toBe('Needs a terminal in the grid')
    expect(unavailable('strip', 2, 2)).toBe('')
    expect(unavailable('strip', 3, 1)).toBe('')
    expect(unavailable('lead', 1, 0)).toBe('Layouts apply from 2 panes')
  })

  it('suggests a layout for the panes there are', () => {
    expect(suggestFor(2, 0).id).toBe('balanced')
    expect(suggestFor(3, 1).id).toBe('columns')
    expect(suggestFor(4, 2).id).toBe('strip')
    expect(suggestFor(5, 0).id).toBe('balanced')
    expect(suggestFor(5, 1).id).toBe('columns')
    expect(suggestFor(6, 3).id).toBe('strip')
  })

  it('cycling skips layouts that cannot be used, both ways', () => {
    expect(cycleFrom('columns', 1, 3, 0)).toBe('free')
    expect(cycleFrom('free', 1, 3, 0)).toBe('balanced')
    expect(cycleFrom('balanced', -1, 3, 0)).toBe('free')
    expect(cycleFrom('balanced', 1, 1, 0)).toBeNull()
  })
})

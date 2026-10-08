// Grid layouts: how 2–6 panes share the stage. Each layout is a split tree
// (rows of columns of rows…); the tree becomes pane rectangles plus the
// dividers between them, which drag to resize. Dragging can also regroup the
// tree, so that a gap resizes just the two panes beside it (see regroup).
// Pure functions — unit tested.
import type { GridLayoutId, Kind, LayoutNode } from '../types'

export interface GridLayoutInfo {
  id: GridLayoutId
  name: string
  short: string
}

export const GRID_LAYOUTS: GridLayoutInfo[] = [
  { id: 'balanced', name: 'Balanced rows', short: 'Rows' },
  { id: 'lead', name: 'Lead + stack', short: 'Lead' },
  { id: 'columns', name: 'Column stacks', short: 'Columns' },
  { id: 'strip', name: 'Terminal strip', short: 'Strip' },
  { id: 'free', name: 'Free splits', short: 'Free' },
]

export const DEFAULT_GRID: GridLayoutId = 'balanced'
export const isGridLayout = (v: unknown): v is GridLayoutId => GRID_LAYOUTS.some((g) => g.id === v)
export const layoutInfo = (id: GridLayoutId) => GRID_LAYOUTS.find((g) => g.id === id) ?? GRID_LAYOUTS[0]

/** A pane as the layouts see it: its place in the grid order, and whether it's a terminal. */
export interface Item {
  i: number
  terminal: boolean
}

/** A leaf is a pane (its index in the grid order); a split lays its kids out
 *  in a row or a column, sized by weight. */
export type Node = LayoutNode
type Split = Extract<Node, { dir: unknown }>

const L = (it: Item): Node => ({ leaf: it.i })
const S = (dir: 'row' | 'col', kids: Node[], w?: number[]): Split => ({ dir, kids, w: w ?? kids.map(() => 1) })
const row = (arr: Item[]): Node => (arr.length === 1 ? L(arr[0]) : S('row', arr.map(L)))
const col = (arr: Item[]): Node => (arr.length === 1 ? L(arr[0]) : S('col', arr.map(L)))
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0)

/** Up to three across; past that, two rows in columns: four as 2 × 2, six as
 *  3 × 2, five as 2 + 2 + 1 (the last pane full height). */
const balanced = (arr: Item[]): Node => {
  if (arr.length <= 3) return row(arr)
  const a = arr.length === 4 ? 2 : 3
  return S('row', arr.slice(0, a).map((top, i) => (arr[i + a] ? col([top, arr[i + a]]) : L(top))))
}

/** The layout's own arrangement, before any dragging. */
export function layTree(id: GridLayoutId, items: Item[]): Node {
  return normalize(build(id, items))
}

function build(id: GridLayoutId, items: Item[]): Node {
  const n = items.length
  if (n === 0) return { leaf: -1 }
  if (n === 1) return L(items[0])
  switch (id) {
    case 'balanced':
      return balanced(items)
    case 'lead': {
      // The first pane leads; the rest stack beside it (in two stacks past three).
      const [first, ...rest] = items
      const half = Math.ceil(rest.length / 2)
      const stack = rest.length > 3 ? S('row', [col(rest.slice(0, half)), col(rest.slice(half))]) : col(rest)
      return S('row', [L(first), stack], [rest.length > 3 ? 1.1 : 1.5, 1])
    }
    case 'columns': {
      // Panes deal into columns; a terminal is shorter than a session.
      const c = n <= 3 ? n : n === 4 ? 2 : 3
      const stacks: Item[][] = Array.from({ length: c }, () => [])
      items.forEach((it, k) => stacks[k % c].push(it))
      return S('row', stacks.map((a) => (a.length === 1 ? L(a[0]) : S('col', a.map(L), a.map((t) => (t.terminal ? 0.6 : 1))))))
    }
    case 'strip': {
      // Sessions on top, every terminal in one strip along the bottom. With
      // only terminals, the last one is the strip and the rest sit above it.
      const sessions = items.filter((t) => !t.terminal)
      const terminals = items.filter((t) => t.terminal)
      if (!terminals.length) return balanced(items)
      const top = sessions.length ? sessions : terminals.slice(0, -1)
      const strip = sessions.length ? terminals : terminals.slice(-1)
      return S('col', [balanced(top), row(strip)], [0.7, 0.3])
    }
    case 'free': {
      // Each new pane splits the biggest one, across its longer side (the
      // stage is about 1.6 times as wide as it is tall).
      let tree: Node = L(items[0])
      for (let k = 1; k < n; k++) {
        const { rects } = layRects(tree)
        const big = rects.reduce((a, b) => (b.w * 1.6 * b.h > a.w * 1.6 * a.h ? b : a))
        const dir = big.w * 1.6 >= big.h ? 'row' : 'col'
        const split = (node: Node): Node =>
          'leaf' in node ? (node.leaf === big.i ? S(dir, [{ leaf: big.i }, L(items[k])]) : node) : { ...node, kids: node.kids.map(split) }
        tree = split(tree)
      }
      return tree
    }
  }
}

/** The same picture with the fewest splits: a row inside a row (or column in
 *  a column) joins its parent, and a split of one is just its kid. */
export function normalize(n: Node): Node {
  if ('leaf' in n) return n
  const kids: Node[] = []
  const w: number[] = []
  const tot = sum(n.w)
  n.kids.forEach((k0, i) => {
    const k = normalize(k0)
    if (!('leaf' in k) && k.dir === n.dir) {
      const t = sum(k.w)
      k.kids.forEach((kk, j) => {
        kids.push(kk)
        w.push(((n.w[i] / tot) * k.w[j]) / t)
      })
    } else {
      kids.push(k)
      w.push(n.w[i] / tot)
    }
  })
  return kids.length === 1 ? kids[0] : { dir: n.dir, kids, w }
}

/** A pane's place, in percent of the stage. */
export interface Rect {
  i: number
  x: number
  y: number
  w: number
  h: number
}

/** The gap between two neighbours of one split, draggable. */
export interface Divider {
  /** The split it belongs to ("r", "r.0", "r.1.0", …). */
  path: string
  /** Between kid k and kid k + 1. */
  k: number
  /** A row split: the divider is vertical and drags left and right. */
  row: boolean
  /** Where it sits along the drag axis, and where it starts and how long it is across it (percent). */
  at: number
  from: number
  len: number
  /** The split's size along the drag axis (percent of the stage). */
  span: number
  /** The split's weights, summing to 1. */
  w: number[]
  /** The panes on either side (of this segment). */
  a: number[]
  b: number[]
  /** A gap between two groups of as many panes each comes in segments, one
   *  per pair: dragging one regroups the tree so that only that pair changes. */
  cross?: { side: number }
}

const leavesOf = (n: Node): number[] => ('leaf' in n ? [n.leaf] : n.kids.flatMap(leavesOf))
/** Two kids whose gap can be cut into pairs: both split the other way, as many kids each. */
const pairable = (dir: 'row' | 'col', x: Node, y: Node): x is Split =>
  !('leaf' in x) && !('leaf' in y) && x.dir !== dir && y.dir !== dir && x.kids.length === y.kids.length

export function layRects(tree: Node): { rects: Rect[]; dividers: Divider[] } {
  const rects: Rect[] = []
  const plain: Divider[] = []
  const crossing: { d: Divider; xs: number[][]; ys: number[][] }[] = []
  const walk = (node: Node, r: Omit<Rect, 'i'>, path: string) => {
    if ('leaf' in node) {
      if (node.leaf >= 0) rects.push({ i: node.leaf, ...r })
      return
    }
    const tot = sum(node.w)
    const isRow = node.dir === 'row'
    let off = 0
    node.kids.forEach((kid, k) => {
      const f = node.w[k] / tot
      const cr = isRow ? { x: r.x + off * r.w, y: r.y, w: f * r.w, h: r.h } : { x: r.x, y: r.y + off * r.h, w: r.w, h: f * r.h }
      if (k > 0) {
        const prev = node.kids[k - 1]
        const d: Divider = {
          path,
          k: k - 1,
          row: isRow,
          at: isRow ? cr.x : cr.y,
          from: isRow ? r.y : r.x,
          len: isRow ? r.h : r.w,
          span: isRow ? r.w : r.h,
          w: node.w.map((v) => v / tot),
          a: leavesOf(prev),
          b: leavesOf(kid),
        }
        if (pairable(node.dir, prev, kid) && !('leaf' in kid)) crossing.push({ d, xs: prev.kids.map(leavesOf), ys: kid.kids.map(leavesOf) })
        else plain.push(d)
      }
      walk(kid, cr, `${path}.${k}`)
      off += f
    })
  }
  walk(tree, { x: 0, y: 0, w: 100, h: 100 }, 'r')

  // Cut each such gap at the lines the pairs would share (the middle of the
  // two groups' own lines), one segment per pair.
  const at = new Map(rects.map((x) => [x.i, x]))
  const end = (leaves: number[], rowGap: boolean) =>
    Math.max(...leaves.map((i) => (rowGap ? at.get(i)!.y + at.get(i)!.h : at.get(i)!.x + at.get(i)!.w)))
  const segments = crossing.flatMap(({ d, xs, ys }) => {
    const cuts = xs.slice(0, -1).map((x, j) => (end(x, d.row) + end(ys[j], d.row)) / 2)
    const edges = [d.from, ...cuts, d.from + d.len]
    return xs.map((x, j) => ({ ...d, from: edges[j], len: edges[j + 1] - edges[j], a: x, b: ys[j], cross: { side: j } }))
  })
  return { rects, dividers: [...plain, ...segments] }
}

/* ── editing a tree ──────────────────────────────────────────────── */

const kidIndex = (path: string) => path.split('.').slice(1).map(Number)

function nodeAt(tree: Node, path: string): Node | null {
  let n: Node | undefined = tree
  for (const k of kidIndex(path)) n = n && !('leaf' in n) ? n.kids[k] : undefined
  return n ?? null
}

function replaceAt(tree: Node, path: string, next: Node): Node {
  const go = (n: Node, ks: number[]): Node => {
    if (!ks.length) return next
    if ('leaf' in n) return n
    return { ...n, kids: n.kids.map((kid, i) => (i === ks[0] ? go(kid, ks.slice(1)) : kid)) }
  }
  return go(tree, kidIndex(path))
}

/** New weights for one split (a dragged or double-clicked divider). */
export function setWeights(tree: Node, path: string, w: number[]): Node {
  const n = nodeAt(tree, path)
  if (!n || 'leaf' in n || n.kids.length !== w.length) return tree
  return replaceAt(tree, path, { ...n, w })
}

/**
 * Starting to drag one segment of a gap between two groups (X, Y) of as many
 * panes each: X and Y become pairs — X's first with Y's first, and so on —
 * so the dragged pair can change on its own. The dragged direction stays
 * exactly where it was; the other one lines up on the middle of the two
 * groups' lines (they can't stay apart without the panes overlapping).
 * Returns the new tree and the two panes groups whose gap is now dragged.
 */
export function regroup(tree: Node, d: Divider): { tree: Node; a: number[]; b: number[] } | null {
  if (!d.cross) return null
  const p = nodeAt(tree, d.path)
  if (!p || 'leaf' in p) return null
  const x = p.kids[d.k]
  const y = p.kids[d.k + 1]
  if (!x || !y || !pairable(p.dir, x, y) || 'leaf' in y) return null
  const pw = p.w[d.k] + p.w[d.k + 1]
  const fx = p.w[d.k] / pw
  const tx = sum(x.w)
  const ty = sum(y.w)
  const pairs: Split = {
    dir: x.dir,
    kids: x.kids.map((xk, j) => ({ dir: p.dir, kids: [xk, y.kids[j]], w: [fx, 1 - fx] })),
    w: x.kids.map((_, j) => (x.w[j] / tx + y.w[j] / ty) / 2),
  }
  const nextP: Node =
    p.kids.length === 2
      ? pairs
      : {
          ...p,
          kids: [...p.kids.slice(0, d.k), pairs, ...p.kids.slice(d.k + 2)],
          w: [...p.w.slice(0, d.k), pw, ...p.w.slice(d.k + 2)],
        }
  return {
    tree: normalize(replaceAt(tree, d.path, nextP)),
    a: leavesOf(x.kids[d.cross.side]),
    b: leavesOf(y.kids[d.cross.side]),
  }
}

/** The divider between these two groups of panes in a laid-out tree. */
export function dividerBetween(dividers: Divider[], row: boolean, a: number[], b: number[]): Divider | null {
  const A = new Set(a)
  const B = new Set(b)
  return dividers.find((d) => d.row === row && d.a.length > 0 && d.b.length > 0 && d.a.every((i) => A.has(i)) && d.b.every((i) => B.has(i))) ?? null
}

/** A saved tree fits these panes: every pane exactly once, sane weights. */
export function fits(tree: Node | undefined, n: number): tree is Node {
  if (!tree) return false
  const seen: number[] = []
  const ok = (t: Node): boolean => {
    if ('leaf' in t) {
      seen.push(t.leaf)
      return Number.isInteger(t.leaf)
    }
    return (
      t.kids.length >= 2 &&
      t.w.length === t.kids.length &&
      t.w.every((v) => Number.isFinite(v) && v > 0) &&
      t.kids.every(ok)
    )
  }
  return ok(tree) && seen.length === n && [...seen].sort((p, q) => p - q).every((v, i) => v === i)
}

/** Dragged arrangements are kept per pane count, or for the layouts that
 *  place terminals differently, per order of sessions and terminals. */
export function arrangementKey(id: GridLayoutId, kinds: readonly Kind[]): string {
  return id === 'strip' || id === 'columns' ? `${id}:${kinds.map((k) => (k === 'shell' ? 'T' : 'C')).join('')}` : `${id}:${kinds.length}`
}

/** Narrowest a pane may be dragged to (px), unless the pair can't spare it. */
export const MIN_W = 240
export const MIN_H = 140

/**
 * New weights after dragging divider `k` by `deltaPx`. `spanPx` is the split's
 * size on screen; the two panes either side trade space, neither going below
 * the minimum (or 45% of what the two share, when that is less).
 */
export function resizeSplit(w0: readonly number[], k: number, deltaPx: number, spanPx: number, minPx: number): number[] {
  const pair = w0[k] + w0[k + 1]
  const minF = Math.min(0.45 * pair, minPx / Math.max(1, spanPx))
  const a = Math.max(minF, Math.min(pair - minF, w0[k] + deltaPx / Math.max(1, spanPx)))
  const w = [...w0]
  w[k] = a
  w[k + 1] = pair - a
  return w
}

/** Why a layout can't be used for these panes, or '' when it can. */
export function unavailable(id: GridLayoutId, n: number, terminals: number): string {
  if (n < 2) return 'Layouts apply from 2 panes'
  if (id === 'strip' && !terminals) return 'Needs a terminal in the grid'
  return ''
}

/** The layout that fits this many panes (with this many terminals) best, and why. */
export function suggestFor(n: number, t: number): { id: GridLayoutId; why: string } {
  const c = n - t
  if (n <= 2) return { id: 'balanced', why: 'Two panes side by side, equal width.' }
  if (n === 3) return t ? { id: 'columns', why: 'The terminal stacks under a session, shorter.' } : { id: 'balanced', why: 'Three across fits without stacking.' }
  if (n === 4) {
    return t >= 2 && c >= 2
      ? { id: 'strip', why: 'Sessions on top, both terminals in one strip.' }
      : { id: 'balanced', why: 'A 2 × 2 grid keeps every pane the same size.' }
  }
  if (n === 5) {
    if (t >= 2) return { id: 'strip', why: 'Three sessions across, two terminals below.' }
    return t ? { id: 'columns', why: 'The terminal stacks under a session, shorter.' } : { id: 'balanced', why: 'Three columns, each sized on its own.' }
  }
  return t >= 2 && c >= 3 ? { id: 'strip', why: 'Sessions in two rows, terminals in the strip.' } : { id: 'balanced', why: 'Three across, two rows, all equal.' }
}

/** The next usable layout after `cur` (dir 1) or before it (dir −1); null if none is. */
export function cycleFrom(cur: GridLayoutId, dir: 1 | -1, n: number, t: number): GridLayoutId | null {
  const len = GRID_LAYOUTS.length
  const i = GRID_LAYOUTS.findIndex((g) => g.id === cur)
  for (let s = 1; s <= len; s++) {
    const g = GRID_LAYOUTS[(((i + dir * s) % len) + len) % len].id
    if (!unavailable(g, n, t)) return g
  }
  return null
}

/** The tree in use: the dragged one saved for this arrangement, else the layout's own. */
export function treeFor(id: GridLayoutId, kinds: readonly Kind[], saved: Record<string, Node>): { key: string; tree: Node; dragged: boolean } {
  const key = arrangementKey(id, kinds)
  const mine = saved[key]
  if (fits(mine, kinds.length)) return { key, tree: mine, dragged: true }
  return {
    key,
    tree: layTree(
      id,
      kinds.map((k, i) => ({ i, terminal: k === 'shell' })),
    ),
    dragged: false,
  }
}

/** Everything the grid needs for these panes in this layout. */
export function arrange(id: GridLayoutId, kinds: readonly Kind[], saved: Record<string, Node> = {}) {
  const t = treeFor(id, kinds, saved)
  return { ...t, ...layRects(t.tree) }
}

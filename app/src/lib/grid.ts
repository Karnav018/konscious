// Pane-grid rules from the design: the grid shapes itself by pane count and
// holds at most CAP panes; opening one more hides the least recently used
// pane (its process keeps running). Pure functions — unit tested.
import type { Layout } from '../types'
import { DEFAULT_GRID } from './layouts'

export const CAP = 6

export const emptyLayout = (): Layout => ({ mode: 'grid', open: [], recent: [], selected: null, grid: DEFAULT_GRID, trees: {} })

/** 1–3 panes side by side, 4 → 2×2, 5–6 → 3×2; Focus is always 1×1. */
export function gridDims(n: number, focus: boolean): { cols: number; rows: number } {
  if (focus || n <= 1) return { cols: 1, rows: 1 }
  if (n <= 3) return { cols: n, rows: 1 }
  if (n === 4) return { cols: 2, rows: 2 }
  return { cols: 3, rows: 2 }
}

const touch = (recent: string[], id: string) => [id, ...recent.filter((r) => r !== id)]

/** Shows `id` in the grid and selects it; evicts the least recently used pane past CAP. */
export function openPane(layout: Layout, id: string): { layout: Layout; evicted: string | null } {
  const recent = touch(layout.recent, id)
  let open = layout.open.includes(id) ? layout.open : [...layout.open, id]
  let evicted: string | null = null
  if (open.length > CAP) {
    const rank = (x: string) => {
      const i = recent.indexOf(x)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    evicted = open.filter((x) => x !== id).sort((a, b) => rank(b) - rank(a))[0] ?? null
    open = open.filter((x) => x !== evicted)
  }
  return { layout: { ...layout, open, recent, selected: id }, evicted }
}

/** Selecting an already-open pane: no reordering, just recency. */
export function selectPane(layout: Layout, id: string): Layout {
  if (layout.selected === id && layout.recent[0] === id) return layout
  return { ...layout, selected: id, recent: touch(layout.recent, id) }
}

/** Moves an open pane to `to`, sliding the panes in between along (the panes
 *  keep their slots; only the order changes). Out-of-range `to` is clamped. */
export function movePane(layout: Layout, id: string, to: number): Layout {
  const from = layout.open.indexOf(id)
  if (from < 0) return layout
  const target = Math.min(layout.open.length - 1, Math.max(0, to))
  if (target === from) return layout
  const open = layout.open.filter((x) => x !== id)
  open.splice(target, 0, id)
  return { ...layout, open }
}

/** Dropping `id` on `targetId`: `id` takes that slot, the rest shift along. */
export function movePaneOnto(layout: Layout, id: string, targetId: string): Layout {
  const to = layout.open.indexOf(targetId)
  return to < 0 ? layout : movePane(layout, id, to)
}

/** One slot left (−1) or right (+1); at either end it does nothing. */
export function nudgePane(layout: Layout, id: string, delta: number): Layout {
  const from = layout.open.indexOf(id)
  return from < 0 ? layout : movePane(layout, id, from + delta)
}

/** Hides a pane. Leaves Focus if the focused pane was hidden. */
export function hidePane(layout: Layout, id: string): Layout {
  const open = layout.open.filter((x) => x !== id)
  const selected = layout.selected === id ? (open[0] ?? null) : layout.selected
  const mode = layout.mode === 'focus' && layout.selected === id ? 'grid' : layout.mode
  return { ...layout, open, selected, mode }
}

/** Forgets a session entirely (removed from the workspace). */
export function dropSession(layout: Layout, id: string): Layout {
  const hidden = hidePane(layout, id)
  return { ...hidden, recent: hidden.recent.filter((x) => x !== id) }
}

/** ⌘↵ — focus the pane, or return to the grid if it is already focused. */
export function toggleFocus(layout: Layout, id: string): Layout {
  if (layout.mode === 'focus') return { ...layout, mode: 'grid', selected: id }
  const opened = openPane(layout, id).layout
  return { ...opened, mode: 'focus' }
}

export function visiblePanes(layout: Layout): string[] {
  if (layout.mode !== 'focus') return layout.open
  const one = layout.selected && layout.open.includes(layout.selected) ? layout.selected : layout.open[0]
  return one ? [one] : []
}

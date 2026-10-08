// Grid commands. The rules themselves are pure functions in lib/grid.ts;
// these apply them to the committed state.
import {
  emptyLayout,
  hidePane as hideIn,
  movePaneOnto as moveOntoIn,
  nudgePane as nudgeIn,
  openPane as openIn,
  selectPane as selectIn,
  toggleFocus as focusIn,
} from '../../lib/grid'
import type { GridLayoutId, Layout, LayoutMode, LayoutNode } from '../../types'
import { act } from '../act'
import { touchWorkspace } from './touch'
import { getState } from '../store'

export const layoutOf = (byWorkspace: Record<string, Layout>, wsId: string | null): Layout =>
  (wsId && byWorkspace[wsId]) || EMPTY
const EMPTY = emptyLayout()

function apply(type: string, wsId: string, fn: (l: Layout) => Layout) {
  const cur = layoutOf(getState().layout.byWorkspace, wsId)
  const next = fn(cur)
  if (next === cur) return
  act(type, (d) => {
    d.layout.byWorkspace[wsId] = next
  })
}

/** Shows a session in its workspace grid; returns the pane evicted past the cap. */
export function openPane(id: string): string | null {
  const meta = getState().workspace.sessions[id]
  if (!meta) return null
  const r = openIn(layoutOf(getState().layout.byWorkspace, meta.workspaceId), id)
  act('layout/openPane', (d) => {
    d.layout.byWorkspace[meta.workspaceId] = r.layout
    d.workspace.activeId = meta.workspaceId
    touchWorkspace(d, meta.workspaceId)
    d.ui.wsMenu = false
    d.ui.renaming = false
    d.ui.paneMenu = null
  })
  return r.evicted
}

export function selectPane(id: string) {
  const meta = getState().workspace.sessions[id]
  if (meta) apply('layout/selectPane', meta.workspaceId, (l) => selectIn(l, id))
}

export function hidePane(id: string) {
  const meta = getState().workspace.sessions[id]
  if (!meta) return
  apply('layout/hidePane', meta.workspaceId, (l) => hideIn(l, id))
  act('ui/closePaneMenu', (d) => {
    d.ui.paneMenu = null
  })
}

/** Drag-and-drop: `id` lands in `targetId`'s slot, the panes between shift. */
export function movePaneOnto(id: string, targetId: string) {
  const meta = getState().workspace.sessions[id]
  if (!meta || id === targetId) return
  apply('layout/movePane', meta.workspaceId, (l) => moveOntoIn(l, id, targetId))
}

/** "Move left"/"Move right" and ⌘⇧←/→: one slot, no wrap. */
export function nudgePane(id: string, delta: number) {
  const meta = getState().workspace.sessions[id]
  if (meta) apply('layout/nudgePane', meta.workspaceId, (l) => nudgeIn(l, id, delta))
}

export function toggleFocus(wsId: string, id: string) {
  apply('layout/toggleFocus', wsId, (l) => focusIn(l, id))
}

export function setMode(wsId: string, mode: LayoutMode) {
  apply('layout/setMode', wsId, (l) => (l.mode === mode ? l : { ...l, mode }))
}

/** Picking a layout shows the grid in it (from Focus too). */
export function setGridLayout(wsId: string, grid: GridLayoutId) {
  apply('layout/grid', wsId, (l) => (l.grid === grid && l.mode === 'grid' ? l : { ...l, grid, mode: 'grid' }))
}

/** A dragged (or regrouped) arrangement, kept for these panes. */
export function setLayoutTree(wsId: string, key: string, tree: LayoutNode) {
  apply('layout/resize', wsId, (l) => ({ ...l, trees: { ...l.trees, [key]: tree } }))
}

/** ⌘⇧= and the menu: the layout's own arrangement again, at even sizes. */
export function evenOutLayout(wsId: string, key: string) {
  apply('layout/evenOut', wsId, (l) => {
    if (!l.trees[key]) return l
    const { [key]: _gone, ...trees } = l.trees
    return { ...l, trees }
  })
}

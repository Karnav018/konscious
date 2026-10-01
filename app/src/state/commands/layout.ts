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
import type { Layout, LayoutMode } from '../../types'
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

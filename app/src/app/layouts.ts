// Grid layout actions: picking and cycling layouts, evening out sizes. The
// geometry is in lib/layouts.ts; this applies it to the active workspace.
import { arrangementKey, cycleFrom, unavailable } from '../lib/layouts'
import { evenOutLayout, layoutOf, setGridLayout } from '../state/commands/layout'
import { setNotesOpen } from '../state/commands/notes'
import { flash, setLayoutMenu, settleLayoutNudge, showLayoutHud } from '../state/commands/ui'
import { type AppState, getState } from '../state/store'
import type { GridLayoutId } from '../types'

/** The active workspace's grid panes as the layouts see them. */
export function gridPanes(s: AppState = getState()) {
  const wsId = s.workspace.activeId
  const layout = layoutOf(s.layout.byWorkspace, wsId)
  const kinds = layout.open.map((id) => s.workspace.sessions[id]?.kind ?? 'claude')
  const terminals = kinds.filter((k) => k === 'shell').length
  return { wsId, layout, kinds, n: kinds.length, terminals, countKey: `${kinds.length}:${terminals}` }
}

/** Shows the grid in `id`. `hud`: also flash its picture (keys, the nudge). */
export function pickGridLayout(id: GridLayoutId, opts: { hud?: boolean } = {}) {
  const g = gridPanes()
  if (!g.wsId) return
  const why = unavailable(id, g.n, g.terminals)
  if (why) {
    flash(why)
    return
  }
  if (getState().ui.notesOpen) setNotesOpen(false)
  setGridLayout(g.wsId, id)
  settleLayoutNudge(g.countKey)
  setLayoutMenu(false)
  if (opts.hud) showLayoutHud()
}

/** ⌘L / ⌘⇧L: the next (or previous) layout these panes can use. */
export function cycleGridLayout(dir: 1 | -1) {
  const g = gridPanes()
  if (!g.wsId) return
  const next = cycleFrom(g.layout.grid, dir, g.n, g.terminals)
  if (next) pickGridLayout(next, { hud: true })
  else flash(unavailable(g.layout.grid, g.n, g.terminals) || 'No other layout fits these panes')
}

/** ⌘⇧= and the menu: every pane of this arrangement back to even sizes. */
export function evenOutPanes() {
  const g = gridPanes()
  if (!g.wsId) return
  evenOutLayout(g.wsId, arrangementKey(g.layout.grid, g.kinds))
  setLayoutMenu(false)
  flash('Sizes evened out')
}

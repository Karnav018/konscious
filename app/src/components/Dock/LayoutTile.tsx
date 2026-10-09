// The dock's layout tile: a picture of how the grid is arranged right now.
// Click for the Grid layout menu (five layouts, the suggested one marked, Even
// out sizes). When the mix of panes changes and another layout would fit
// better, a card next to the tile suggests it once.
import { useEffect, useRef } from 'react'

import { evenOutPanes, gridPanes, pickGridLayout } from '../../app/layouts'
import { type Edge, isVertical } from '../../lib/apps'
import { GRID_LAYOUTS, layoutInfo, suggestFor, treeFor, unavailable } from '../../lib/layouts'
import { IS_PC } from '../../lib/platform'
import { setLayoutMenu, settleLayoutNudge, showLayoutNudge } from '../../state/commands/ui'
import { useActiveLayout, useActiveWorkspaceId, useSessions, useUi } from '../../state/selectors'
import { getState } from '../../state/store'
import { CheckIcon } from '../common/Icon'
import { LayoutGlyph } from '../common/LayoutGlyph'

const CYCLE_KEY = IS_PC ? 'Ctrl+Shift+L' : '⌘L'
const pickKey = (i: number) => (IS_PC ? '' : `⌘⌥${i + 1}`)
const EVEN_KEY = IS_PC ? '' : '⌘⇧='

export function LayoutTile({ edge, size }: { edge: Edge; size: number }) {
  const wsId = useActiveWorkspaceId()
  const layout = useActiveLayout()
  const sessions = useSessions()
  const notesOpen = useUi((u) => u.notesOpen)
  const menu = useUi((u) => u.layoutMenu)
  const nudge = useUi((u) => u.layoutNudge)

  const kinds = layout.open.map((id) => sessions[id]?.kind ?? 'claude')
  const n = kinds.length
  const t = kinds.filter((k) => k === 'shell').length
  const countKey = `${n}:${t}`
  const selected = layout.selected ? layout.open.indexOf(layout.selected) : -1
  // The arrangement in use, when dragging changed it.
  const inUse = treeFor(layout.grid, kinds, layout.trees)
  const dragged = inUse.dragged ? inUse.tree : undefined
  const sug = suggestFor(n, t)
  const gridMode = layout.mode === 'grid' && !notesOpen
  const cur = layoutInfo(layout.grid)

  // The pane mix changed in this workspace: suggest a better fit, once.
  const prev = useRef<{ ws: string | null; key: string } | null>(null)
  useEffect(() => {
    const p = prev.current
    prev.current = { ws: wsId, key: countKey }
    if (!p || p.key === countKey) return
    const { show, seen } = getState().ui.layoutNudge
    if (show && show !== countKey) showLayoutNudge(null)
    const g = gridPanes()
    const s = suggestFor(g.n, g.terminals)
    const inGrid = g.layout.mode === 'grid' && !getState().ui.notesOpen
    if (p.ws === wsId && inGrid && g.n >= 2 && s.id !== g.layout.grid && !seen[countKey]) showLayoutNudge(countKey)
  }, [wsId, countKey])

  const nudgeActive = nudge.show === countKey && sug.id !== layout.grid && gridMode
  const nudgeOn = nudgeActive && !menu
  const nudgeDot = !nudgeActive && sug.id !== layout.grid && n >= 2 && gridMode && !nudge.seen[countKey]

  const side = isVertical(edge)
    ? { [edge === 'right' ? 'right' : 'left']: size + 14 }
    : { [edge === 'bottom' ? 'bottom' : 'top']: size + 14 }
  const along = isVertical(edge) ? { top: -8 } : { right: -8 }
  const sugName = layoutInfo(sug.id).name

  return (
    <div style={{ position: 'relative' }}>
      {nudgeDot && (
        <span
          className="absolute z-[2] w-2 h-2 rounded-full"
          style={{ top: -2, right: -2, background: 'var(--accent)', border: '2px solid var(--raised)' }}
        />
      )}
      {nudgeOn && (
        <div
          data-dock-popover
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', ...side, ...along, width: 236, boxShadow: 'var(--shadow)', borderColor: 'var(--accent)', cursor: 'default' }}
          className="pl-3 pr-2.5 py-2.5 bg-raised border rounded-r z-[39] flex flex-col gap-2"
          role="dialog"
          aria-label="Layout suggestion"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5" style={{ color: 'var(--accent)' }}>
              <LayoutGlyph id={sug.id} kinds={kinds} selected={selected} width={34} height={23} />
            </span>
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[12.5px] font-medium">
                {n} panes now — try {sugName}
              </span>
              <span className="text-[11.5px] text-muted leading-[1.4]">{sug.why}</span>
            </div>
          </div>
          <div className="flex gap-1.5 justify-end">
            <div
              onClick={() => settleLayoutNudge(countKey)}
              className="h-[26px] px-2.5 flex items-center rounded-rs border border-line2 text-[12px] text-muted cursor-pointer hover:text-text"
            >
              Keep {cur.short}
            </div>
            <div
              onClick={() => pickGridLayout(sug.id, { hud: true })}
              className="h-[26px] px-2.5 flex items-center rounded-rs text-[12px] font-medium cursor-pointer"
              style={{ background: 'var(--accent)', color: 'var(--accentInk)' }}
            >
              Use it
            </div>
          </div>
        </div>
      )}

      <div
        onClick={(e) => {
          e.stopPropagation()
          setLayoutMenu(!menu)
        }}
        title={`Layout · ${cur.name} (${CYCLE_KEY})`}
        aria-label="Grid layout"
        style={{
          width: size,
          height: size,
          borderRadius: 7,
          background: menu ? 'var(--sel)' : 'var(--accentSoft)',
          boxShadow: 'inset 0 0 0 1.5px var(--accent)',
          color: 'var(--accent)',
        }}
        className="grid place-items-center cursor-pointer hover:bg-sel"
      >
        <LayoutGlyph id={layout.grid} kinds={kinds} selected={selected} tree={dragged} width={20} height={14} border={1.4} />
      </div>

      {menu && wsId && (
        <div
          data-dock-popover
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', ...side, ...along, width: 256, boxShadow: 'var(--shadow)', cursor: 'default' }}
          className="p-1.5 bg-raised border border-line2 rounded-r z-[40] flex flex-col gap-px"
          role="menu"
          aria-label="Grid layout"
        >
          <div className="flex items-baseline justify-between px-2 py-1.5">
            <span className="text-[12.5px] font-medium">Grid layout</span>
            <span className="font-mono text-[10.5px] text-faint">
              {n} pane{n === 1 ? '' : 's'}
              {t ? ` · ${t} terminal${t > 1 ? 's' : ''}` : ''}
            </span>
          </div>
          <div className="px-2 pb-1.5 text-[11px] text-muted leading-[1.4]">
            {n < 2
              ? 'One pane fills the grid. Layouts apply from 2.'
              : sug.id === layout.grid
                ? `You’re on the best fit for ${n} panes.`
                : `${sugName} fits ${n} panes best.`}
          </div>
          {GRID_LAYOUTS.map((g, i) => {
            const na = unavailable(g.id, n, t)
            const on = g.id === layout.grid
            const isSug = g.id === sug.id && n >= 2
            const why = na || (isSug ? sug.why : '')
            return (
              <div
                key={g.id}
                role="menuitemradio"
                aria-checked={on}
                aria-disabled={!!na}
                onClick={() => !na && pickGridLayout(g.id)}
                title={na || g.name}
                className="flex items-center gap-2.5 min-h-9 px-2 py-1 rounded-rs hover:bg-sel"
                style={{
                  cursor: na ? 'not-allowed' : 'pointer',
                  opacity: na ? 0.45 : 1,
                  background: on ? 'var(--accentSoft)' : undefined,
                  color: on ? 'var(--accent)' : 'var(--muted)',
                }}
              >
                <LayoutGlyph id={g.id} kinds={kinds} selected={selected} tree={on ? dragged : undefined} width={30} height={20} />
                <div className="flex-1 min-w-0 flex flex-col gap-px">
                  <span className="text-[12.5px]" style={{ color: na ? 'var(--muted)' : 'var(--text)' }}>
                    {g.name}
                  </span>
                  {why && <span className="text-[10.5px] text-faint whitespace-nowrap overflow-hidden text-ellipsis">{why}</span>}
                </div>
                {isSug && (
                  <span
                    className="px-1.5 rounded-pill text-[10px] font-medium leading-4 flex-none"
                    style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
                  >
                    Suggested
                  </span>
                )}
                {on && <CheckIcon size={12} style={{ color: 'var(--accent)' }} />}
                <span className="font-mono text-[10px] text-faint min-w-[30px] text-right">{pickKey(i)}</span>
              </div>
            )
          })}
          <div className="h-px bg-line mx-0.5 my-1" />
          <div
            role="menuitem"
            onClick={evenOutPanes}
            className="flex items-center justify-between h-[30px] px-2 rounded-rs cursor-pointer text-[12px] hover:bg-sel"
            style={{ color: dragged ? 'var(--text)' : 'var(--faint)' }}
          >
            <span>Even out sizes</span>
            <span className="font-mono text-[10px] text-faint">{EVEN_KEY}</span>
          </div>
          <div className="px-2 pt-1 pb-1.5 text-[11px] text-faint leading-[1.4]">
            Drag any gap between panes to resize. {CYCLE_KEY} cycles layouts.
          </div>
        </div>
      )}
    </div>
  )
}

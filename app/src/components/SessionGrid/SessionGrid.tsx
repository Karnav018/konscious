// The stage: panes placed by the workspace's grid layout (lib/layouts.ts),
// with a draggable divider in every gap. Panes are positioned, not reflowed,
// so a pane never moves in the DOM when the order or layout changes — its
// terminal keeps its focus — and moves and size changes glide. A pane being
// dragged to another slot follows the pointer while the others slide over to
// show where it will land.
import { useCallback, useEffect, useRef, useState } from 'react'

import { movePaneOnto } from '../../app/actions'
import { movePaneOnto as reorderOnto, visiblePanes } from '../../lib/grid'
import {
  arrange,
  type Divider,
  dividerBetween,
  layRects,
  MIN_H,
  MIN_W,
  type Node,
  type Rect,
  regroup,
  resizeSplit,
  setWeights,
} from '../../lib/layouts'
import { setLayoutTree } from '../../state/commands/layout'
import { useActiveLayout, useActiveWorkspaceId, useSessions } from '../../state/selectors'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { SessionPane } from '../SessionPane/SessionPane'
import { usePaneDrag } from './usePaneDrag'

/** The gap between panes (px). */
const GAP = 4
const EASE = 'cubic-bezier(.2,.8,.1,1)'
const GLIDE = ['left', 'top', 'width', 'height', 'transform'].map((p) => `${p} .35s ${EASE}`).join(', ')
const FULL = { rects: [{ i: 0, x: 0, y: 0, w: 100, h: 100 }], dividers: [] as Divider[], key: '', tree: { leaf: 0 } as Node }
/** A drag this short is still a click (no rebuild, no resize). */
const SLOP = 3
/** How long the pointer rests on a gap before it lights up: sweeping across
 *  the panes to get to another one passes over gaps without a flicker. */
const HOVER_INTENT_MS = 1000

/** Percent for CSS, without float noise (55.00000000000001%). */
const pc = (v: number) => `${+v.toFixed(4)}%`

const divId = (d: Divider) => `${d.path}:${d.k}${d.cross ? `:${d.cross.side}` : ''}`

export function SessionGrid() {
  const wsId = useActiveWorkspaceId()
  const layout = useActiveLayout()
  const sessions = useSessions()
  const visible = visiblePanes(layout)
  const focus = layout.mode === 'focus'
  const kindsOf = (ids: string[]) => ids.map((id) => sessions[id]?.kind ?? 'claude')
  const single = focus || visible.length < 2
  const rest = single ? FULL : arrange(layout.grid, kindsOf(visible), layout.trees)
  const box = useRef<HTMLDivElement>(null)

  // Where each pane's slot was when a pane drag began: what the pointer is
  // over is read from these, not from the panes sliding about on screen.
  const slots = useRef<{ order: string[]; rects: Rect[] }>({ order: [], rects: [] })
  const slotAt = useCallback((x: number, y: number) => {
    const b = box.current?.getBoundingClientRect()
    if (!b?.width || !b.height) return null
    const px = ((x - b.left) / b.width) * 100
    const py = ((y - b.top) / b.height) * 100
    const s = slots.current.rects.find((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
    return s ? (slots.current.order[s.i] ?? null) : null
  }, [])
  const { drag, handle } = usePaneDrag(movePaneOnto, slotAt)
  if (!drag) slots.current = { order: visible, rects: rest.rects }

  // While dragging: the order it would make, the others already in place.
  const shown = drag?.over ? reorderOnto({ ...layout, open: visible }, drag.id, drag.over).open : visible
  const { key, tree, rects, dividers } = shown === visible ? rest : arrange(layout.grid, kindsOf(shown), layout.trees)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const [resizing, setResizing] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const restOn = (id: string) => {
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHover(id), HOVER_INTENT_MS)
  }
  const leave = (id: string) => {
    clearTimeout(hoverTimer.current)
    setHover((h) => (h === id ? null : h))
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), [])
  // Nothing to reorder when one pane fills the stage.
  const reorderable = !focus && visible.length > 1

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const active = dividers.find((d) => divId(d) === (resizing ?? hover))
  const lit = new Set(active ? [...active.a, ...active.b] : [])

  const startResize = (e: React.PointerEvent, d: Divider) => {
    if (e.button !== 0 || !wsId) return
    e.preventDefault()
    e.stopPropagation()
    clearTimeout(hoverTimer.current)
    const el = box.current
    if (!el) return
    const start = d.row ? e.clientX : e.clientY
    const spanOf = (x: Divider) => ((x.row ? el.clientWidth : el.clientHeight) * x.span) / 100
    // The arrangement as the drag found it. A segment of a gap between two
    // groups regroups it on the first real move, so only its pair changes.
    let base: Node = tree
    let target: Divider | null = d.cross ? null : d
    let moved = false
    const move = (ev: PointerEvent) => {
      const delta = (d.row ? ev.clientX : ev.clientY) - start
      if (!moved && Math.abs(delta) < SLOP) return
      moved = true
      if (!target) {
        const pairs = regroup(tree, d)
        if (!pairs) return
        base = pairs.tree
        target = dividerBetween(layRects(base).dividers, d.row, pairs.a, pairs.b)
        if (!target) return
      }
      setLayoutTree(wsId, key, setWeights(base, target.path, resizeSplit(target.w, target.k, delta, spanOf(target), d.row ? MIN_W : MIN_H)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      setResizing(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    document.body.style.cursor = d.row ? 'col-resize' : 'row-resize'
    setResizing(divId(d))
  }

  // A stable DOM order: reordering or re-laying out only moves boxes.
  const order = [...visible].sort()

  return (
    <div className="flex-1 min-h-0 relative">
      <div ref={box} className="absolute" style={{ inset: -GAP / 2 }} data-grid>
        {order.map((id) => {
          const i = shown.indexOf(id)
          const carried = drag?.id === id
          // The carried pane stays the size of the slot it came from and
          // follows the pointer; dropped, it glides into its new slot.
          const r = carried
            ? (slots.current.rects.find((x) => x.i === slots.current.order.indexOf(id)) ?? FULL.rects[0])
            : (rects.find((x) => x.i === i) ?? FULL.rects[0])
          const showSize = !!resizing && lit.has(i)
          return (
            <div
              key={id}
              className="absolute grid"
              style={{
                left: `calc(${pc(r.x)} + ${GAP / 2}px)`,
                top: `calc(${pc(r.y)} + ${GAP / 2}px)`,
                width: `calc(${pc(r.w)} - ${GAP}px)`,
                height: `calc(${pc(r.h)} - ${GAP}px)`,
                transform: carried ? `translate(${drag.dx}px, ${drag.dy}px)` : 'none',
                zIndex: carried ? 10 : undefined,
                transition: resizing || carried ? 'none' : GLIDE,
              }}
            >
              <ErrorBoundary compact label={`pane ${id}`}>
                <SessionPane
                  id={id}
                  selected={id === layout.selected}
                  multi={layout.open.length > 1}
                  focused={focus}
                  highlight={lit.has(i)}
                  reorder={
                    reorderable
                      ? {
                          handle: handle(id),
                          canLeft: i > 0,
                          canRight: i < visible.length - 1,
                          dragging: carried,
                        }
                      : null
                  }
                />
              </ErrorBoundary>
              {showSize && (
                <div
                  className="absolute inset-0 z-[4] grid place-items-center pointer-events-none rounded-r"
                  style={{ background: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}
                >
                  <span
                    className="px-[9px] py-[3px] rounded-rs border font-mono text-[11.5px] shadow-pop"
                    style={{
                      borderColor: 'var(--accent)',
                      background: id === layout.selected ? 'var(--accent)' : 'var(--raised)',
                      color: id === layout.selected ? 'var(--accentInk)' : 'var(--text)',
                    }}
                  >
                    {Math.round((size.w * r.w) / 100 - GAP)} × {Math.round((size.h * r.h) / 100 - GAP)}
                  </span>
                </div>
              )}
            </div>
          )
        })}

        {!drag && dividers.map((d) => {
          const id = divId(d)
          const on = resizing === id || (!resizing && hover === id)
          return (
            <div
              key={id}
              role="separator"
              aria-orientation={d.row ? 'vertical' : 'horizontal'}
              aria-label="Resize panes"
              title="Drag to resize · double-click to even out"
              onPointerDown={(e) => startResize(e, d)}
              onPointerEnter={() => restOn(id)}
              onPointerLeave={() => leave(id)}
              onDoubleClick={() => wsId && setLayoutTree(wsId, key, setWeights(tree, d.path, d.w.map(() => 1)))}
              className="absolute z-[3] grid place-items-center rounded-[4px]"
              style={{
                left: d.row ? `calc(${pc(d.at)} - 4px)` : pc(d.from),
                top: d.row ? pc(d.from) : `calc(${pc(d.at)} - 4px)`,
                width: d.row ? 8 : pc(d.len),
                height: d.row ? pc(d.len) : 8,
                cursor: d.row ? 'col-resize' : 'row-resize',
                background: on ? 'var(--accentSoft)' : undefined,
                transition: resizing ? 'none' : GLIDE,
              }}
            >
              <span
                className="rounded-[2px] transition-colors duration-150"
                style={{
                  width: d.row ? 3 : 36,
                  height: d.row ? 36 : 3,
                  background: on ? 'var(--accent)' : 'transparent',
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

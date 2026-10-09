// The mini apps dock: a floating strip on one edge of the window.
//
// From the design of 3 Oct 2026. It floats over the grid and takes no width
// from it, which is the whole reason an app does not get a pane. Apps sits at
// the top, then the apps pinned to it. A due reminder fills its tile and has
// already raised one system notification (app/reminders.ts); clicking it opens
// a popover with what to do about it.
//
// Tiles are square and carry the app's own hue. Sessions are round and carry
// the four status colours. The two never meet.
import { useEffect, useRef, useState } from 'react'

import {
  alongEdge,
  APPS,
  appById,
  type AppId,
  BREAK_CHOICES,
  type Edge,
  FOCUS_CHOICES,
  isDue,
  isVertical,
  nearestEdge,
  nextDueAt,
  pomoClock,
  pomoLeft,
  pomoProgress,
} from '../../lib/apps'
import { clock } from '../../lib/format'
import { kbdShift } from '../../lib/platform'
import { isWarm } from '../../lib/warmth'
import { WarmthRow } from '../Settings/Settings'
import {
  acknowledge,
  setAppPanel,
  setAppPopover,
  setDockPlace,
  setPomoLength,
  skip,
  snooze,
  startPomo,
  stopPomoTimer,
} from '../../state/commands/apps'
import { useRuntimes, useUi } from '../../state/selectors'
import { AppsIcon, DropIcon, FlameIcon, StandIcon, TomatoIcon } from '../common/Icon'
import { Gauge, Ring } from './Gauge'
import { LayoutTile } from './LayoutTile'

/** How long untouched before an auto-minimising dock shrinks to just Apps. */
const TUCK_MS = 3000
// Geometry straight from the prototype. A tile is a 30px hit area holding a
// 24px coloured square; the gauge is taller because it carries its reading.
const TILE = 30
const GLYPH = 24
const GAUGE_H = 44
/** Below this a press is a click on a tile, not a drag of the dock. */
const DRAG_THRESHOLD = 4

type ReminderId = 'water' | 'stand'
const isReminderId = (id: AppId): id is ReminderId => id === 'water' || id === 'stand'

/** While dragging, a bar along the edge the dock will snap to. */
function EdgeGuide({ edge }: { edge: Edge }) {
  const bar: Record<Edge, React.CSSProperties> = {
    right: { left: 'calc(100% - 3px)', top: 8, width: 3, height: 'calc(100% - 16px)' },
    left: { left: 0, top: 8, width: 3, height: 'calc(100% - 16px)' },
    top: { left: 8, top: 0, width: 'calc(100% - 16px)', height: 3 },
    bottom: { left: 8, top: 'calc(100% - 3px)', width: 'calc(100% - 16px)', height: 3 },
  }
  return (
    <span
      style={{
        position: 'absolute',
        ...bar[edge],
        background: 'var(--accent)',
        opacity: 0.8,
        borderRadius: 2,
        zIndex: 19,
        pointerEvents: 'none',
      }}
    />
  )
}

/** The hairline between the dock's sections. */
function Divider({ vertical }: { vertical: boolean }) {
  return (
    <span
      style={{
        width: vertical ? 20 : 1,
        height: vertical ? 1 : 20,
        background: 'var(--line2)',
        flex: 'none',
      }}
    />
  )
}

/** Warm colours in the dock: one click flips it, and the tooltip says what it
 *  is set to. The slider and the schedule live in its catalog page. */
function WarmTile({ size, edge }: { size: number; edge: Edge }) {
  const warm = useUi((u) => u.warm)
  const warmth = useUi((u) => u.warmth)
  const open = useUi((u) => u.appPopover === 'warm')
  const on = warm && isWarm(warmth)
  const side = isVertical(edge)
    ? { [edge === 'right' ? 'right' : 'left']: size + 14, top: -6 }
    : { [edge === 'bottom' ? 'bottom' : 'top']: size + 14, right: -6 }
  return (
    <div style={{ position: 'relative' }}>
    <div
      onClick={(e) => {
        e.stopPropagation()
        setAppPopover(open ? null : 'warm')
      }}
      title={on ? `Warm colours · ${warmth}K` : 'Warm colours'}
      style={{ width: size, height: size, borderRadius: 7 }}
      className="grid place-items-center cursor-pointer hover:bg-sel"
    >
      <span
        style={{
          width: GLYPH,
          height: GLYPH,
          borderRadius: 6,
          border: '1.5px solid var(--accent)',
          background: on ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'transparent',
          color: 'var(--accent)',
        }}
        className="grid place-items-center"
      >
        <FlameIcon size={15} />
      </span>
    </div>
    {open && (
      <div
        data-dock-popover
        onMouseDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', ...side, width: 250, boxShadow: 'var(--shadow)' }}
        className="p-2.5 bg-raised border border-line2 rounded-r z-[40] flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--accent)' }}>
            <FlameIcon size={16} />
          </span>
          <span className="text-[12.5px] font-medium flex-1">Warm colours</span>
          <span className="font-mono text-[10.5px]" style={{ color: on ? 'var(--accent)' : 'var(--faint)' }}>
            {on ? `${warmth}K` : 'off'}
          </span>
        </div>
        <WarmthRow />
      </div>
    )}
    </div>
  )
}

function AppGlyph({ id, fill }: { id: AppId; fill: number }) {
  if (id === 'water') return <DropIcon size={15} fill={fill} />
  if (id === 'stand') return <StandIcon size={15} />
  if (id === 'pomo') return <TomatoIcon size={15} />
  return <AppsIcon />
}

/** The pomodoro's tile: a ring that fills across the phase, the minutes left
 *  under it. The one app with something worth a glance unprompted. */
function PomoTile({ edge, size }: { edge: Edge; size: number }) {
  const pomo = useUi((u) => u.apps.pomo)
  const set = useUi((u) => u.apps.pomoSet)
  const open = useUi((u) => u.appPopover === 'pomo')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (pomo.phase === 'idle') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [pomo.phase])
  const running = pomo.phase !== 'idle'
  const hue = 'var(--pomo)'
  const ringColour = pomo.phase === 'break' ? `color-mix(in srgb, ${hue} 55%, var(--muted))` : hue
  const progress = pomoProgress(pomo, set, now)
  const left = pomoLeft(pomo, now)
  const side = isVertical(edge)
    ? { [edge === 'right' ? 'right' : 'left']: size + 14, top: -6 }
    : { [edge === 'bottom' ? 'bottom' : 'top']: size + 14, right: -6 }
  const choice =
    'h-6 px-2 flex items-center justify-center rounded-rs border text-[11.5px] cursor-pointer font-mono tabular-nums'
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={(e) => {
          e.stopPropagation()
          setAppPopover(open ? null : 'pomo')
        }}
        title={running ? `${pomo.phase === 'focus' ? 'Focus' : 'Break'} · ${pomoClock(left)} left` : 'Pomodoro'}
        style={{
          width: size,
          height: running ? GAUGE_H : size,
          borderRadius: 7,
          background: open ? 'var(--sel)' : 'transparent',
        }}
        className="grid place-items-center cursor-pointer hover:bg-sel"
      >
        {running ? (
          // The ring fills across the phase and the time sits under it, the
          // same shape the stats gauge uses.
          <div className="flex flex-col items-center gap-[2px]">
            <Ring fill={progress} colour={ringColour} size={GLYPH}>
              <TomatoIcon size={13} />
            </Ring>
            <span className="font-mono text-[10px] leading-none tabular-nums" style={{ color: 'var(--text)' }}>
              {pomoClock(left)}
            </span>
          </div>
        ) : (
          <span
            style={{ width: GLYPH, height: GLYPH, borderRadius: 6, border: `1.5px solid ${hue}`, color: hue }}
            className="grid place-items-center"
          >
            <TomatoIcon size={15} />
          </span>
        )}
      </div>
      {open && (
        <div
          data-dock-popover
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', ...side, width: 236, boxShadow: 'var(--shadow)' }}
          className="p-2.5 bg-raised border border-line2 rounded-r z-[40] flex flex-col gap-2.5"
        >
          <div className="flex items-center gap-2">
            <span style={{ color: hue }}>
              <TomatoIcon size={16} />
            </span>
            <span className="text-[12.5px] font-medium flex-1">Pomodoro</span>
            {pomo.rounds > 0 && (
              <span className="font-mono text-[10.5px] text-faint">
                {pomo.rounds} done
              </span>
            )}
          </div>

          {running && (
            <span className="font-mono text-[20px] tabular-nums" style={{ color: hue }}>
              {pomoClock(left)}
              <span className="text-[11px] text-faint font-ui"> {pomo.phase === 'focus' ? 'of focus' : 'of break'}</span>
            </span>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-faint">Focus</span>
            <div className="flex gap-1">
              {FOCUS_CHOICES.map((m) => (
                <div
                  key={m}
                  onClick={() => setPomoLength('focusMin', m)}
                  className={choice}
                  style={{
                    borderColor: set.focusMin === m ? hue : 'var(--line2)',
                    color: set.focusMin === m ? hue : 'var(--muted)',
                  }}
                >
                  {m}
                </div>
              ))}
            </div>
            <span className="text-[11px] text-faint">Break</span>
            <div className="flex gap-1">
              {BREAK_CHOICES.map((m) => (
                <div
                  key={m}
                  onClick={() => setPomoLength('breakMin', m)}
                  className={choice}
                  style={{
                    borderColor: set.breakMin === m ? hue : 'var(--line2)',
                    color: set.breakMin === m ? hue : 'var(--muted)',
                  }}
                >
                  {m}
                </div>
              ))}
            </div>
          </div>

          {running ? (
            <div
              onClick={() => stopPomoTimer()}
              className="h-7 flex items-center justify-center rounded-rs border border-line2 cursor-pointer text-[12px] text-muted hover:text-text hover:border-accent"
            >
              Stop
            </div>
          ) : (
            <div
              onClick={() => startPomo()}
              className="h-7 flex items-center justify-center rounded-rs bg-accent text-accent-ink cursor-pointer text-[12px] font-medium"
            >
              Start {set.focusMin} min
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** What to do about a nudge: acknowledge, hold it, or let this one go. */
function Popover({ id, edge }: { id: ReminderId; edge: Edge }) {
  const app = appById(id)
  const snoozeMin = useUi((u) => u.apps.snoozeMin)
  const glasses = useUi((u) => u.apps.glasses)
  const allowed = useUi((u) => u.notifyAllowed)
  const side = isVertical(edge)
    ? { [edge === 'right' ? 'right' : 'left']: TILE + 14, top: -6 }
    : { [edge === 'bottom' ? 'bottom' : 'top']: TILE + 14, right: -6 }
  const btn =
    'h-7 px-2.5 flex items-center justify-center rounded-rs text-[12px] cursor-pointer border border-line2 hover:border-accent'
  return (
    <div
      data-dock-popover
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', ...side, width: 236, boxShadow: 'var(--shadow)' }}
      className="p-2.5 bg-raised border border-line2 rounded-r z-[40] flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <span style={{ color: app.hue }}>
          <AppGlyph id={id} fill={1} />
        </span>
        <span className="text-[12.5px] font-medium flex-1">{app.name}</span>
      </div>
      {id === 'water' && glasses > 0 && (
        <span className="text-[11.5px] text-muted">
          {glasses} {glasses === 1 ? 'glass' : 'glasses'} today
        </span>
      )}
      {!allowed && (
        <span className="text-[11px] text-muted leading-[1.4]">
          System notifications are off, so this reminder only shows here.
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <div
          onClick={() => acknowledge(id)}
          className="h-7 px-2.5 flex items-center justify-center rounded-rs bg-accent text-accent-ink cursor-pointer text-[12px] font-medium"
        >
          {app.ack}
        </div>
        <div className={btn} onClick={() => snooze(id)}>
          In {snoozeMin} min
        </div>
        <div className={`${btn} text-muted`} onClick={() => skip(id)}>
          Skip this one
        </div>
      </div>
    </div>
  )
}

function Tile({ id, due, edge }: { id: AppId; due: boolean; edge: Edge }) {
  const app = appById(id)
  const open = useUi((u) => u.appPopover === id)
  const every = useUi((u) => (isReminderId(id) ? u.apps.every[id] : 0))
  const state = useUi((u) => (isReminderId(id) ? u.apps.reminders[id] : null))
  const [hover, setHover] = useState(false)
  const next = state && isReminderId(id) ? nextDueAt(every, state) : null
  return (
    <div style={{ position: 'relative' }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation()
          if (isReminderId(id)) setAppPopover(open ? null : id)
          else setAppPanel(id)
        }}
        title={due ? app.name : next ? `${app.name} — around ${clock(next)}` : app.name}
        style={{ width: TILE, height: TILE, borderRadius: 7, background: open ? 'var(--sel)' : 'transparent' }}
        className="grid place-items-center cursor-pointer hover:bg-sel"
      >
        <span
          style={{
            width: GLYPH,
            height: GLYPH,
            borderRadius: 6,
            border: `1.5px solid ${app.hue}`,
            background: due ? `color-mix(in srgb, ${app.hue} 20%, transparent)` : 'transparent',
            color: app.hue,
          }}
          className="grid place-items-center"
        >
          <AppGlyph id={id} fill={due ? 1 : hover ? 0.35 : 0} />
        </span>
      </div>
      {open && isReminderId(id) && <Popover id={id} edge={edge} />}
    </div>
  )
}

export function Dock() {
  const apps = useUi((u) => u.apps)
  const runtimes = useRuntimes()
  const [now, setNow] = useState(() => Date.now())
  // While dragging, the dock follows the pointer; the edge is only where it
  // would land. Local state, committed once on release.
  const [drag, setDrag] = useState<{ edge: Edge; x: number; y: number } | null>(null)
  const [touched, setTouched] = useState(() => Date.now())
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  /** The dock sits over the panes, not the whole window, so edges are that
   *  box's. With no positioned ancestor, the window will do. */
  const area = (): { left: number; top: number; width: number; height: number } =>
    root.current?.offsetParent?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }

  // One clock for the dock, so a tile that comes due lights up without each
  // tile keeping a timer of its own.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  const shown = APPS.filter((a) => apps.on[a.id] && apps.pinned[a.id])
  const waiting = Object.values(runtimes).some((r) => r.status === 'waiting')
  const dueIds = shown
    .filter((a) => isReminderId(a.id) && isDue({ every: apps.every[a.id as ReminderId], state: apps.reminders[a.id as ReminderId], sessionWaiting: waiting, now }))
    .map((a) => a.id)

  // Auto-minimise tucks the dock away until it is hovered, but a due nudge
  // always stays visible.
  const tucked = apps.autoMinimise && !drag && dueIds.length === 0 && now - touched > TUCK_MS
  // Tucked away, the dock is the Apps button alone — except that a reminder
  // which is actually due stays on show, which is the point of it.
  const visibleTiles = shown.filter((a) => a.id !== 'sys' && (!tucked || dueIds.includes(a.id)))
  const vertical = isVertical(apps.edge)
  const edge = drag?.edge ?? apps.edge
  const gap = tucked ? 0 : 8

  const at = `${(apps.along * 100).toFixed(1)}%`
  const place: React.CSSProperties = drag
    ? // Under the cursor, so the dock comes with you rather than jumping at
      // the end. The guide bar says where it will land.
      { left: drag.x, top: drag.y, transform: 'translate(-50%, -50%)' }
    : vertical
      ? { [edge === 'right' ? 'right' : 'left']: gap, top: at, transform: 'translateY(-50%)' }
      : { [edge === 'bottom' ? 'bottom' : 'top']: gap, left: at, transform: 'translateX(-50%)' }

  return (
    <>
      {drag && <EdgeGuide edge={drag.edge} />}
      <div
      data-dock
      ref={root}
      onPointerDown={(e) => {
        // No pointer capture here. Capturing on press would retarget every
        // later event — the click included — to the dock, so a tile would
        // never hear its own click. Capture is taken only once a drag starts.
        if (e.button !== 0 || (e.target as Element).closest('[data-dock-popover]')) return
        press.current = { x: e.clientX, y: e.clientY, dragging: false }
      }}
      onPointerMove={(e) => {
        const p = press.current
        const box = area()
        if (!p) return
        if (!p.dragging) {
          if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return
          p.dragging = true
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        const x = e.clientX - box.left
        const y = e.clientY - box.top
        setDrag({ edge: nearestEdge(x, y, box.width, box.height), x, y })
      }}
      onPointerUp={(e) => {
        const dragging = press.current?.dragging
        const box = area()
        press.current = null
        if (dragging) {
          const x = e.clientX - box.left
          const y = e.clientY - box.top
          const next = nearestEdge(x, y, box.width, box.height)
          setDockPlace(next, alongEdge(next, x, y, box.width, box.height))
        }
        setDrag(null)
        setTouched(Date.now())
      }}
      onPointerCancel={() => {
        press.current = null
        setDrag(null)
      }}
      onMouseEnter={() => setTouched(Date.now())}
      onMouseMove={() => tucked && setTouched(Date.now())}
      style={{
        position: 'absolute',
        ...place,
        borderRadius: 12,
        padding: tucked ? 3 : 5,
        zIndex: 20,
        boxShadow: drag ? '0 24px 60px rgba(0, 0, 0, 0.55)' : 'var(--shadow)',
        cursor: drag ? 'grabbing' : 'grab',
        opacity: tucked ? 0.5 : 1,
        // Tracks the pointer exactly while dragging, then eases to its edge.
        transition: drag ? 'none' : 'left .2s, top .2s, right .2s, bottom .2s, transform .2s, padding .18s, opacity .16s',
      }}
      className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1.5 bg-raised border border-line2`}
    >
      {/* The grab handle: the dock drags to any edge, and this says so. */}
      {!tucked && (
        <div
          title="Drag to any edge"
          style={{ width: vertical ? TILE : 12, height: vertical ? 12 : TILE, cursor: 'grab' }}
          className="grid place-items-center flex-none"
        >
          <span
            style={{
              width: vertical ? 14 : 3,
              height: vertical ? 3 : 14,
              borderRadius: 2,
              background: 'var(--line2)',
            }}
          />
        </div>
      )}

      {!tucked && apps.on.sys && apps.pinned.sys && (
        <>
          <Gauge width={TILE} height={GAUGE_H} waiting={waiting} />
          <Divider vertical={vertical} />
        </>
      )}

      {/* How the grid is arranged: part of the workspace, so above the apps. */}
      {!tucked && <LayoutTile edge={edge} size={TILE} />}

      <div
        onClick={(e) => {
          e.stopPropagation()
          setAppPanel('catalog')
        }}
        title={`Apps (${kbdShift('A')})`}
        style={{ width: TILE, height: TILE, borderRadius: 7 }}
        className="grid place-items-center cursor-pointer hover:bg-sel"
      >
        <AppsIcon />
      </div>
      {visibleTiles.length > 0 && <Divider vertical={vertical} />}
      {visibleTiles
        .map((a) =>
          a.id === 'pomo' ? (
            <PomoTile key={a.id} edge={edge} size={TILE} />
          ) : a.id === 'warm' ? (
            <WarmTile key={a.id} size={TILE} edge={edge} />
          ) : (
            <Tile key={a.id} id={a.id} due={dueIds.includes(a.id)} edge={edge} />
          ),
        )}
      </div>
    </>
  )
}

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
import { AppsIcon, DropIcon, StandIcon, TomatoIcon } from '../common/Icon'
import { Gauge } from './Gauge'

/** How long untouched before an auto-minimising dock shrinks to just Apps. */
const TUCK_MS = 3000
const TILE = 34

type ReminderId = 'water' | 'stand'
const isReminderId = (id: AppId): id is ReminderId => id === 'water' || id === 'stand'

function AppGlyph({ id, fill }: { id: AppId; fill: number }) {
  if (id === 'water') return <DropIcon size={17} fill={fill} />
  if (id === 'stand') return <StandIcon size={17} />
  if (id === 'pomo') return <TomatoIcon size={17} />
  return <AppsIcon size={16} />
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
          height: size,
          borderColor: running || open ? hue : 'transparent',
          background: running ? 'color-mix(in srgb, var(--pane) 70%, transparent)' : 'transparent',
          color: running ? hue : 'var(--muted)',
        }}
        className="grid place-items-center rounded-rs border cursor-pointer hover:bg-hover hover:text-text"
      >
        {running ? (
          <div className="flex flex-col items-center gap-[2px] w-full px-1">
            <span className="font-mono text-[9px] tabular-nums leading-none">{pomoClock(left)}</span>
            <div className="w-full h-[3px] rounded-[2px] overflow-hidden" style={{ background: 'var(--line)' }}>
              <div style={{ width: `${progress * 100}%`, height: '100%', background: hue, transition: 'width 900ms linear' }} />
            </div>
            <span className="text-[8px] uppercase tracking-[0.06em] leading-none" style={{ color: 'var(--faint)' }}>
              {pomo.phase}
            </span>
          </div>
        ) : (
          <TomatoIcon size={17} />
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
        style={{
          width: TILE,
          height: TILE,
          // Square, and tinted only when there is something to say.
          background: due ? 'color-mix(in srgb, var(--pane) 70%, transparent)' : 'transparent',
          borderColor: due || open ? app.hue : 'transparent',
          color: due ? app.hue : hover ? 'var(--text)' : 'var(--muted)',
        }}
        className="grid place-items-center rounded-rs border cursor-pointer hover:bg-hover"
      >
        <AppGlyph id={id} fill={due ? 1 : hover ? 0.35 : 0} />
      </div>
      {open && isReminderId(id) && <Popover id={id} edge={edge} />}
    </div>
  )
}

export function Dock() {
  const apps = useUi((u) => u.apps)
  const runtimes = useRuntimes()
  const [now, setNow] = useState(() => Date.now())
  const [drag, setDrag] = useState<{ edge: Edge } | null>(null)
  const [touched, setTouched] = useState(() => Date.now())
  const press = useRef<{ moved: boolean } | null>(null)

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
  const vertical = isVertical(apps.edge)
  const edge = drag?.edge ?? apps.edge
  const gap = apps.autoMinimise ? 0 : 8

  const place: React.CSSProperties = vertical
    ? { [edge === 'right' ? 'right' : 'left']: gap, top: `${apps.along * 100}%`, transform: 'translateY(-50%)' }
    : { [edge === 'bottom' ? 'bottom' : 'top']: gap, left: `${apps.along * 100}%`, transform: 'translateX(-50%)' }

  if (!shown.length && !apps.on.sys) return null

  return (
    <div
      data-dock
      onPointerDown={(e) => {
        if ((e.target as Element).closest('[data-dock-popover]')) return
        press.current = { moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!press.current) return
        press.current.moved = true
        setDrag({ edge: nearestEdge(e.clientX, e.clientY, window.innerWidth, window.innerHeight) })
      }}
      onPointerUp={(e) => {
        const moved = press.current?.moved
        press.current = null
        if (moved) {
          const next = nearestEdge(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
          setDockPlace(next, alongEdge(next, e.clientX, e.clientY, window.innerWidth, window.innerHeight))
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
        zIndex: 20,
        boxShadow: 'var(--shadow)',
        cursor: drag ? 'grabbing' : 'grab',
        opacity: tucked ? 0.5 : 1,
        transition: 'opacity 160ms ease',
      }}
      className={`p-1 flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1 bg-side border border-line rounded-r`}
    >
      <div
        onClick={(e) => {
          e.stopPropagation()
          setAppPanel('catalog')
        }}
        title="Apps (⌘⇧A)"
        style={{ width: TILE, height: TILE }}
        className="grid place-items-center rounded-rs text-faint cursor-pointer hover:bg-hover hover:text-text"
      >
        <AppsIcon size={15} />
      </div>
      {!tucked && apps.on.sys && apps.pinned.sys && <Gauge size={TILE} waiting={waiting} />}
      {!tucked &&
        shown
          .filter((a) => a.id !== 'sys')
          .map((a) =>
            a.id === 'pomo' ? (
              <PomoTile key={a.id} edge={edge} size={TILE} />
            ) : (
              <Tile key={a.id} id={a.id} due={dueIds.includes(a.id)} edge={edge} />
            ),
          )}
      {drag && (
        <span
          style={{ position: 'absolute', inset: -4, border: '1px solid var(--accent)', borderRadius: 'var(--r)', pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}

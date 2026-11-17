// The notch island: a pill at the top centre of the title bar.
//
// From the brief of 9 Oct 2026. It exists because a nudge should not depend on
// the system allowing notifications. macOS can refuse — or never have been
// asked — and then a reminder only ever reaches the dock, which is not
// somewhere you are looking. This is inside our own window, so it always
// works. The one honest limit: it is invisible while the window is, and the
// system notification stays the fallback for that.
//
// Shape and colour come from the hardware it is named after: black in both
// themes, square at the top where it meets the bar, rounded underneath. Every
// colour inside is a literal for that reason — a theme token would flip to
// dark-on-dark in light mode.
//
// Three states, and only three:
//
//   · idle     a sliver, so there is somewhere to grow from
//   · compact  the newest activity, and how many more there are
//   · shelf    every activity, one row each, each with its own buttons
//
// The shelf replaced a carousel that rotated one activity at a time behind a
// row of dots. That asked you to wait, aim at a dot or scroll to find the one
// you wanted, and then click again for its buttons. The shelf shows them all
// and makes every action one click. It opens on its own for a fresh alert, on
// hover or keyboard focus, and stays open when clicked.
//
// What it shows comes from lib/island.ts. Alerts are pushed into ui.island;
// live activities are derived here each render. Both are ranked together.
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { appById, pomoClock, pomoLeft, pomoProgress } from '../../lib/apps'
import { clock } from '../../lib/format'
import {
  BREAK_MARQUEE,
  BREAK_WORDS,
  centredWidth,
  COLLAPSE_MS,
  type IslandApp,
  type IslandEvent,
  rankActivities,
} from '../../lib/island'
import { BARS, barTiming, needsMarquee, progress, trackLabel, useNowPlaying } from '../../lib/media'
import { ipc } from '../../lib/ipc'
import { islandEdge, paletteById } from '../../lib/themes'
import { acknowledge, advancePomo, skip, snooze, standNow, stopPomoTimer } from '../../state/commands/apps'
import { dismissIsland, pinIsland } from '../../state/commands/island'
import { useUi } from '../../state/selectors'
import {
  ChairIcon,
  CloseIcon,
  CupIcon,
  DropIcon,
  NoteIcon,
  PauseIcon,
  PlayIcon,
  SkipIcon,
  StandIcon,
  TomatoIcon,
} from '../common/Icon'
import { Ring } from '../Dock/Gauge'

// Sizes. The compact pill is a stadium: its corner radius is half its height,
// and its side padding is wider than that radius so the glyph never sits in
// the curve. The shelf's height is measured from what is in it, never set —
// a fixed height is what used to clip the music card's progress bar.
const IDLE = { w: 90, h: 6, r: 4 }
const COMPACT = { w: 220, h: 30, r: 15, pad: 12 }
const SHELF = { w: 360, r: 20, pad: 6 }
/** How long the pointer may be outside before a hovered shelf folds. Long
 *  enough to cross the spring's overshoot at the shelf's edge without it
 *  snapping shut under you. */
const LEAVE_MS = 180
/** Overshoots slightly, which is what makes it feel like hardware. */
const SPRING = 'cubic-bezier(.2, 1.4, .4, 1)'
const MOTION = 400

const WHITE = '#fff'
const DIM = 'rgba(255, 255, 255, 0.62)'
const FAINT = 'rgba(255, 255, 255, 0.3)'
const TRACK = 'rgba(255, 255, 255, 0.14)'

type ReminderId = 'water' | 'stand'
const isReminderId = (app: IslandApp): app is ReminderId => app === 'water' || app === 'stand'

/** The app's own hue, which still reads on black in both themes. */
const hueOf = (app: IslandApp): string => appById(app).hue

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [on, setOn] = useState(() => window.matchMedia?.(query)?.matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq?.addEventListener) return
    const onChange = () => setOn(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return on
}

/** The glyph, animated per app: the drop fills, the figure hops, a running
 *  pomodoro carries its own ring. */
function Glyph({ app, progress, hue, size = 17 }: { app: IslandApp; progress: number | null; hue: string; size?: number }) {
  if (app === 'water') {
    return (
      <span style={{ position: 'relative', width: size, height: size }} className="grid place-items-center">
        <DropIcon size={size} fill={0} />
        <span className="cw-drop-fill absolute inset-0 grid place-items-center">
          <DropIcon size={size} fill={1} />
        </span>
      </span>
    )
  }
  if (app === 'stand') {
    return (
      <span className="cw-hop grid place-items-center">
        <StandIcon size={size} />
      </span>
    )
  }
  if (app === 'caff') return <CupIcon size={size} fill={0.6} />
  if (app === 'sit') return <ChairIcon size={size} />
  if (app === 'music') return <NoteIcon size={size - 1} />
  if (app === 'pomo' && progress !== null) {
    return (
      <Ring fill={progress} colour={hue} size={size + 3}>
        <TomatoIcon size={Math.round(size * 0.65)} />
      </Ring>
    )
  }
  return <TomatoIcon size={size} />
}

/** Five bars that read as a spectrum. They are not one: a real spectrum needs
 *  system audio capture, which costs a Screen Recording prompt, and that is
 *  far too much consent for a decoration. They stop when the music does. */
function Bars({ playing, hue }: { playing: boolean; hue: string }) {
  return (
    <span className="flex items-end gap-[2px] flex-none" style={{ height: 13 }} aria-hidden>
      {Array.from({ length: BARS }, (_, i) => {
        const t = barTiming(i)
        return (
          <span
            key={i}
            className={`cw-bar${playing ? '' : ' cw-bar-still'}`}
            style={{
              width: 2,
              height: 13,
              borderRadius: 1,
              background: hue,
              opacity: playing ? 0.9 : 0.4,
              animationDuration: `${t.durationMs}ms`,
              animationDelay: `${t.delayMs}ms`,
            }}
          />
        )
      })}
    </span>
  )
}

/** A line too long for its room, scrolling. Short ones sit still. */
function Scrolling({ text, reduced, colour = WHITE }: { text: string; reduced: boolean; colour?: string }) {
  if (reduced || !needsMarquee(text)) {
    return (
      <span className="block overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: colour }}>
        {text}
      </span>
    )
  }
  return (
    <span className="block overflow-hidden">
      <span className="cw-marquee">
        {[0, 1].map((n) => (
          <span key={n} className="whitespace-nowrap pr-6" style={{ color: colour }} aria-hidden={n === 1}>
            {text}
          </span>
        ))}
      </span>
    </span>
  )
}

/** What a break is for, scrolling — or a word at a time with less motion. */
function BreakLine({ reduced, now }: { reduced: boolean; now: number }) {
  if (reduced) {
    const word = BREAK_WORDS[Math.floor(now / 3000) % BREAK_WORDS.length]
    return (
      <span key={word} className="cw-word whitespace-nowrap" style={{ color: DIM }}>
        Break · {word}
      </span>
    )
  }
  return <Scrolling text={BREAK_MARQUEE} reduced={false} colour={DIM} />
}

type BtnKind = 'primary' | 'secondary' | 'quiet' | 'icon'

/** One button style for the whole island. Real buttons, so Tab reaches them
 *  and Enter presses them; the click stops here so it never also toggles the
 *  shelf underneath. */
function Btn({
  kind,
  onPress,
  children,
  label,
  hue,
}: {
  kind: BtnKind
  onPress: () => void
  children: ReactNode
  label?: string
  hue?: string
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onPress()
      }}
      className={`cw-isl-btn cw-isl-${kind}`}
      style={kind === 'primary' && hue ? { background: hue } : undefined}
    >
      {children}
    </button>
  )
}

/** One activity in the shelf: a glyph tile, what it is, what to do about it. */
function Row({
  hue,
  tile,
  title,
  body,
  trailing,
  actions,
  footer,
}: {
  hue: string
  tile: ReactNode
  title: ReactNode
  body?: ReactNode
  trailing?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
}) {
  return (
    <div data-island-row className="cw-isl-row">
      <span className="cw-isl-tile" style={{ color: hue }}>
        {tile}
      </span>
      <span className="flex flex-col min-w-0 gap-[2px]">
        <span className="flex items-center gap-2 min-h-[22px]">
          <span className="flex-1 min-w-0 text-[12.5px] font-medium leading-[1.3]" style={{ color: WHITE }}>
            {title}
          </span>
          {trailing}
        </span>
        {body && (
          <span className="text-[11.5px] leading-[1.4]" style={{ color: DIM }}>
            {body}
          </span>
        )}
        {actions && <span className="flex flex-wrap items-center gap-1.5 pt-2">{actions}</span>}
        {footer}
      </span>
    </div>
  )
}

export function Island() {
  const events = useUi((u) => u.island.events)
  const pinned = useUi((u) => u.island.pinned)
  const edge = useUi((u) => islandEdge(paletteById(u.palette), u.theme))
  const islandOn = useUi((u) => u.apps.island)
  const pomoOn = useUi((u) => u.apps.on.pomo)
  const pomo = useUi((u) => u.apps.pomo)
  const pomoSet = useUi((u) => u.apps.pomoSet)
  const snoozeMin = useUi((u) => u.apps.snoozeMin)
  const reduced = useReducedMotion()

  const root = useRef<HTMLDivElement>(null)
  const shelf = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Centred, the island runs into the title bar's two clusters: the workspace
  // switch and the chips on the left, the buttons on the right. Whether there
  // is room is measured rather than guessed from the window width — the left
  // cluster alone can pass the centre of a wide window once it carries two
  // workspace names, a waiting chip and an update chip. The slack between the
  // clusters is a real element (the bar's flex-1 spacer), so measuring it
  // gives both edges at once, and a ResizeObserver on it catches a chip
  // appearing as well as the window changing size.
  // It always shows, always on the centre line; a crowded bar only narrows
  // the compact pill (lib/island centredWidth). The shelf hangs below the
  // bar, where there is nothing to run into.
  const [fit, setFit] = useState(COMPACT.w)
  useEffect(() => {
    const spacer = document.querySelector('[data-bar-gap]')
    const row = spacer?.parentElement
    if (!spacer || !row) return
    const measure = () => {
      const b = row.getBoundingClientRect()
      const s = spacer.getBoundingClientRect()
      setFit(centredWidth(b.width, s.left - b.left, s.right - b.left, COMPACT.w))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    ro.observe(spacer)
    return () => ro.disconnect()
  }, [])

  // Polled only while the app is on and allowed in the notch, so someone who
  // never switches it on is never asked for Automation permission at all.
  const musicOn = useUi((u) => u.apps.on.music) && islandOn.music
  const media = useNowPlaying(musicOn)

  const live: IslandEvent[] = []
  if (media.now && media.since !== null) {
    // `at` is when playback started, not when we last looked: a moment that
    // moved every two seconds would always rank newest and would starve
    // every alert behind it.
    live.push({ id: `music-live-${media.since}`, app: 'music', kind: 'live', title: trackLabel(media.now), at: media.since })
  }
  const pomoRunning = pomoOn && pomo.phase !== 'idle' && pomo.endsAt !== null
  if (pomoRunning && islandOn.pomo && pomo.endsAt !== null) {
    const total = (pomo.phase === 'focus' ? pomoSet.focusMin : pomoSet.breakMin) * 60_000
    live.push({
      id: `pomo-live-${pomo.phase}-${pomo.endsAt}`,
      app: 'pomo',
      kind: 'live',
      title: pomo.phase === 'focus' ? 'Focus' : 'Break',
      at: pomo.endsAt - total,
    })
  }
  // Alerts first: a phase change is announced at the same millisecond the
  // phase it starts begins, and on that tie the alert should win — it has
  // eight seconds to say "time for a break" before the ring takes over.
  const acts = rankActivities([...events, ...live], now)
  const count = acts.length
  const busy = count > 0

  // One clock, and only while there is something to count.
  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [busy])

  // A pin on an empty island would open the shelf the moment anything next
  // arrived, long after the click that asked for it.
  useEffect(() => {
    if (!busy && pinned) pinIsland(false)
  }, [busy, pinned])

  // A pinned shelf lets go on Escape or on a click anywhere else.
  useEffect(() => {
    if (!pinned) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && pinIsland(false)
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) pinIsland(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [pinned])

  useEffect(() => () => clearTimeout(leaving.current), [])

  // A fresh alert is news: it opens the shelf by itself for six seconds.
  // Hovering, focusing or clicking holds it — you reached for it, so it waits.
  const fresh = acts.some((a) => a.kind === 'alert' && now - a.at < COLLAPSE_MS)
  const open = busy && (pinned || hover || focused || fresh)
  const mode = !busy ? 'idle' : open ? 'shelf' : 'compact'

  // The shelf's height is whatever its rows need, measured before paint so
  // the spring runs from the compact height straight to the real one.
  const [shelfH, setShelfH] = useState(0)
  useLayoutEffect(() => {
    if (mode !== 'shelf') return
    const el = shelf.current
    if (!el) return
    const measure = () => setShelfH(el.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode])

  const width = mode === 'idle' ? Math.min(IDLE.w, fit) : mode === 'compact' ? fit : SHELF.w
  const height = mode === 'idle' ? IDLE.h : mode === 'compact' ? COMPACT.h : shelfH > 0 ? shelfH : 'auto'
  const radius = mode === 'idle' ? IDLE.r : mode === 'compact' ? COMPACT.r : SHELF.r

  // Shown alerts first, then what is running. Ranking is newest first, but a
  // track that started a second after a reminder is not more urgent than it:
  // an alert asks for something, a live activity only reports. Each half
  // keeps its newest-first order.
  const shown = [...acts.filter((a) => a.kind === 'alert'), ...acts.filter((a) => a.kind === 'live')]
  const top = shown[0] ?? null
  // Only while it is news: the region speaks when its text changes, so it is
  // filled for a fresh alert and emptied after, never fed the ticking clock.
  const latestAlert = acts.find((a) => a.kind === 'alert' && now - a.at < COLLAPSE_MS) ?? null
  const ringFill = pomoRunning ? pomoProgress(pomo, pomoSet, now) : null

  /** The compact line for the activity on top. */
  const compactLine = (cur: IslandEvent) => {
    if (cur.kind === 'live' && cur.app === 'music' && media.now) {
      return <Scrolling text={trackLabel(media.now)} reduced={reduced} />
    }
    if (cur.kind === 'live' && cur.app === 'pomo' && pomo.phase === 'break') return <BreakLine reduced={reduced} now={now} />
    if (cur.kind === 'live' && cur.app === 'pomo') {
      return (
        <span className="font-mono tabular-nums" style={{ color: WHITE }}>
          {pomoClock(pomoLeft(pomo, now))}
          <span className="font-ui text-[11px]" style={{ color: DIM }}>
            {' '}
            focus
          </span>
        </span>
      )
    }
    return (
      <span className="font-medium block overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: WHITE }}>
        {cur.title}
      </span>
    )
  }

  /** The pomodoro's buttons, on its live row and on its phase-change alert. */
  const pomoActions = pomoRunning ? (
    <>
      <Btn kind="secondary" onPress={() => advancePomo()}>
        {pomo.phase === 'focus' ? 'Break now' : 'Focus now'}
      </Btn>
      <Btn kind="quiet" onPress={() => stopPomoTimer()}>
        Stop
      </Btn>
    </>
  ) : undefined

  /** The shelf row for one activity. */
  const row = (a: IslandEvent) => {
    const hue = hueOf(a.app)
    const dismiss =
      a.kind === 'alert' ? (
        <Btn kind="icon" label="Dismiss" onPress={() => dismissIsland(a.id)}>
          <CloseIcon size={11} />
        </Btn>
      ) : undefined

    if (a.kind === 'live' && a.app === 'music' && media.now) {
      const m = media.now
      return (
        <Row
          key={a.id}
          hue={hue}
          tile={
            m.artworkUrl ? (
              // Spotify hands out a URL; Music does not, and Windows gives a
              // stream rather than a link. Hence the glyph fallback.
              <img src={m.artworkUrl} alt="" className="w-full h-full object-cover rounded-[8px]" />
            ) : (
              <NoteIcon size={15} />
            )
          }
          title={<Scrolling text={m.title || trackLabel(m)} reduced={reduced} />}
          body={
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
              {m.artist && <span>{m.artist}</span>}
              <span style={{ color: FAINT }}>
                {m.artist ? ' · ' : ''}
                {m.app}
              </span>
            </span>
          }
          trailing={<Bars playing={m.playing} hue={hue} />}
          actions={
            // Icon buttons carry their own padding; pulled left by it so the
            // first glyph lines up with the text above instead of the button.
            <span className="flex flex-1 items-center gap-1 -ml-[6px]">
              {(
                [
                  ['prev', <SkipIcon key="p" size={13} back />, 'Previous'],
                  ['toggle', m.playing ? <PauseIcon key="t" size={13} /> : <PlayIcon key="t" size={13} />, m.playing ? 'Pause' : 'Play'],
                  ['next', <SkipIcon key="n" size={13} />, 'Next'],
                ] as const
              ).map(([action, glyph, label]) => (
                <Btn key={action} kind="icon" label={label} onPress={() => void ipc.mediaControl(action).catch(() => {})}>
                  {glyph}
                </Btn>
              ))}
              {m.durationMs > 0 && (
                <span className="flex-1 min-w-[60px] ml-1.5 block" style={{ height: 3, borderRadius: 2, background: TRACK }}>
                  <span
                    className="block"
                    style={{ width: `${progress(m) * 100}%`, height: 3, borderRadius: 2, background: hue }}
                  />
                </span>
              )}
            </span>
          }
        />
      )
    }

    if (a.kind === 'live' && a.app === 'pomo') {
      return (
        <Row
          key={a.id}
          hue={hue}
          tile={<Glyph app="pomo" progress={ringFill} hue={hue} size={15} />}
          title={
            <span className="font-mono tabular-nums">
              {pomoClock(pomoLeft(pomo, now))}
              <span className="font-ui font-normal text-[11.5px]" style={{ color: DIM }}>
                {pomo.phase === 'focus' ? ' left to focus' : ' of break'}
              </span>
            </span>
          }
          body={pomo.phase === 'break' ? <BreakLine reduced={reduced} now={now} /> : `A break at ${clock(pomo.endsAt)}`}
          actions={pomoActions}
        />
      )
    }

    let actions: ReactNode
    if (isReminderId(a.app)) {
      // The same commands the dock popover calls, so acknowledging here
      // clears the tile and the notch together.
      const id = a.app
      actions = (
        <>
          <Btn kind="primary" hue={hue} onPress={() => acknowledge(id)}>
            {appById(id).ack}
          </Btn>
          <Btn kind="secondary" onPress={() => snooze(id)}>
            In {snoozeMin} min
          </Btn>
          <Btn kind="quiet" onPress={() => skip(id)}>
            Skip
          </Btn>
        </>
      )
    } else if (a.app === 'sit') {
      actions = (
        <Btn kind="primary" hue={hue} onPress={() => standNow()}>
          {appById('sit').ack}
        </Btn>
      )
    } else if (a.app === 'pomo') {
      actions = pomoActions
    }

    return (
      <Row
        key={a.id}
        hue={hue}
        tile={<Glyph app={a.app} progress={null} hue={hue} size={15} />}
        title={<span className="block overflow-hidden text-ellipsis whitespace-nowrap">{a.title}</span>}
        body={a.body}
        trailing={dismiss}
        actions={actions}
      />
    )
  }

  return (
    <div
      ref={root}
      data-island
      // No data-tauri-drag-region: dragging the window from here would eat
      // every click the island exists to receive.
      role={busy ? 'group' : undefined}
      aria-label={busy ? `Notch, ${count} ${count === 1 ? 'activity' : 'activities'}` : undefined}
      tabIndex={busy ? 0 : -1}
      onMouseEnter={() => {
        clearTimeout(leaving.current)
        setHover(true)
      }}
      onMouseLeave={() => {
        clearTimeout(leaving.current)
        leaving.current = setTimeout(() => setHover(false), LEAVE_MS)
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          pinIsland(!pinned)
        }
      }}
      onClick={() => busy && pinIsland(!pinned)}
      className="cw-isl"
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        transform: 'translateX(-50%)',
        width,
        height,
        background: '#000',
        // Sides and bottom only: the top is the window's edge.
        boxShadow: edge ? `inset 0 -1px 0 ${edge}, inset 1px 0 0 ${edge}, inset -1px 0 0 ${edge}` : undefined,
        borderBottomLeftRadius: radius,
        borderBottomRightRadius: radius,
        overflow: 'hidden',
        // Above the dock, which sits at 20. The title bar's own stacking
        // context already clears it; this says so anyway.
        zIndex: 24,
        pointerEvents: mode === 'idle' ? 'none' : 'auto',
        cursor: mode === 'compact' ? 'pointer' : 'default',
        transition: reduced
          ? 'none'
          : `width ${MOTION}ms ${SPRING}, height ${MOTION}ms ${SPRING}, border-radius ${MOTION}ms ${SPRING}`,
      }}
    >
      {/* Read out once per alert, never for the clock ticking under it. */}
      <span className="sr-only" role="status" aria-live="polite">
        {latestAlert ? `Notch: ${latestAlert.title}${latestAlert.body ? `. ${latestAlert.body}` : ''}` : ''}
      </span>

      {top && mode === 'compact' && (
        <div
          className="flex items-center gap-2 text-[12px]"
          style={{ height: COMPACT.h, paddingLeft: COMPACT.pad - 2, paddingRight: COMPACT.pad }}
        >
          <span key={top.id} className="flex items-center gap-2 flex-1 min-w-0 cw-swap-on">
            <span style={{ color: hueOf(top.app), width: 20, height: 20 }} className="grid place-items-center flex-none">
              <Glyph app={top.app} progress={top.app === 'pomo' && top.kind === 'live' ? ringFill : null} hue={hueOf(top.app)} />
            </span>
            <span className="flex-1 min-w-0 overflow-hidden">{compactLine(top)}</span>
          </span>
          {top.kind === 'live' && top.app === 'music' && media.now && <Bars playing={media.now.playing} hue={hueOf('music')} />}
          {count > 1 && (
            <span
              data-island-more
              className="flex-none text-[10.5px] font-medium tabular-nums px-1.5 rounded-full leading-[16px]"
              style={{ color: DIM, background: 'rgba(255,255,255,0.1)' }}
            >
              +{count - 1}
            </span>
          )}
        </div>
      )}

      {mode === 'shelf' && (
        <div ref={shelf} className="flex flex-col gap-0.5" style={{ padding: SHELF.pad }}>
          {shown.map(row)}
        </div>
      )}
    </div>
  )
}

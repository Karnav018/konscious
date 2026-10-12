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
// What it shows comes from lib/island.ts. Alerts are pushed into ui.island;
// live activities are derived here each render. Both are ranked together.
import { useEffect, useRef, useState } from 'react'

import { appById, pomoClock, pomoLeft, pomoProgress } from '../../lib/apps'
import {
  BREAK_MARQUEE,
  BREAK_WORDS,
  COLLAPSE_MS,
  CYCLE_MS,
  type IslandApp,
  type IslandEvent,
  nextIndex,
  showsCentred,
  rankActivities,
} from '../../lib/island'
import { BARS, barTiming, needsMarquee, progress, trackLabel, useNowPlaying } from '../../lib/media'
import { ipc } from '../../lib/ipc'
import { acknowledge, skip, snooze } from '../../state/commands/apps'
import { dismissIsland, expandIsland } from '../../state/commands/island'
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

// Sizes from the brief. Idle is a sliver rather than nothing, so the island
// has somewhere to grow from and the morph reads as one movement.
const IDLE = { w: 90, h: 6 }
const COMPACT = { w: 220, h: 28 }
const ALERT = { w: 360, h: 64 }
/** With the actions showing, enough for three buttons under the line. */
const ACTIONS_H = 104
/** Overshoots slightly, which is what makes it feel like hardware. */
const SPRING = 'cubic-bezier(.2, 1.4, .4, 1)'
const MOTION = 400

const WHITE = '#fff'
const DIM = 'rgba(255, 255, 255, 0.62)'
const FAINT = 'rgba(255, 255, 255, 0.3)'

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

/** The glyph on the left, animated per app: the drop fills, the figure hops,
 *  a running pomodoro carries its own ring. */
function Glyph({ app, progress, hue }: { app: IslandApp; progress: number | null; hue: string }) {
  if (app === 'water') {
    return (
      <span style={{ position: 'relative', width: 17, height: 17 }} className="grid place-items-center">
        <DropIcon size={17} fill={0} />
        <span className="cw-drop-fill absolute inset-0 grid place-items-center">
          <DropIcon size={17} fill={1} />
        </span>
      </span>
    )
  }
  if (app === 'stand') {
    return (
      <span className="cw-hop grid place-items-center">
        <StandIcon size={17} />
      </span>
    )
  }
  if (app === 'caff') return <CupIcon size={17} fill={0.6} />
  if (app === 'sit') return <ChairIcon size={17} />
  if (app === 'music') return <NoteIcon size={16} />
  if (app === 'pomo') {
    return progress === null ? (
      <TomatoIcon size={17} />
    ) : (
      <Ring fill={progress} colour={hue} size={20}>
        <TomatoIcon size={11} />
      </Ring>
    )
  }
  return <TomatoIcon size={17} />
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

/** A title too long for the pill, scrolling. Short ones sit still. */
function Scrolling({ text, reduced }: { text: string; reduced: boolean }) {
  if (reduced || !needsMarquee(text)) {
    return (
      <span className="text-[12px] block overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: WHITE }}>
        {text}
      </span>
    )
  }
  return (
    <span className="block overflow-hidden">
      <span className="cw-marquee">
        {[0, 1].map((n) => (
          <span key={n} className="text-[12px] whitespace-nowrap pr-6" style={{ color: WHITE }}>
            {text}
          </span>
        ))}
      </span>
    </span>
  )
}

/** One dot per activity, the filled one being the activity on show. */
function Dots({ count, at, onPick }: { count: number; at: number; onPick: (i: number) => void }) {
  return (
    <span className="flex items-center gap-[3px] flex-none">
      {Array.from({ length: count }, (_, n) => (
        <span
          key={n}
          data-island-dot
          onClick={(e) => {
            e.stopPropagation()
            onPick(n)
          }}
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            background: n === at ? WHITE : FAINT,
            cursor: 'pointer',
            transition: 'background 160ms',
          }}
        />
      ))}
    </span>
  )
}

/** What a break is for, scrolling — or a word at a time with less motion. */
function BreakLine({ reduced, now }: { reduced: boolean; now: number }) {
  if (reduced) {
    const word = BREAK_WORDS[Math.floor(now / 3000) % BREAK_WORDS.length]
    return (
      <span key={word} className="cw-word text-[12px] whitespace-nowrap" style={{ color: DIM }}>
        Break · {word}
      </span>
    )
  }
  return (
    <span className="block overflow-hidden">
      <span className="cw-marquee">
        {[0, 1].map((n) => (
          <span key={n} className="text-[12px] whitespace-nowrap pr-6" style={{ color: DIM }}>
            {BREAK_MARQUEE}
          </span>
        ))}
      </span>
    </span>
  )
}

export function Island() {
  const events = useUi((u) => u.island.events)
  const expanded = useUi((u) => u.island.expanded)
  const islandOn = useUi((u) => u.apps.island)
  const pomoOn = useUi((u) => u.apps.on.pomo)
  const pomo = useUi((u) => u.apps.pomo)
  const pomoSet = useUi((u) => u.apps.pomoSet)
  const snoozeMin = useUi((u) => u.apps.snoozeMin)
  const reduced = useReducedMotion()

  const [now, setNow] = useState(() => Date.now())
  // Which activity is on show, and which way it arrived — the swap animates
  // in the direction of travel, so cycling reads as movement rather than as
  // the content being replaced underneath you.
  const [nav, setNav] = useState({ i: 0, dir: 1 })
  const go = (delta: number) => setNav((n) => ({ i: nextIndex(count, n.i, delta), dir: delta < 0 ? -1 : 1 }))
  const jump = (to: number) => setNav((n) => ({ i: to, dir: to < n.i ? -1 : 1 }))
  const [hover, setHover] = useState(false)

  // Centred, the island runs into the title bar's two clusters: the workspace
  // switch and the chips on the left, the buttons on the right. Whether there
  // is room is measured rather than guessed from the window width — the left
  // cluster alone can pass the centre of a wide window once it carries two
  // workspace names, a waiting chip and an update chip. The slack between the
  // clusters is a real element (the bar's flex-1 spacer), so measuring it
  // gives both edges at once, and a ResizeObserver on it catches a chip
  // appearing as well as the window changing size.
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const spacer = document.querySelector('[data-bar-gap]')
    const row = spacer?.parentElement
    if (!spacer || !row) return
    const measure = () => {
      const b = row.getBoundingClientRect()
      const s = spacer.getBoundingClientRect()
      // Decided here rather than at render, because the answer depends on
      // the previous answer: a showing island is harder to dislodge, which
      // is what stops it blinking as the bar's chips come and go.
      setVisible((was) => showsCentred(b.width, s.left - b.left, s.right - b.left, COMPACT.w, was))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    ro.observe(spacer)
    return () => ro.disconnect()
  }, [])

  // A running pomodoro is a live activity: derived, not pushed, so it ends by
  // no longer being derived rather than by expiring.
  // Polled only while the app is on and allowed in the notch, so someone who
  // never switches it on is never asked for Automation permission at all.
  const musicOn = useUi((u) => u.apps.on.music) && islandOn.music
  const media = useNowPlaying(musicOn)

  const live: IslandEvent[] = []
  if (media.now && media.since !== null) {
    // `at` is when playback started, not when we last looked: a moment that
    // moved every two seconds would always rank newest and would starve
    // every alert behind it.
    live.push({
      id: `music-live-${media.since}`,
      app: 'music',
      kind: 'live',
      title: trackLabel(media.now),
      at: media.since,
    })
  }
  if (pomoOn && islandOn.pomo && pomo.phase !== 'idle' && pomo.endsAt !== null) {
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

  // A new alert is the one to show, whatever was being shown before.
  const newest = events.length ? events[events.length - 1].id : null
  const seen = useRef(newest)
  useEffect(() => {
    if (newest !== seen.current) {
      seen.current = newest
      if (newest) setNav({ i: 0, dir: 1 })
    }
  }, [newest])

  const at = count ? nav.i % count : 0
  const cur = count ? acts[at] : null
  const pinned = !!cur && expanded === cur.id
  // An alert is news for six seconds, then it collapses to compact. Hovering
  // or clicking holds it open — you reached for it, so it waits.
  const fresh = !!cur && cur.kind === 'alert' && now - cur.at < COLLAPSE_MS
  const open = !!cur && (pinned || fresh || (cur.kind === 'alert' && hover))
  const actions = pinned && !!cur && isReminderId(cur.app)

  useEffect(() => {
    // Never cycle away from something that is open: it would expand, be read
    // for four seconds, collapse, and expand again — a wobble, not a rotation.
    if (count < 2 || hover || expanded || open) return
    const t = setInterval(() => go(1), CYCLE_MS)
    return () => clearInterval(t)
  }, [count, hover, expanded])

  // Only the compact footprint decides: an alert is wider, but it hangs below
  // the bar where there is nothing to run into.
  if (!visible) return null

  const mode = !cur ? 'idle' : open ? 'alert' : 'compact'
  const width = mode === 'idle' ? IDLE.w : mode === 'compact' ? COMPACT.w : ALERT.w
  const height = mode === 'idle' ? IDLE.h : mode === 'compact' ? COMPACT.h : actions ? ACTIONS_H : ALERT.h
  const hue = cur ? hueOf(cur.app) : WHITE
  const livePomo = cur?.kind === 'live' && cur.app === 'pomo'
  const liveMusic = cur?.kind === 'live' && cur.app === 'music' && !!media.now
  const ringFill = livePomo ? pomoProgress(pomo, pomoSet, now) : null
  const btn =
    'h-7 px-2.5 flex items-center justify-center rounded-rs text-[12px] cursor-pointer whitespace-nowrap flex-none'

  return (
    <div
      data-island
      // No data-tauri-drag-region: dragging the window from here would eat
      // every click the island exists to receive.
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onWheel={(e) => {
        if (count < 2) return
        e.preventDefault()
        go(e.deltaY > 0 ? 1 : -1)
      }}
      onClick={() => cur && expandIsland(pinned ? null : cur.id)}
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        transform: 'translateX(-50%)',
        width,
        height,
        background: '#000',
        borderBottomLeftRadius: mode === 'idle' ? 4 : 14,
        borderBottomRightRadius: mode === 'idle' ? 4 : 14,
        overflow: 'hidden',
        // Above the dock, which sits at 20. The title bar's own stacking
        // context already clears it; this says so anyway.
        zIndex: 24,
        pointerEvents: mode === 'idle' ? 'none' : 'auto',
        cursor: mode === 'idle' ? 'default' : 'pointer',
        transition: reduced
          ? 'none'
          : `width ${MOTION}ms ${SPRING}, height ${MOTION}ms ${SPRING}, border-radius ${MOTION}ms ${SPRING}`,
      }}
    >
      {cur && (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-2.5 flex-none" style={{ height: COMPACT.h }}>
            <span
              key={cur.id}
              className={`flex items-center gap-2 flex-1 min-w-0 ${nav.dir < 0 ? 'cw-swap-back' : 'cw-swap-on'}`}
            >
            <span style={{ color: hue, width: 20, height: 20 }} className="grid place-items-center flex-none">
              <Glyph app={cur.app} progress={ringFill} hue={hue} />
            </span>

            <span className="flex-1 min-w-0 overflow-hidden">
              {liveMusic && media.now ? (
                <Scrolling text={trackLabel(media.now)} reduced={reduced} />
              ) : livePomo && pomo.phase === 'break' ? (
                <BreakLine reduced={reduced} now={now} />
              ) : livePomo ? (
                <span className="text-[12px] font-mono tabular-nums" style={{ color: WHITE }}>
                  {pomoClock(pomoLeft(pomo, now))}
                  <span className="font-ui text-[11px]" style={{ color: DIM }}>
                    {' '}
                    focus
                  </span>
                </span>
              ) : (
                <span
                  className="text-[12px] font-medium block overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ color: WHITE }}
                >
                  {cur.title}
                </span>
              )}
            </span>
            </span>

            {liveMusic && <Bars playing={!!media.now?.playing} hue={hue} />}

            {count > 1 && <Dots count={count} at={at} onPick={jump} />}

            {open && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  dismissIsland(cur.id)
                }}
                title="Dismiss"
                style={{ color: FAINT }}
                className="w-5 h-5 grid place-items-center rounded-rs flex-none cursor-pointer hover:text-white"
              >
                <CloseIcon size={11} />
              </span>
            )}
          </div>

          {open && (
            <div className="px-2.5 pb-2.5 flex flex-col gap-2 flex-1 min-h-0">
              {liveMusic && media.now && (
                <div className="flex items-center gap-2.5">
                  {media.now.artworkUrl ? (
                    // Spotify hands out a URL; Music does not, and Windows
                    // gives a stream rather than a link. Hence the fallback.
                    <img
                      src={media.now.artworkUrl}
                      alt=""
                      style={{ width: 34, height: 34, borderRadius: 4 }}
                      className="flex-none object-cover"
                    />
                  ) : (
                    <span
                      style={{ width: 34, height: 34, borderRadius: 4, background: 'rgba(255,255,255,0.08)', color: hue }}
                      className="flex-none grid place-items-center"
                    >
                      <NoteIcon size={16} />
                    </span>
                  )}
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span
                      className="text-[11.5px] overflow-hidden text-ellipsis whitespace-nowrap"
                      style={{ color: DIM }}
                    >
                      {media.now.artist || media.now.app}
                    </span>
                    <span className="text-[10.5px]" style={{ color: FAINT }}>
                      {media.now.app}
                    </span>
                  </span>
                  <span className="flex items-center gap-0.5 flex-none">
                    {(
                      [
                        ['prev', <SkipIcon key="p" size={13} back />, 'Previous'],
                        [
                          'toggle',
                          media.now.playing ? <PauseIcon key="t" size={13} /> : <PlayIcon key="t" size={13} />,
                          media.now.playing ? 'Pause' : 'Play',
                        ],
                        ['next', <SkipIcon key="n" size={13} />, 'Next'],
                      ] as const
                    ).map(([action, glyph, label]) => (
                      <span
                        key={action}
                        title={label}
                        onClick={(e) => {
                          e.stopPropagation()
                          void ipc.mediaControl(action).catch(() => {})
                        }}
                        style={{ color: WHITE }}
                        className="w-7 h-7 grid place-items-center rounded-rs cursor-pointer hover:bg-white/10"
                      >
                        {glyph}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {liveMusic && media.now && media.now.durationMs > 0 && (
                <span style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.14)' }} className="block">
                  <span
                    style={{ width: `${progress(media.now) * 100}%`, height: 2, borderRadius: 1, background: hue }}
                    className="block"
                  />
                </span>
              )}
              {cur.body && (
                <span className="text-[11.5px] leading-[1.4]" style={{ color: DIM }}>
                  {cur.body}
                </span>
              )}
              {actions && isReminderId(cur.app) && (
                // The same commands the dock popover calls, so acknowledging
                // here clears the tile and the notch together.
                <div className="flex gap-1.5 flex-wrap">
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      acknowledge(cur.app as ReminderId)
                    }}
                    style={{ background: hue, color: '#000' }}
                    className={`${btn} font-medium`}
                  >
                    {appById(cur.app).ack}
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      snooze(cur.app as ReminderId)
                    }}
                    style={{ border: `1px solid ${FAINT}`, color: WHITE }}
                    className={btn}
                  >
                    In {snoozeMin} min
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      skip(cur.app as ReminderId)
                    }}
                    style={{ border: `1px solid ${FAINT}`, color: DIM }}
                    className={btn}
                  >
                    Skip
                  </div>
                </div>
              )}
              {!actions && isReminderId(cur.app) && (
                <span className="text-[11px]" style={{ color: FAINT }}>
                  Click for what to do about it.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// The notch island: what shows in the pill at the top of the title bar.
//
// From the brief of 9 Oct 2026. The reason it exists is that a nudge should
// not depend on the system allowing notifications: macOS can refuse, and then
// a reminder only ever reaches the dock, which you are not looking at. The
// island is inside our own window, so it always works — with one honest limit,
// that it is invisible while the window is.
//
// Two kinds of thing show there:
//
//   · an alert — something just happened, and it is news for a short while
//   · a live activity — something is running now (a pomodoro, music)
//
// Live activities are derived from state each render; alerts are pushed and
// kept in ui.island. Both arrive here as events and are ranked together, so
// the island never has to know which is which.
//
// Everything in this file is pure. The component reads it; nothing here
// touches the DOM.
import { type AppId } from './apps'

/** Music is not a mini app — it has no tile and no switch of its own — but it
 *  announces like one, so the island treats it as another source. */
export type IslandApp = AppId | 'music'

export type IslandKind = 'alert' | 'live'

export interface IslandEvent {
  /** Stable per app and moment, so React keys survive a re-rank. */
  id: string
  app: IslandApp
  kind: IslandKind
  title: string
  body?: string
  /** When it happened, or when a live activity began. Epoch ms. */
  at: number
  /** How long an alert stays news. Live activities ignore it. */
  ttlMs?: number
}

/** The island rotates through at most this many. More than four and the dots
 *  stop being countable at a glance, which is the only thing they are for. */
export const MAX = 4

/** How long an alert remains an activity at all. Five minutes, the same span
 *  a reminder holds for a waiting session: a nudge you have ignored that long
 *  is no longer news. The dock tile stays due either way — leaving the island
 *  is not the same as being dealt with. */
export const ALERT_TTL_MS = 5 * 60 * 1000

/** How long a fresh alert stays expanded before it collapses to compact. */
export const COLLAPSE_MS = 6000

/** How long each activity holds the island before the next one. */
export const CYCLE_MS = 4000

/** A pomodoro phase change is announced, but the phase it hands over to is a
 *  live activity that says the same thing for the rest of its run. So that
 *  alert is deliberately short-lived: once it goes, the ring comes back. */
export const PHASE_ALERT_MS = 8000

/** Clear space to keep either side of the island. */
export const GUTTER = 12

/**
 * Whether a box of width `w`, centred in a bar `barW` wide, clears the
 * clusters on either side of it.
 *
 * `leftRight` is the right edge of everything on the left — the wordmark, the
 * workspace switch, the mode control, the new-terminal button, the waiting
 * chip and the update chip — and `rightLeft` is the left edge of everything
 * on the right. Both are measured from the bar's own left edge.
 *
 * A window width will not do here. The root is 1080px at its narrowest, so a
 * width test protects a twenty-pixel band and nothing else, while the left
 * cluster alone can pass the centre of a wide window once it carries two
 * workspace names and both chips.
 */
export function fitsCentred(barW: number, leftRight: number, rightLeft: number, w: number, gutter = GUTTER): boolean {
  // Nothing measured yet, or an environment with no layout. Showing is the
  // safer default: hiding on a failed measurement hides it for good.
  if (barW <= 0) return true
  // The clusters have met. There is no gap to be in the middle of.
  if (rightLeft <= leftRight) return false
  const mid = barW / 2
  const half = w / 2
  return mid - half >= leftRight + gutter && mid + half <= rightLeft - gutter
}

/** Every source that can have a "Show in notch" switch. */
export const ISLAND_KEYS: readonly IslandApp[] = ['water', 'stand', 'pomo', 'warm', 'sys', 'music']

/** The ones with something to announce. Warm colours changes how the window
 *  looks and the stats gauge is a gauge; neither has news. */
const ANNOUNCES: readonly IslandApp[] = ['water', 'stand', 'pomo', 'music']
export const canAnnounce = (app: IslandApp): boolean => ANNOUNCES.includes(app)

/** During a break the island says what a break is for, scrolling. */
export const BREAK_MARQUEE = '☕ Break · stretch · breathe · look away 🌿'

/** The same thing a word at a time, for anyone who has asked for less motion:
 *  a marquee is exactly the kind of movement that setting turns off. */
export const BREAK_WORDS: readonly string[] = ['Stretch', 'Breathe', 'Look away', 'Walk a bit']

export interface IslandState {
  events: IslandEvent[]
  /** The activity opened by a click, which holds it open and shows its
   *  actions. Null while nothing is pinned open. */
  expanded: string | null
}

export const freshIsland = (): IslandState => ({ events: [], expanded: null })

export const islandId = (app: IslandApp, at: number): string => `${app}-${at}`

/** Whether an alert has stopped being news. A live activity never expires:
 *  it ends by no longer being derived. */
export function expired(e: IslandEvent, now: number): boolean {
  if (e.kind === 'live') return false
  return now - e.at >= (e.ttlMs ?? ALERT_TTL_MS)
}

/**
 * What the island should be showing, newest first.
 *
 * Expiry is applied before the dedupe so that an alert which has just run out
 * cannot suppress a live activity from the same app that is still going — the
 * pomodoro case, where "Time for a break" is pushed at the same moment the
 * break itself starts running.
 */
export function rankActivities(events: readonly IslandEvent[], now: number): IslandEvent[] {
  const live = events.filter((e) => !expired(e, now))
  // One per app: a second nudge from the same app replaces the first rather
  // than queueing behind it, the same rule the dock follows for not stacking.
  const newest = new Map<IslandApp, IslandEvent>()
  for (const e of live) {
    const had = newest.get(e.app)
    if (!had || e.at > had.at) newest.set(e.app, e)
  }
  return [...newest.values()].sort((a, b) => b.at - a.at).slice(0, MAX)
}

/** Raw events are capped too, well above MAX: ranking throws most of them
 *  away, and an app that announces in a loop must not grow the array. */
const RAW_CAP = 8

/** A pushed alert, with any earlier one from the same app replaced. */
export function withPushed(events: readonly IslandEvent[], e: IslandEvent): IslandEvent[] {
  return [...events.filter((x) => x.app !== e.app), e].slice(-RAW_CAP)
}

/** Dealt with: everything this app had to say goes. Acknowledging in the dock
 *  and acknowledging in the island are the same command, so both end here. */
export const withoutApp = (events: readonly IslandEvent[], app: IslandApp): IslandEvent[] =>
  events.filter((e) => e.app !== app)

export const withoutId = (events: readonly IslandEvent[], id: string): IslandEvent[] =>
  events.filter((e) => e.id !== id)

/** The next activity along, wrapping. Returns 0 when there is nothing. */
export function nextIndex(count: number, i: number, delta: number): number {
  if (count <= 0) return 0
  return (((i + delta) % count) + count) % count
}

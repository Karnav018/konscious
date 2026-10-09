import { describe, expect, it } from 'vitest'

import {
  ALERT_TTL_MS,
  GUTTER,
  HYSTERESIS,
  BREAK_WORDS,
  canAnnounce,
  expired,
  freshIsland,
  type IslandApp,
  type IslandEvent,
  islandId,
  ISLAND_KEYS,
  MAX,
  nextIndex,
  showsCentred,
  rankActivities,
  withoutApp,
  withoutId,
  withPushed,
} from './island'

const now = 1_700_000_000_000

const alert = (app: IslandApp, at: number, over: Partial<IslandEvent> = {}): IslandEvent => ({
  id: islandId(app, at),
  app,
  kind: 'alert',
  title: app,
  at,
  ...over,
})

const liveAt = (app: IslandApp, at: number): IslandEvent => ({ ...alert(app, at), kind: 'live' })

describe('an event stops being news', () => {
  it('keeps an alert inside its lifetime', () => {
    expect(expired(alert('water', now - 1000), now)) .toBe(false)
  })

  it('drops one past it', () => {
    expect(expired(alert('water', now - ALERT_TTL_MS - 1), now)).toBe(true)
  })

  it('honours a shorter lifetime when the event asks for one', () => {
    const brief = alert('pomo', now - 9000, { ttlMs: 8000 })
    expect(expired(brief, now)).toBe(true)
  })

  it('never expires a live activity, however old', () => {
    expect(expired(liveAt('pomo', now - 60 * 60_000), now)).toBe(false)
  })
})

describe('what the island shows', () => {
  it('keeps live activities and unexpired alerts, and drops the rest', () => {
    const got = rankActivities(
      [liveAt('music', now - 10 * 60_000), alert('water', now - 30_000), alert('stand', now - ALERT_TTL_MS - 1)],
      now,
    )
    expect(got.map((e) => e.app)).toEqual(['water', 'music'])
  })

  it('sorts most recent first', () => {
    const got = rankActivities([alert('water', now - 9000), alert('stand', now - 1000), liveAt('pomo', now - 5000)], now)
    expect(got.map((e) => e.app)).toEqual(['stand', 'pomo', 'water'])
  })

  it('caps at MAX, keeping the newest', () => {
    const many = [
      alert('water', now - 5000),
      alert('stand', now - 4000),
      alert('pomo', now - 3000),
      alert('music', now - 2000),
      alert('sys', now - 1000),
    ]
    const got = rankActivities(many, now)
    expect(got).toHaveLength(MAX)
    expect(got.map((e) => e.app)).toEqual(['sys', 'music', 'pomo', 'stand'])
  })

  it('keeps one per app: a newer event replaces an older one', () => {
    const got = rankActivities([alert('water', now - 9000), alert('water', now - 1000)], now)
    expect(got).toHaveLength(1)
    expect(got[0].at).toBe(now - 1000)
  })

  it('lets a live activity through when the same app has an expired alert', () => {
    // The pomodoro case: "Time for a break" is pushed at the moment the break
    // starts, so once the alert runs out the running break must come back
    // rather than be deduped away by it.
    const got = rankActivities(
      [alert('pomo', now - 20_000, { ttlMs: 8000 }), liveAt('pomo', now - 20_000)],
      now,
    )
    expect(got.map((e) => e.kind)).toEqual(['live'])
  })

  it('lets the earlier argument win a tie, so an alert beats the phase it starts', () => {
    // The island passes alerts before live activities for exactly this: a
    // pomodoro's "time for a break" is pushed at the same millisecond the
    // break begins running, and for its few seconds it is the thing to say.
    const got = rankActivities([alert('pomo', now, { ttlMs: 8000 }), liveAt('pomo', now)], now)
    expect(got.map((e) => e.kind)).toEqual(['alert'])
    // Ordered the other way round, the live one wins — which is why order
    // matters at the call site.
    expect(rankActivities([liveAt('pomo', now), alert('pomo', now)], now).map((e) => e.kind)).toEqual(['live'])
  })

  it('shows nothing when there is nothing', () => {
    expect(rankActivities([], now)).toEqual([])
    expect(freshIsland()).toEqual({ events: [], expanded: null })
  })
})

describe('pushing and clearing', () => {
  it('replaces an app’s earlier alert rather than queueing behind it', () => {
    const one = withPushed([], alert('water', now - 9000))
    const two = withPushed(one, alert('water', now))
    expect(two).toHaveLength(1)
    expect(two[0].at).toBe(now)
  })

  it('keeps other apps when one pushes', () => {
    const got = withPushed([alert('stand', now - 1000)], alert('water', now))
    expect(got.map((e) => e.app)).toEqual(['stand', 'water'])
  })

  it('bounds the raw list however often an app announces', () => {
    let events: IslandEvent[] = []
    for (let i = 0; i < 40; i++) events = withPushed(events, alert(`x${i}` as IslandApp, now + i))
    expect(events.length).toBeLessThanOrEqual(8)
  })

  it('clears everything an app had to say', () => {
    const got = withoutApp([alert('water', now), alert('stand', now)], 'water')
    expect(got.map((e) => e.app)).toEqual(['stand'])
  })

  it('clears one event by id', () => {
    const a = alert('water', now)
    expect(withoutId([a, alert('stand', now)], a.id).map((e) => e.app)).toEqual(['stand'])
  })
})

describe('cycling through them', () => {
  it('wraps forward and back', () => {
    expect(nextIndex(3, 2, 1)).toBe(0)
    expect(nextIndex(3, 0, -1)).toBe(2)
    expect(nextIndex(3, 1, 1)).toBe(2)
  })

  it('stays at 0 with nothing to cycle', () => {
    expect(nextIndex(0, 0, 1)).toBe(0)
    expect(nextIndex(0, 3, -1)).toBe(0)
  })
})

describe('which apps can speak', () => {
  it('offers a switch for every source', () => {
    expect(ISLAND_KEYS).toContain('music')
    expect(new Set(ISLAND_KEYS).size).toBe(ISLAND_KEYS.length)
  })

  it('only lets through the ones with news', () => {
    expect(canAnnounce('water')).toBe(true)
    expect(canAnnounce('pomo')).toBe(true)
    expect(canAnnounce('music')).toBe(true)
    // A gauge and a colour shift have nothing to announce.
    expect(canAnnounce('sys')).toBe(false)
    expect(canAnnounce('warm')).toBe(false)
  })

  it('has something to say on a break without a marquee', () => {
    expect(BREAK_WORDS.length).toBeGreaterThan(1)
  })
})

describe('where the island goes', () => {
  // It is a notch: it is centred or it is not there. The island is 220 wide
  // compact. A window width cannot answer this — the app root is 1080px at
  // its narrowest, so a width test would only ever cover 1080 to 1100.
  const W = 220

  it('shows when the gap straddles the middle with room to spare', () => {
    // A 1920 bar whose clusters end at 700 and start at 1200: the island
    // spans 850–1070, well inside.
    expect(showsCentred(1920, 700, 1200, W)).toBe(true)
  })

  it('goes rather than sit off to one side', () => {
    // 1280 wide, a 570px gap — easily wide enough for the pill, but it does
    // not straddle the centre, and off-centre it stops reading as a notch.
    expect(showsCentred(1280, 700, 1270, W)).toBe(false)
  })

  it('goes when a cluster reaches past the centre, however wide the window', () => {
    expect(showsCentred(1920, 1000, 1800, W)).toBe(false)
  })

  it('goes once the clusters have met', () => {
    expect(showsCentred(1280, 800, 800, W)).toBe(false)
    expect(showsCentred(1280, 820, 800, W)).toBe(false)
  })

  it('keeps a gutter on each side rather than touching', () => {
    const mid = 640
    expect(showsCentred(1280, mid - W / 2, mid + W / 2, W)).toBe(false)
    expect(showsCentred(1280, mid - W / 2 - GUTTER, mid + W / 2 + GUTTER, W)).toBe(true)
  })

  it('shows when nothing has been measured, rather than hiding for good', () => {
    expect(showsCentred(0, 0, 0, W)).toBe(true)
  })

  it('judges by the tighter side, since it is centred', () => {
    // Acres of room on the left, none on the right: still no.
    expect(showsCentred(1280, 100, 700, W)).toBe(false)
  })
})

describe('the island does not blink', () => {
  // The title bar breathes while you work. The "N waiting" chip is about
  // ninety pixels and comes and goes as sessions change state, so a
  // measurement right at the threshold flips back and forth with it — and
  // the pill appeared and disappeared several times a minute.
  const W = 220
  const need = W / 2 + GUTTER

  /** A bar 1280 wide whose clusters leave `room` either side of centre. */
  const bar = (room: number, showing: boolean) =>
    showsCentred(1280, 640 - room, 640 + room, W, showing)

  it('lets it in only with the full clearance', () => {
    expect(bar(need, false)).toBe(true)
    expect(bar(need - 1, false)).toBe(false)
  })

  it('keeps it once it is there, through a chip appearing', () => {
    expect(bar(need - 1, true)).toBe(true)
    expect(bar(need - HYSTERESIS + 1, true)).toBe(true)
  })

  it('still gives up the place when the bar is genuinely tighter', () => {
    expect(bar(need - HYSTERESIS - 1, true)).toBe(false)
  })

  it('does not flip back and forth across one chip’s width', () => {
    // 45px: half the waiting chip, so either edge of it moves the gap by
    // about this much. Sitting just inside the threshold, the island must
    // survive the chip arriving.
    const jiggle = 45
    let showing = bar(need + 4, false)
    expect(showing).toBe(true)
    for (let i = 0; i < 6; i++) {
      // the chip appears, then goes, then appears...
      showing = bar(need + 4 - (i % 2 ? 0 : jiggle / 2), showing)
      expect(showing, `blinked off on pass ${i}`).toBe(true)
    }
  })
})

import { describe, expect, it } from 'vitest'

import {
  ALERT_TTL_MS,
  GUTTER,
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
  placeIsland,
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
  // The island is 220 wide compact. A window width cannot answer this: the
  // app root is 1080px at its narrowest, so a width test would only ever
  // cover the band between 1080 and 1100.
  const W = 220

  it('centres it when the gap straddles the middle with room to spare', () => {
    // A 1920 bar whose clusters end at 700 and start at 1200: the island
    // spans 850–1070, well inside.
    expect(placeIsland(1920, 700, 1200, W)).toEqual({ centred: true })
  })

  it('nudges it into the gap at 1280 with both chips showing', () => {
    // 84px of traffic-light inset, the wordmark, two workspace segments, the
    // mode control, the new-terminal button, a waiting chip and an update
    // chip put the left cluster's edge around 700, and the right cluster
    // starts around 1270. The centre is 640, so centred it would want
    // 530–750 and run through the left cluster — but the gap is 570 wide and
    // holds it easily, off to the right.
    expect(placeIsland(1280, 700, 1270, W)).toEqual({ centred: false, left: 700 + (570 - W) / 2 })
  })

  it('still nudges when a cluster reaches past the centre entirely', () => {
    const got = placeIsland(1920, 1000, 1800, W)
    expect(got).toEqual({ centred: false, left: 1000 + (800 - W) / 2 })
  })

  it('leaves it out when the gap cannot hold it at all', () => {
    // 1280 wide, clusters at 930 and 1000: a 70px gap for a 220px box.
    expect(placeIsland(1280, 930, 1000, W)).toBeNull()
  })

  it('leaves it out once the clusters have met', () => {
    expect(placeIsland(1280, 800, 800, W)).toBeNull()
    expect(placeIsland(1280, 820, 800, W)).toBeNull()
  })

  it('keeps a gutter on each side rather than touching', () => {
    // Exactly the island's width between the clusters is not enough.
    const mid = 640
    expect(placeIsland(1280, mid - W / 2, mid + W / 2, W)).toBeNull()
    // The island plus a gutter either side is, and centred at that.
    expect(placeIsland(1280, mid - W / 2 - GUTTER, mid + W / 2 + GUTTER, W)).toEqual({ centred: true })
  })

  it('centres it when nothing has been measured, rather than hiding for good', () => {
    expect(placeIsland(0, 0, 0, W)).toEqual({ centred: true })
  })
})

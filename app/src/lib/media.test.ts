import { describe, expect, it } from 'vitest'

import {
  AUTOMATION_SETTINGS,
  BARS,
  barTiming,
  EMPTY,
  IDLE_MS,
  needsMarquee,
  PLAYING_MS,
  pollAfter,
  progress,
  sameTrack,
  type Snapshot,
  startedAt,
  trackLabel,
} from './media'
import type { NowPlaying } from '../types'

const track = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  app: 'Spotify',
  title: 'Teardrop',
  artist: 'Massive Attack',
  playing: true,
  positionMs: 30_000,
  durationMs: 330_000,
  artworkUrl: null,
  ...over,
})

const at = 1_700_000_000_000

describe('telling one track from another', () => {
  it('matches a track against itself however far through it is', () => {
    expect(sameTrack(track(), track({ positionMs: 90_000 }))).toBe(true)
  })

  it('separates a different title, artist or player', () => {
    expect(sameTrack(track(), track({ title: 'Angel' }))).toBe(false)
    expect(sameTrack(track(), track({ artist: 'Portishead' }))).toBe(false)
    expect(sameTrack(track(), track({ app: 'Music' }))).toBe(false)
  })

  it('matches nothing against nothing', () => {
    expect(sameTrack(null, null)).toBe(false)
    expect(sameTrack(track(), null)).toBe(false)
  })
})

describe('when playback started', () => {
  // This is the whole reason the module keeps state: the island ranks a live
  // activity by this moment, and a moment that moved every poll would always
  // be the newest and would starve every alert behind it.
  const playing = (since: number | null, now: NowPlaying | null = track()): Snapshot => ({ now, since, denied: false })

  it('starts the clock when something begins playing', () => {
    expect(startedAt(EMPTY, track(), at)).toBe(at)
  })

  it('holds it while the same track keeps playing', () => {
    const later = startedAt(playing(at), track({ positionMs: 90_000 }), at + 60_000)
    expect(later).toBe(at)
  })

  it('restarts it for a different track', () => {
    expect(startedAt(playing(at), track({ title: 'Angel' }), at + 60_000)).toBe(at + 60_000)
  })

  it('restarts it when a pause is resumed', () => {
    const paused = playing(null, track({ playing: false }))
    expect(startedAt(paused, track(), at + 60_000)).toBe(at + 60_000)
  })

  it('has no clock while nothing plays', () => {
    expect(startedAt(playing(at), null, at + 1000)).toBeNull()
    expect(startedAt(playing(at), track({ playing: false }), at + 1000)).toBeNull()
  })
})

describe('how often to look', () => {
  it('asks often while something plays, and rarely otherwise', () => {
    expect(pollAfter({ now: track(), since: at, denied: false })).toBe(PLAYING_MS)
    expect(pollAfter({ now: track({ playing: false }), since: null, denied: false })).toBe(IDLE_MS)
    expect(pollAfter(EMPTY)).toBe(IDLE_MS)
    expect(PLAYING_MS).toBeLessThan(IDLE_MS)
  })
})

describe('what the island shows', () => {
  it('reads a track as title and artist', () => {
    expect(trackLabel(track())).toBe('Teardrop — Massive Attack')
  })

  it('leaves out an artist the player did not give', () => {
    expect(trackLabel(track({ artist: '' }))).toBe('Teardrop')
    expect(trackLabel(track({ artist: '   ' }))).toBe('Teardrop')
  })

  it('scrolls a long title and leaves a short one still', () => {
    expect(needsMarquee('Teardrop')).toBe(false)
    expect(needsMarquee('Teardrop — Massive Attack')).toBe(false)
    expect(needsMarquee('Everything In Its Right Place — Radiohead')).toBe(true)
  })

  it('measures how far through the track it is', () => {
    expect(progress(track({ positionMs: 165_000, durationMs: 330_000 }))).toBeCloseTo(0.5, 5)
    expect(progress(track({ positionMs: 0 }))).toBe(0)
  })

  it('shows no progress when the player will not say how long it is', () => {
    expect(progress(track({ durationMs: 0 }))).toBe(0)
    expect(progress(null)).toBe(0)
  })

  it('never runs the bar past the end', () => {
    expect(progress(track({ positionMs: 400_000, durationMs: 330_000 }))).toBe(1)
  })
})

describe('the spectrum', () => {
  it('gives every bar its own timing, so the row never moves as a block', () => {
    const timings = Array.from({ length: BARS }, (_, i) => barTiming(i))
    expect(new Set(timings.map((t) => t.durationMs)).size).toBe(BARS)
    expect(new Set(timings.map((t) => t.delayMs)).size).toBe(BARS)
  })

  it('keeps every duration in a range that reads as sound, not as a fault', () => {
    for (const { durationMs, delayMs } of Array.from({ length: BARS }, (_, i) => barTiming(i))) {
      expect(durationMs).toBeGreaterThanOrEqual(900)
      expect(durationMs).toBeLessThanOrEqual(1400)
      expect(delayMs).toBeLessThan(900)
    }
  })
})

describe('the way out of a refusal', () => {
  it('deep-links the exact pane, not just System Settings', () => {
    expect(AUTOMATION_SETTINGS).toContain('Privacy_Automation')
    expect(AUTOMATION_SETTINGS.startsWith('x-apple.systempreferences:')).toBe(true)
  })
})

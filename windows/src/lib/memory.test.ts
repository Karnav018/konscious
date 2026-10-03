// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { formatBytes, HEAVY_BYTES, STALE_MS, totalOf, worthRestarting } from './memory'
import type { SessionMemory } from '../types'

const mb = (n: number) => n * 1024 * 1024
const held = (bytes: number): SessionMemory => ({ id: 's1', bytes, processes: 1 })
const idle = (lastActivityAt: number | null) => ({ running: true, status: 'idle' as const, lastActivityAt })

describe('formatBytes', () => {
  it('reads in the units people think in', () => {
    expect(formatBytes(mb(199))).toBe('199 MB')
    expect(formatBytes(mb(1536))).toBe('1.5 GB')
    expect(formatBytes(1024)).toBe('<1 MB')
  })

  it('shows a dash rather than a zero for nothing measured', () => {
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(-5)).toBe('—')
  })
})

describe('totalOf', () => {
  const memory = { a: held(mb(100)), b: held(mb(50)) }

  it('adds up the sessions asked for, and only those', () => {
    expect(totalOf(memory, ['a', 'b'])).toBe(mb(150))
    expect(totalOf(memory, ['a'])).toBe(mb(100))
  })

  it('counts a session with no figure yet as nothing', () => {
    expect(totalOf(memory, ['a', 'not-measured-yet'])).toBe(mb(100))
    expect(totalOf({}, ['a'])).toBe(0)
    expect(totalOf(memory, [])).toBe(0)
  })
})

describe('worthRestarting', () => {
  const now = 1_000_000_000
  const longAgo = now - STALE_MS - 1

  it('offers when a session is idle, old and heavy', () => {
    expect(worthRestarting(held(HEAVY_BYTES), idle(longAgo), now)).toBe(true)
  })

  it('never interrupts a session that is doing something', () => {
    for (const status of ['working', 'waiting', 'starting'] as const) {
      expect(worthRestarting(held(mb(500)), { running: true, status, lastActivityAt: longAgo }, now)).toBe(false)
    }
  })

  it('stays quiet for a session that is light, fresh, stopped or unmeasured', () => {
    expect(worthRestarting(held(HEAVY_BYTES - 1), idle(longAgo), now)).toBe(false)
    expect(worthRestarting(held(mb(500)), idle(now - STALE_MS + 1000), now)).toBe(false)
    expect(worthRestarting(held(mb(500)), { running: false, status: 'idle', lastActivityAt: longAgo }, now)).toBe(false)
    expect(worthRestarting(undefined, idle(longAgo), now)).toBe(false)
  })

  it('stays quiet when a session has never reported activity', () => {
    expect(worthRestarting(held(mb(500)), idle(null), now)).toBe(false)
  })
})

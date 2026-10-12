import { describe, expect, it } from 'vitest'

import { availableMetrics, shownMetric, statDetail, statValue } from './stats'
import type { Stats } from '../types'

const machine = (over: Partial<Stats> = {}): Stats => ({
  cpu: 42,
  ram: 61,
  ssd: 72,
  tmp: 52,
  gpu: 31,
  gpuUsed: 2 * 1024 ** 3,
  cores: 10,
  ramTotal: 32 * 1024 ** 3,
  ramUsed: 19 * 1024 ** 3,
  ssdTotal: 1000 * 1024 ** 3,
  ssdUsed: 720 * 1024 ** 3,
  ...over,
})

describe('what the machine reports', () => {
  it('counts what the machine reports, and leaves out what it does not', () => {
    expect(availableMetrics(machine())).toEqual(['cpu', 'gpu', 'ram', 'ssd', 'tmp'])
    // Most Apple silicon reports no temperature; a PC may report no readable
    // graphics. Either is dropped from the cycle rather than shown empty.
    expect(availableMetrics(machine({ tmp: null }))).toEqual(['cpu', 'gpu', 'ram', 'ssd'])
    expect(availableMetrics(machine({ gpu: null }))).toEqual(['cpu', 'ram', 'ssd', 'tmp'])
    expect(availableMetrics(machine({ gpu: null, tmp: null }))).toEqual(['cpu', 'ram', 'ssd'])
    expect(availableMetrics(null)).toEqual([])
  })

  it('says what the graphics figure means, or that it cannot tell', () => {
    expect(statValue('gpu', machine())).toBe(31)
    expect(statDetail('gpu', machine())).toBe('2.0 GB of graphics memory held')
    expect(statDetail('gpu', machine({ gpu: null }))).toBe('this machine does not report it')
    // Utilisation without a memory figure is still worth showing.
    expect(statDetail('gpu', machine({ gpuUsed: null }))).toBe('graphics chip')
  })

  it('puts the figures behind each percentage into words', () => {
    const s = machine()
    expect(statDetail('cpu', s)).toBe('4.2 of 10 cores busy')
    expect(statDetail('ram', s)).toBe('19.0 of 32.0 GB in use')
    expect(statDetail('ssd', s)).toBe('720.0 of 1000.0 GB used')
    expect(statDetail('tmp', s)).toContain('fans off')
    expect(statDetail('tmp', machine({ tmp: 80 }))).toContain('audible')
  })

  it('says plainly when a temperature is not available', () => {
    expect(statDetail('tmp', machine({ tmp: null }))).toBe('this machine does not report it')
    expect(statValue('tmp', machine({ tmp: null }))).toBeNull()
  })
})

describe('what the gauge shows', () => {
  const all = ['cpu', 'ram', 'ssd', 'tmp'] as const

  it('cycles through the stats in order, and wraps', () => {
    expect([0, 1, 2, 3, 4].map((t) => shownMetric(all, t, null))).toEqual(['cpu', 'ram', 'ssd', 'tmp', 'cpu'])
  })

  it('holds on the stat you picked', () => {
    expect(shownMetric(all, 2, 'ram')).toBe('ram')
    // One the machine cannot report falls back to cycling.
    expect(shownMetric(['cpu', 'ram'], 1, 'tmp')).toBe('ram')
  })

  it('only cycles through what this machine reports', () => {
    const three = ['cpu', 'ram', 'ssd'] as const
    expect([0, 1, 2, 3].map((t) => shownMetric(three, t, null))).toEqual(['cpu', 'ram', 'ssd', 'cpu'])
  })

  it('shows nothing rather than an empty gauge before the first reading', () => {
    expect(shownMetric([], 0, null)).toBeNull()
    expect(shownMetric([], 3, 'cpu')).toBeNull()
  })
})

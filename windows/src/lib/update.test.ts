import { describe, expect, it } from 'vitest'

import { CHECK_EVERY_MS, updateDetail, updateLabel } from './update'

// Deliberately not a version this app will ever be on: scripts/release.sh
// rewrites every mention of the current version, fixtures included.
const NEXT = '9.9.9'

describe('updateLabel', () => {
  it('says nothing when there is no update', () => {
    expect(updateLabel({ state: 'none' })).toBeNull()
    expect(updateDetail({ state: 'none' })).toBeUndefined()
  })

  it('counts the download up, even before the size is known', () => {
    expect(updateLabel({ state: 'downloading', version: NEXT, percent: null })).toBe('Updating…')
    expect(updateLabel({ state: 'downloading', version: NEXT, percent: 42 })).toBe('Updating… 42%')
  })

  it('asks for the restart once the update is downloaded', () => {
    expect(updateLabel({ state: 'ready', version: NEXT })).toBe('Restart to update')
    // The version belongs in the tooltip: the chip has to stay chip-sized.
    expect(updateDetail({ state: 'ready', version: NEXT })).toContain(NEXT)
    expect(updateDetail({ state: 'ready', version: NEXT })).toContain('resume')
  })

  it('keeps the chip up while installing', () => {
    expect(updateLabel({ state: 'installing', version: NEXT })).toBe('Installing…')
  })
})

describe('check interval', () => {
  it('is hourly', () => {
    expect(CHECK_EVERY_MS).toBe(3_600_000)
  })
})

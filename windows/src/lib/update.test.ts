import { describe, expect, it } from 'vitest'

import { CHECK_EVERY_MS, updateDetail, updateLabel } from './update'

describe('updateLabel', () => {
  it('says nothing when there is no update', () => {
    expect(updateLabel({ state: 'none' })).toBeNull()
    expect(updateDetail({ state: 'none' })).toBeUndefined()
  })

  it('counts the download up, even before the size is known', () => {
    expect(updateLabel({ state: 'downloading', version: '0.2.0', percent: null })).toBe('Updating…')
    expect(updateLabel({ state: 'downloading', version: '0.2.0', percent: 42 })).toBe('Updating… 42%')
  })

  it('asks for the restart once the update is downloaded', () => {
    expect(updateLabel({ state: 'ready', version: '0.2.0' })).toBe('Restart to update')
    // The version belongs in the tooltip: the chip has to stay chip-sized.
    expect(updateDetail({ state: 'ready', version: '0.2.0' })).toContain('0.2.0')
    expect(updateDetail({ state: 'ready', version: '0.2.0' })).toContain('resume')
  })

  it('keeps the chip up while installing', () => {
    expect(updateLabel({ state: 'installing', version: '0.2.0' })).toBe('Installing…')
  })
})

describe('check interval', () => {
  it('is hourly', () => {
    expect(CHECK_EVERY_MS).toBe(3_600_000)
  })
})

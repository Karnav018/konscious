import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHECK_EVERY_MS, updateDetail, updateLabel } from './update'

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('../state/commands/ui', () => ({ setUpdate: vi.fn(), flash: vi.fn() }))

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

// The release files come from GitHub's CDN. On some networks one of its
// addresses never answers, which used to make every check run out of time.
describe('checking', () => {
  beforeEach(() => {
    vi.resetModules() // fresh module state (`staged`, `busy`) per test
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('gives the download its own, longer time limit than the check', async () => {
    const { check } = await import('@tauri-apps/plugin-updater')
    const download = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValue({ version: NEXT, download, close: vi.fn() } as never)
    const m = await import('./update')
    await m.checkForUpdate()
    expect(check).toHaveBeenCalledWith({ timeout: m.CHECK_TIMEOUT_MS })
    expect(download.mock.calls[0][1]).toEqual({ timeout: m.DOWNLOAD_TIMEOUT_MS })
    expect(m.DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(m.CHECK_TIMEOUT_MS)
  })

  it('tries again five minutes after a failed check instead of an hour later', async () => {
    const { check } = await import('@tauri-apps/plugin-updater')
    vi.mocked(check).mockRejectedValueOnce(new Error('timed out')).mockResolvedValue(null)
    const m = await import('./update')
    await m.checkForUpdate()
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(m.RETRY_AFTER_FAILURE_MS - 1)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)
    // A check that finds nothing schedules no further retry.
    await vi.advanceTimersByTimeAsync(m.RETRY_AFTER_FAILURE_MS * 3)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('retries when the download fails part-way, and hands the partial back', async () => {
    const { check } = await import('@tauri-apps/plugin-updater')
    const close = vi.fn().mockResolvedValue(undefined)
    const download = vi.fn().mockRejectedValue(new Error('download timed out'))
    vi.mocked(check).mockResolvedValue({ version: NEXT, download, close } as never)
    const m = await import('./update')
    await m.checkForUpdate()
    expect(close).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(m.RETRY_AFTER_FAILURE_MS)
    expect(check).toHaveBeenCalledTimes(2)
  })
})

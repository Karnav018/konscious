// Background updates.
//
// Konscious checks this repo's GitHub releases shortly after launch and every
// hour after that, and downloads a newer version in the background. Installing
// it is never automatic: the installer closes the app, and that stops every
// live session. So a downloaded update waits in the title bar until you ask
// for the restart — and every session that was running resumes on the way back
// up, which is what makes the restart cheap.
//
// The endpoint and the public key that updates are verified against live in
// src-tauri/tauri.conf.json; an update that isn't signed by the matching
// private key is refused.
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

import { flash, setUpdate } from '../state/commands/ui'
import type { UpdateState } from '../state/store'

export const CHECK_EVERY_MS = 60 * 60 * 1000
/** Launch is busy resuming sessions; the first check waits for the quiet. */
export const FIRST_CHECK_MS = 20_000
/** A release server that never answers must not leave the check wedged. */
const CHECK_TIMEOUT_MS = 30_000

/** The downloaded update, held until the user restarts. */
let staged: Update | null = null
/** One check (or install) at a time: the hourly tick must not overlap itself. */
let busy = false

/** The title-bar chip's text, or null when there is nothing to say. */
export function updateLabel(u: UpdateState): string | null {
  switch (u.state) {
    case 'none':
      return null
    case 'downloading':
      return u.percent == null ? 'Updating…' : `Updating… ${u.percent}%`
    case 'ready':
      return 'Restart to update'
    case 'installing':
      return 'Installing…'
  }
}

/** The chip's tooltip: what the restart will do, and to what. */
export function updateDetail(u: UpdateState): string | undefined {
  switch (u.state) {
    case 'none':
      return undefined
    case 'downloading':
      return `Downloading Konscious ${u.version} in the background`
    case 'ready':
      return `Konscious ${u.version} is downloaded. Restart to use it — every running session resumes.`
    case 'installing':
      return `Installing Konscious ${u.version}`
  }
}

/**
 * Ask GitHub once, and download anything newer. A failure here is quiet: the
 * next hourly tick retries, and a missed update is not worth a toast.
 */
export async function checkForUpdate(): Promise<void> {
  if (busy || staged) return
  busy = true
  // Held outside the try so a failure can hand the resource back.
  let opened: Update | null = null
  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS })
    if (!update) return
    opened = update
    setUpdate({ state: 'downloading', version: update.version, percent: null })
    let total = 0
    let got = 0
    let shown = -1
    await update.download((e) => {
      if (e.event === 'Started') total = e.data.contentLength ?? 0
      if (e.event !== 'Progress') return
      got += e.data.chunkLength
      if (!total) return
      // Only on a whole-percent change: this fires per chunk.
      const percent = Math.min(99, Math.floor((got / total) * 100))
      if (percent === shown) return
      shown = percent
      setUpdate({ state: 'downloading', version: update.version, percent })
    })
    staged = update
    setUpdate({ state: 'ready', version: update.version })
  } catch (e) {
    console.warn('[update] check failed', e)
    setUpdate({ state: 'none' })
    // An Update holds the bytes downloaded so far on the Rust side. Hand a
    // half-download back instead of carrying it until the app quits.
    if (opened && opened !== staged) await opened.close().catch(() => {})
  } finally {
    busy = false
  }
}

/**
 * Install what's downloaded and come back up. The sessions that were running
 * are already recorded on disk (each one is saved the moment it starts), so
 * they resume either way.
 */
export async function installUpdate(): Promise<void> {
  const update = staged
  if (!update || busy) return
  busy = true
  setUpdate({ state: 'installing', version: update.version })
  try {
    await update.install()
    // Windows does not reach this line: `install` hands over to the NSIS
    // installer, which closes the app and reopens it. On macOS the bundle is
    // swapped in place and the relaunch is ours to do.
    await relaunch()
  } catch (e) {
    console.error('[update] install failed', e)
    setUpdate({ state: 'ready', version: update.version })
    flash(`Could not install the update: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    busy = false
  }
}

/** Called once from bootstrap (app/bootstrap.ts). */
export function startUpdateChecks() {
  // `tauri dev` runs an unbundled binary: there is nothing an update could
  // replace, and the updater errors instead of saying so.
  if (import.meta.env.DEV) return
  const tick = () => void checkForUpdate()
  setTimeout(tick, FIRST_CHECK_MS)
  setInterval(tick, CHECK_EVERY_MS)
}

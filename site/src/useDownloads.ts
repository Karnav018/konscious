import { useSyncExternalStore } from 'react'

import { formatSize, latestApi, latestPage, parseRelease, type Os, type Release } from './release'
import { site } from './site'

/** The newest release when the site was built (vite.config.ts), or null. */
declare const __LATEST_RELEASE__: Release | null

// The page starts with the release that was newest when it was built, then
// asks GitHub once per visit for the current one. So a release CI publishes
// shows up here straight away, without deploying the site. GitHub allows 60
// unauthenticated requests an hour per visitor address: the answer is kept for
// ten minutes per tab, and a failed request just keeps what the page has.
const CACHE_KEY = 'konscious:latest-release'
const CACHE_MS = 10 * 60 * 1000

let current: Release | null = __LATEST_RELEASE__
const listeners = new Set<() => void>()
let asked = false

function publish(release: Release) {
  current = release
  for (const l of listeners) l()
}

function fromCache(): Release | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null')
    return saved && Date.now() - saved.at < CACHE_MS ? (saved.release as Release) : null
  } catch {
    return null
  }
}

function toCache(release: Release) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }))
  } catch {
    // Private mode or storage off: the next visit asks GitHub again.
  }
}

function askGitHub() {
  if (asked) return
  asked = true
  const cached = fromCache()
  if (cached) return publish(cached)
  fetch(latestApi, { headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json) => {
      const release = parseRelease(json)
      if (!release) return
      toCache(release)
      publish(release)
    })
    .catch(() => {})
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  askGitHub()
  return () => listeners.delete(listener)
}

export function useRelease(): Release | null {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

export interface DownloadOption {
  os: Os
  label: string
  detail: string
  /** The installer, or the release page when there is none to link. */
  url: string
  /** Set when `url` is the installer itself. */
  name?: string
  size?: string
}

/** Download buttons for both platforms, pointing at the newest release. */
export function useDownloads() {
  const release = useRelease()
  const option = (os: Os): DownloadOption => {
    const file = release?.installers[os]
    return {
      os,
      label: site.downloads[os].label,
      detail: site.downloads[os].detail,
      url: file?.url ?? release?.page ?? latestPage,
      name: file?.name,
      size: file ? formatSize(file.bytes) : undefined,
    }
  }
  return { version: release?.version, page: release?.page ?? latestPage, mac: option('mac'), windows: option('windows') }
}

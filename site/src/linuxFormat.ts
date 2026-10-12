// Which Linux package the visitor wants: the AppImage unless they pick the
// .deb. One choice for the whole page (hero, header, download section), and
// remembered in this browser for the next visit.
import { useSyncExternalStore } from 'react'

import { LINUX_FORMATS, type LinuxFormat } from './release'

const KEY = 'konscious:linux-format'
const listeners = new Set<() => void>()

function saved(): LinuxFormat {
  try {
    const v = localStorage.getItem(KEY)
    return LINUX_FORMATS.some((f) => f.id === v) ? (v as LinuxFormat) : 'appimage'
  } catch {
    return 'appimage'
  }
}

let current: LinuxFormat = saved()

export function setLinuxFormat(format: LinuxFormat) {
  current = format
  try {
    localStorage.setItem(KEY, format)
  } catch {
    // Private mode or storage off: the choice lasts for this page only.
  }
  for (const l of listeners) l()
}

export function useLinuxFormat(): LinuxFormat {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => current,
  )
}

import { IS_WINDOWS } from './platform'
import type { Status } from '../types'

export const STATUS_LABEL: Record<Status, string> = {
  starting: 'Starting',
  working: 'Working',
  waiting: 'Waiting',
  idle: 'Idle',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
}

/** Design `Component.SC`. */
export const STATUS_COLOR: Record<Status, string> = {
  starting: 'var(--info)',
  working: 'var(--ok)',
  waiting: 'var(--warn)',
  idle: 'var(--info)',
  completed: 'var(--faint)',
  failed: 'var(--err)',
  stopped: 'var(--faint)',
}

export const isEnded = (s: Status) => s === 'completed' || s === 'failed' || s === 'stopped'

export function clock(ms: number | null | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "now", "6m", "13:08", "yesterday" — the design's compact activity times. */
export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '—'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const d = new Date(ms)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return clock(ms)
  const y = new Date(now - 86_400_000)
  if (d.toDateString() === y.toDateString()) return 'yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

/** 791000 → "791k", 1000000 → "1M". */
export function tokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  return `${Math.round(n / 1000)}k`
}

/** "resets in 2h 14m" within a day, else "resets Thu 09:00". */
export function resetsIn(epochSec: number | null | undefined, now = Date.now()): string {
  if (!epochSec) return 'reset time unknown'
  const ms = epochSec * 1000 - now
  if (ms <= 0) return 'resetting now'
  const mins = Math.round(ms / 60_000)
  if (mins < 24 * 60) return `resets in ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)}h ` : ''}${mins % 60}m`
  const d = new Date(epochSec * 1000)
  return `resets ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(d.getTime())}`
}

/** Design thresholds: ok → warn at 60% → err at 85% (usage bar). */
export const usageColor = (pct: number) => (pct >= 85 ? 'var(--err)' : pct >= 60 ? 'var(--warn)' : 'var(--ok)')

export function tildify(path: string, home: string | undefined, win = IS_WINDOWS): string {
  if (home && (path === home || path.startsWith(home + '/'))) return '~' + path.slice(home.length)
  if (win && home && path.startsWith(home + '\\')) return '~' + path.slice(home.length)
  return path
}

/** Path relative to the workspace root, as the design shows it (`./backend`). */
export function relTo(path: string, root: string, win = IS_WINDOWS): string {
  if (path === root) return '.'
  if (path.startsWith(root + '/')) return './' + path.slice(root.length + 1)
  if (win && path.startsWith(root + '\\')) return '.\\' + path.slice(root.length + 1)
  return path
}

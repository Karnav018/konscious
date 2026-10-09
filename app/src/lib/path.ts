// Path helpers. macOS paths use "/" only — "\" is a legal filename character
// there — and each helper's Mac branch is the exact expression the app has
// always used. Windows paths ("C:\Users\k\app") accept both separators and
// keep drive roots intact ("C:" alone would mean the drive's current folder).
import { IS_LINUX, IS_WINDOWS } from './platform'

const DRIVE = /^[A-Za-z]:$/
const DRIVE_ROOT = /^[A-Za-z]:[\\/]$/

/** Drops trailing separators; a root stays a root. */
export function trimSep(p: string, win = IS_WINDOWS): string {
  if (!win) return p.replace(/\/+$/, '') || '/'
  const t = p.replace(/[\\/]+$/, '')
  if (!t) return p ? '\\' : p
  return DRIVE.test(t) ? t + '\\' : t
}

export function isRoot(p: string, win = IS_WINDOWS): boolean {
  if (!win) return p === '/'
  return p === '\\' || p === '/' || DRIVE_ROOT.test(p)
}

export function basename(p: string, win = IS_WINDOWS): string {
  if (!win) return p.replace(/\/+$/, '').split('/').pop() || p
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

export function parent(p: string, win = IS_WINDOWS): string {
  if (!win) return p.replace(/\/[^/]+$/, '') || '/'
  const t = trimSep(p, true)
  if (isRoot(t, true)) return t
  const cut = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  return cut < 0 ? t : trimSep(t.slice(0, cut + 1), true)
}

export function join(base: string, name: string, win = IS_WINDOWS): string {
  if (!win) return `${base === '/' ? '' : base}/${name}`
  return /[\\/]$/.test(base) ? base + name : `${base}\\${name}`
}

/** Windows shell for labels: "C:\…\pwsh.exe" → "pwsh". */
export const shellLabel = (shell: string | undefined) => basename(shell || 'powershell', true).replace(/\.exe$/i, '')

/** A terminal pane's shell, for labels: "zsh", "bash", "pwsh"… Without one
 *  known, the platform's default (bash on Linux, where zsh often isn't). */
export const shellName = (shell: string | undefined, win = IS_WINDOWS, linux = IS_LINUX) =>
  win ? shellLabel(shell) : basename(shell || (linux ? '/bin/bash' : '/bin/zsh'), false)

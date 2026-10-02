// How file paths are typed into a terminal when files are dropped on a pane or
// pasted after being copied: the way the platform's own terminal does it, so
// shells and Claude Code read them the same (Claude Code attaches a pasted
// image path as an image).
//
// Kept apart from lib/terminals so it can be tested without loading xterm.
import { IS_WINDOWS } from './platform'

/** Characters a POSIX shell would read as syntax. ASCII space and tab only —
 *  not `\s`, which also matches the narrow no-break space macOS puts before
 *  "PM" in screenshot names; escaping that would name a file that doesn't
 *  exist. */
const SHELL_SPECIAL = /[ \t!"#$&'()*;<>?[\\\]^`{|}~]/g

/** Characters that need quoting in PowerShell and cmd. */
const WIN_SPECIAL = /[\s&()[\]{}^=;!'+,`~$@#%]/

/** One path: backslash-escaped like Terminal on macOS; double-quoted like
 *  Windows Terminal on Windows (backslash is the separator there). */
export const escapePath = (path: string, win = IS_WINDOWS) =>
  win ? (WIN_SPECIAL.test(path) ? `"${path}"` : path) : path.replace(SHELL_SPECIAL, (c) => `\\${c}`)

/** Several paths, space-separated, with a trailing space like Terminal. */
export const pathsForTerminal = (paths: readonly string[], win = IS_WINDOWS) =>
  paths.length ? paths.map((p) => escapePath(p, win)).join(' ') + ' ' : ''

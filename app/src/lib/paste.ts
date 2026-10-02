// How file paths are typed into a terminal when files are dropped on a pane or
// pasted after being copied in Finder: the way Terminal does it, so shells and
// Claude Code read them the same. Claude Code attaches a pasted image path as
// an image.
//
// Kept apart from lib/terminals so it can be tested without loading xterm.

/** Characters a shell would read as syntax. ASCII space and tab only — not
 *  `\s`, which also matches the narrow no-break space macOS puts before "PM"
 *  in screenshot names; escaping that would name a file that doesn't exist. */
const SHELL_SPECIAL = /[ \t!"#$&'()*;<>?[\\\]^`{|}~]/g

/** One path, backslash-escaped like Terminal's drag and drop. */
export const escapePath = (path: string) => path.replace(SHELL_SPECIAL, (c) => `\\${c}`)

/** Several paths, space-separated, with a trailing space like Terminal. */
export const pathsForTerminal = (paths: readonly string[]) =>
  paths.length ? paths.map(escapePath).join(' ') + ' ' : ''

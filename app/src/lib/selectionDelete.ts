// Select text in a pane's prompt, press Delete: the selection goes.
//
// A terminal can't do that by itself — the prompt belongs to the program in
// the pane, and xterm's selection is only a highlight. So the app works out
// what to type instead: move the caret to the end of the selection, then one
// Backspace per selected character. That needs the caret: a shell keeps it
// as the terminal cursor, and so does Claude (2.1) once it has drawn its input
// box — the text between the two ──── rules at the bottom. Older Claude drew
// it as an inverted cell instead and left the cursor elsewhere. Pure functions
// over a snapshot of the screen rows, so they can be tested without a terminal.

export interface Cell {
  ch: string
  /** 1, or 2 for a wide character (CJK, emoji), whose second cell is width 0. */
  w: number
  inv: boolean
}
export type Row = Cell[]

/** A selection on screen: rows are absolute buffer rows, `ex` is exclusive. */
export interface Selection {
  sy: number
  sx: number
  ey: number
  ex: number
}

const LEFT = '\x1b[D'
const RIGHT = '\x1b[C'
const BACKSPACE = '\x7f'
/** Ctrl+U: Claude empties its input (Ctrl+Y brings it back); a shell kills the line. */
export const CLEAR_INPUT = '\x15'

/** Not text: empty, a space, or the side of a bordered input box. */
const blank = (c: Cell | undefined) => !c || !c.ch.trim() || c.ch === '│' || c.ch === '┃'
/** Characters (not cells) before column `col`. */
const charsBefore = (row: Row, col: number) => row.slice(0, Math.max(0, col)).filter((c) => c.w > 0).length

/**
 * Keys that delete columns [sx, ex) of one row, with the caret at `caret`.
 * Leading and trailing blanks aren't text (an indent, the space after the
 * last character), so the selection is trimmed to the row's text first.
 */
export function deleteOnRow(row: Row, sx: number, ex: number, caret: number): string | null {
  let first = 0
  while (first < row.length && blank(row[first])) first++
  let last = row.length
  while (last > first && blank(row[last - 1])) last--
  const from = Math.max(sx, first)
  const to = Math.min(ex, last)
  if (to <= from) return null
  const start = charsBefore(row, from)
  const end = charsBefore(row, to)
  const at = charsBefore(row, caret)
  const move = end >= at ? RIGHT.repeat(end - at) : LEFT.repeat(at - end)
  return move + BACKSPACE.repeat(end - start)
}

/** A rule across the screen: Claude's input box edges (plain, or the older box's corners). */
const RULE = /^[╭╰]?─{8,}[╮╯]?$/

/** Claude's input box: the rows between the bottom-most pair of ──── rules. */
export function claudeInputRows(text: (y: number) => string, lastRow: number, look = 40): { top: number; bottom: number } | null {
  let below = -1
  for (let y = lastRow; y >= Math.max(0, lastRow - look); y--) {
    if (!RULE.test(text(y).trim())) continue
    if (below < 0) below = y
    else if (below - y > 1) return { top: y + 1, bottom: below - 1 }
    else below = y
  }
  return null
}

/** Claude's caret in its input box: the terminal cursor when it is in the
 *  box (Claude 2.1 puts it there), else the last inverted cell (older). */
export function claudeCaret(
  rows: (y: number) => Row,
  input: { top: number; bottom: number },
  cursor: { y: number; x: number },
): { y: number; x: number } | null {
  if (cursor.y >= input.top && cursor.y <= input.bottom) return cursor
  for (let y = input.bottom; y >= input.top; y--) {
    const r = rows(y)
    for (let x = r.length - 1; x >= 0; x--) if (r[x].inv) return { y, x }
  }
  return null
}

/**
 * What Backspace (or Delete) types for this selection, or null to leave the
 * key alone (the selection isn't in the prompt, or the caret can't be found).
 * One row: exactly the selected characters. Several rows of the prompt: all of
 * it (Ctrl+U), the one thing that can be done reliably across wrapped lines.
 */
export function keysToDelete(
  sel: Selection,
  caret: { y: number; x: number } | null,
  rows: (y: number) => Row,
  input?: { top: number; bottom: number } | null,
): string | null {
  if (!caret) return null
  if (input && (sel.sy < input.top || sel.ey > input.bottom)) return null
  if (sel.sy === sel.ey) return sel.sy === caret.y ? deleteOnRow(rows(sel.sy), sel.sx, sel.ex, caret.x) : null
  return caret.y >= sel.sy && caret.y <= sel.ey ? CLEAR_INPUT : null
}

import { describe, expect, it } from 'vitest'

import { CLEAR_INPUT, claudeCaret, claudeInputRows, deleteOnRow, keysToDelete, type Row } from './selectionDelete'

const row = (s: string, caret = -1): Row => [...s].map((ch, i) => ({ ch, w: 1, inv: i === caret }))
const L = '\x1b[D'
const R = '\x1b[C'
const BS = '\x7f'

describe('deleting a selection on one row', () => {
  it('everything typed, caret at the end: one backspace per character', () => {
    // "❯ hello" with the caret on the space after it.
    const r = row('❯ hello  ', 7)
    expect(deleteOnRow(r, 2, 9, 7)).toBe(BS.repeat(5))
  })

  it('a word in the middle: walk to its end, then delete it', () => {
    const r = row('❯ hello big world ')
    // "big" is columns 8–10; the caret is at the end (col 17).
    expect(deleteOnRow(r, 8, 11, 17)).toBe(L.repeat(6) + BS.repeat(3))
    // With the caret before it, walk right instead.
    expect(deleteOnRow(r, 8, 11, 2)).toBe(R.repeat(9) + BS.repeat(3))
  })

  it('counts characters, not cells: a wide character is one backspace', () => {
    const r: Row = [
      { ch: '中', w: 2, inv: false },
      { ch: '', w: 0, inv: false },
      { ch: 'a', w: 1, inv: false },
      { ch: ' ', w: 1, inv: true },
    ]
    expect(deleteOnRow(r, 0, 3, 3)).toBe(BS.repeat(2))
  })

  it('an indent or the blank end of the row is not text', () => {
    // A wrapped line of the prompt, indented two spaces.
    expect(deleteOnRow(row('  more text   '), 0, 14, 11)).toBe(BS.repeat(9))
    expect(deleteOnRow(row('      '), 0, 6, 0)).toBeNull()
  })
})

describe("Claude's input box", () => {
  const screen = [
    '● Done.',
    '',
    '──────────────────',
    '❯ kjhgfghjkl',
    '──────────────────',
    '  ⏵⏵ auto mode on',
  ]
  const text = (y: number) => screen[y] ?? ''

  it('is between the bottom two rules', () => {
    expect(claudeInputRows(text, screen.length - 1)).toEqual({ top: 3, bottom: 3 })
  })

  it('its caret is the terminal cursor, when Claude puts it in the box (2.1)', () => {
    // What Claude 2.1.293 draws: no inverted cell, the cursor after the text.
    const rows = (y: number) => row(screen[y])
    expect(claudeCaret(rows, { top: 3, bottom: 3 }, { y: 3, x: 12 })).toEqual({ y: 3, x: 12 })
  })

  it('or the inverted cell, when the cursor is parked elsewhere (older Claude)', () => {
    const rows = (y: number) => (y === 3 ? row(`${screen[3]} `, 12) : row(screen[y]))
    expect(claudeCaret(rows, { top: 3, bottom: 3 }, { y: 6, x: 0 })).toEqual({ y: 3, x: 12 })
    expect(claudeCaret((y) => row(screen[y]), { top: 3, bottom: 3 }, { y: 6, x: 0 })).toBeNull()
  })

  it('the prompt as Claude 2.1 draws it: ❯, a no-break space, the text', () => {
    // Everything selected, the cursor after "hello world": all eleven go.
    const r = row('❯\u00a0hello world')
    expect(keysToDelete({ sy: 3, sx: 0, ey: 3, ex: 40 }, { y: 3, x: 13 }, () => r, { top: 3, bottom: 3 })).toBe(BS.repeat(13))
  })
})

describe('what Backspace types', () => {
  const rows = (y: number) => (y === 3 ? row('❯ kjhgfghjkl ', 12) : row(''))
  const input = { top: 3, bottom: 4 }

  it('the selected text in the prompt', () => {
    expect(keysToDelete({ sy: 3, sx: 2, ey: 3, ex: 13 }, { y: 3, x: 12 }, rows, input)).toBe(BS.repeat(10))
  })

  it('several rows of the prompt: all of it', () => {
    expect(keysToDelete({ sy: 3, sx: 0, ey: 4, ex: 5 }, { y: 3, x: 12 }, rows, input)).toBe(CLEAR_INPUT)
  })

  it("leaves the key alone outside the prompt, or when the caret isn't known", () => {
    expect(keysToDelete({ sy: 0, sx: 0, ey: 0, ex: 5 }, { y: 3, x: 12 }, rows, input)).toBeNull()
    expect(keysToDelete({ sy: 3, sx: 2, ey: 3, ex: 13 }, null, rows, input)).toBeNull()
    // A shell (no input box): only the cursor's own row.
    expect(keysToDelete({ sy: 2, sx: 0, ey: 2, ex: 3 }, { y: 3, x: 5 }, rows)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { escapePath, pathsForTerminal } from './paste'

const mac = (p: string) => escapePath(p, false)

describe('paths typed into a terminal (macOS)', () => {
  it('escapes what a shell would read as syntax, like Terminal', () => {
    expect(mac('/Users/k/Desktop/Screen Shot 1.png')).toBe('/Users/k/Desktop/Screen\\ Shot\\ 1.png')
    expect(mac("/tmp/notes (v2) & 'draft'.md")).toBe("/tmp/notes\\ \\(v2\\)\\ \\&\\ \\'draft\\'.md")
    expect(mac('/tmp/a$b`c\\d')).toBe('/tmp/a\\$b\\`c\\\\d')
  })

  it('leaves plain paths and non-ASCII names alone', () => {
    expect(mac('/Users/k/proj/src/main.rs')).toBe('/Users/k/proj/src/main.rs')
    // macOS screenshot names use U+202F before AM/PM; Terminal keeps it as is.
    expect(mac('/tmp/Screenshot PM.png')).toBe('/tmp/Screenshot PM.png')
    expect(mac('/tmp/résumé-日本.pdf')).toBe('/tmp/résumé-日本.pdf')
  })

  it('joins several paths with spaces and ends with one', () => {
    expect(pathsForTerminal(['/a b.png', '/c.png'], false)).toBe('/a\\ b.png /c.png ')
    expect(pathsForTerminal([], false)).toBe('')
  })
})

describe('paths typed into a terminal (Windows)', () => {
  const win = (p: string) => escapePath(p, true)

  it('quotes paths a shell would split, like Windows Terminal', () => {
    expect(win('C:\\Users\\k\\Pictures\\Screen shot.png')).toBe('"C:\\Users\\k\\Pictures\\Screen shot.png"')
    expect(win('C:\\tmp\\a&b.txt')).toBe('"C:\\tmp\\a&b.txt"')
  })

  it('leaves plain paths alone and keeps backslashes as they are', () => {
    expect(win('C:\\Users\\k\\proj\\main.rs')).toBe('C:\\Users\\k\\proj\\main.rs')
  })

  it('joins several paths with spaces and ends with one', () => {
    expect(pathsForTerminal(['C:\\a b.png', 'C:\\c.png'], true)).toBe('"C:\\a b.png" C:\\c.png ')
  })
})

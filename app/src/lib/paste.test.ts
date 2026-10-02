import { describe, expect, it } from 'vitest'

import { escapePath, pathsForTerminal } from './paste'

describe('paths typed into a terminal', () => {
  it('escapes what a shell would read as syntax, like Terminal', () => {
    expect(escapePath('/Users/k/Desktop/Screen Shot 1.png')).toBe('/Users/k/Desktop/Screen\\ Shot\\ 1.png')
    expect(escapePath("/tmp/notes (v2) & 'draft'.md")).toBe("/tmp/notes\\ \\(v2\\)\\ \\&\\ \\'draft\\'.md")
    expect(escapePath('/tmp/a$b`c\\d')).toBe('/tmp/a\\$b\\`c\\\\d')
  })

  it('leaves plain paths and non-ASCII names alone', () => {
    expect(escapePath('/Users/k/proj/src/main.rs')).toBe('/Users/k/proj/src/main.rs')
    // macOS screenshot names use U+202F before AM/PM; Terminal keeps it as is.
    expect(escapePath('/tmp/Screenshot PM.png')).toBe('/tmp/Screenshot PM.png')
    expect(escapePath('/tmp/résumé-日本.pdf')).toBe('/tmp/résumé-日本.pdf')
  })

  it('joins several paths with spaces and ends with one', () => {
    expect(pathsForTerminal(['/a b.png', '/c.png'])).toBe('/a\\ b.png /c.png ')
    expect(pathsForTerminal([])).toBe('')
  })
})

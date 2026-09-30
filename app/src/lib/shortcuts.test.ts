import { describe, expect, it } from 'vitest'

import { isAppShortcut, matchShortcut } from './shortcuts'

type Mods = Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code'>>
const key = (k: string, mods: Mods = {}) =>
  ({ key: k, code: '', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent

// The macOS keymap is the reference; these lock it so platform work on other
// builds can't change what ⌘-keys do on the Mac.
describe('macOS shortcuts', () => {
  it('maps the design keybindings', () => {
    expect(matchShortcut(key('n'))).toEqual({ type: 'newSession' })
    expect(matchShortcut(key('t'))).toEqual({ type: 'newTerminal' })
    expect(matchShortcut(key('o'))).toEqual({ type: 'workspaceMenu' })
    expect(matchShortcut(key('i'))).toEqual({ type: 'inspector' })
    expect(matchShortcut(key('j'))).toEqual({ type: 'jumpWaiting' })
    expect(matchShortcut(key('Enter'))).toEqual({ type: 'toggleFocus' })
    expect(matchShortcut(key('N'))).toEqual({ type: 'newSession' })
  })

  it('selects panes with ⌘1–9', () => {
    expect(matchShortcut(key('1'))).toEqual({ type: 'selectPane', index: 0 })
    expect(matchShortcut(key('9'))).toEqual({ type: 'selectPane', index: 8 })
  })

  it('steps text size with ⌘+ ⌘− ⌘0', () => {
    expect(matchShortcut(key('='))).toEqual({ type: 'fontSize', delta: 1 })
    expect(matchShortcut(key('+'))).toEqual({ type: 'fontSize', delta: 1 })
    expect(matchShortcut(key('-'))).toEqual({ type: 'fontSize', delta: -1 })
    expect(matchShortcut(key('_'))).toEqual({ type: 'fontSize', delta: -1 })
    expect(matchShortcut(key('0'))).toEqual({ type: 'fontSize', delta: 0 })
  })

  it('leaves everything else to the terminal', () => {
    expect(matchShortcut(key('n', { metaKey: false }))).toBeNull()
    expect(matchShortcut(key('n', { metaKey: false, ctrlKey: true }))).toBeNull()
    expect(matchShortcut(key('n', { ctrlKey: true }))).toBeNull()
    expect(matchShortcut(key('n', { altKey: true }))).toBeNull()
    expect(matchShortcut(key('n', { shiftKey: true }))).toBeNull()
    expect(matchShortcut(key('c'))).toBeNull()
    expect(matchShortcut(key('v'))).toBeNull()
    expect(isAppShortcut(key('r', { metaKey: false, ctrlKey: true }))).toBe(false)
  })
})

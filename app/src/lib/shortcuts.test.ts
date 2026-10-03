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

  it('opens the Apps panel with ⌘⇧A, leaving plain ⌘A to the terminal', () => {
    expect(matchShortcut(key('a', { shiftKey: true }))).toEqual({ type: 'apps' })
    // Plain ⌘A selects the pane's output; it must not open a panel.
    expect(matchShortcut(key('a'))).toBeNull()
  })

  it('moves the selected pane with ⌘⇧← / ⌘⇧→', () => {
    expect(matchShortcut(key('ArrowLeft', { shiftKey: true }))).toEqual({ type: 'movePane', delta: -1 })
    expect(matchShortcut(key('ArrowRight', { shiftKey: true }))).toEqual({ type: 'movePane', delta: 1 })
    // Without Shift the arrows stay with Claude (history, cursor movement).
    expect(matchShortcut(key('ArrowLeft'))).toBeNull()
    expect(matchShortcut(key('ArrowRight'))).toBeNull()
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
    expect(matchShortcut(key('a', { shiftKey: true }))).toEqual({ type: 'apps' }) // the one ⌘⇧letter we take
    expect(matchShortcut(key('c'))).toBeNull()
    expect(matchShortcut(key('v'))).toBeNull()
    expect(isAppShortcut(key('r', { metaKey: false, ctrlKey: true }))).toBe(false)
  })
})

describe('Windows shortcuts', () => {
  const win = (code: string, k: string, mods: Mods = {}) =>
    matchShortcut(key(k, { metaKey: false, ctrlKey: true, shiftKey: true, code, ...mods }), true)

  it('uses Ctrl+Shift so plain Ctrl+letter stays with the terminal', () => {
    expect(win('KeyN', 'N')).toEqual({ type: 'newSession' })
    expect(win('KeyT', 'T')).toEqual({ type: 'newTerminal' })
    expect(win('KeyO', 'O')).toEqual({ type: 'workspaceMenu' })
    expect(win('KeyI', 'I')).toEqual({ type: 'inspector' })
    expect(win('KeyJ', 'J')).toEqual({ type: 'jumpWaiting' })
    expect(win('Enter', 'Enter')).toEqual({ type: 'toggleFocus' })
    expect(win('Digit1', '!')).toEqual({ type: 'selectPane', index: 0 })
    expect(win('ArrowLeft', 'ArrowLeft')).toEqual({ type: 'movePane', delta: -1 })
    expect(win('ArrowRight', 'ArrowRight')).toEqual({ type: 'movePane', delta: 1 })
    expect(win('ArrowLeft', 'ArrowLeft', { shiftKey: false })).toBeNull() // Ctrl+← is a word jump
    expect(win('KeyO', 'o', { shiftKey: false })).toBeNull() // Ctrl+O belongs to the TUI
    expect(win('KeyC', 'c', { shiftKey: false })).toBeNull()
    expect(win('KeyN', 'N', { ctrlKey: false })).toBeNull()
    expect(win('KeyN', 'N', { altKey: true })).toBeNull()
  })

  it('keeps Ctrl+= Ctrl+- Ctrl+0 for text size', () => {
    expect(win('Equal', '=', { shiftKey: false })).toEqual({ type: 'fontSize', delta: 1 })
    expect(win('Minus', '-', { shiftKey: false })).toEqual({ type: 'fontSize', delta: -1 })
    expect(win('Digit0', '0', { shiftKey: false })).toEqual({ type: 'fontSize', delta: 0 })
  })
})

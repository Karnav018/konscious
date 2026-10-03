// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { autoFontSize, clearsInput } from './terminals'

describe('autoFontSize', () => {
  it('is the default size in every pane', () => {
    for (const w of [200, 460, 700, 1400]) expect(autoFontSize(w, 12, 0.6)).toBe(12)
  })
  it('follows the base size', () => {
    expect(autoFontSize(900, 14, 0.6)).toBe(14)
  })
})

describe('clearsInput — select all, then Delete', () => {
  const key = (over: Record<string, unknown> = {}) =>
    ({ type: 'keydown', key: 'Backspace', metaKey: false, ctrlKey: false, altKey: false, ...over }) as KeyboardEvent

  it('clears the input after ⌘A, on either delete key', () => {
    expect(clearsInput(key(), true)).toBe(true)
    expect(clearsInput(key({ key: 'Delete' }), true)).toBe(true)
  })

  it('leaves a plain Backspace alone when nothing was selected that way', () => {
    expect(clearsInput(key(), false)).toBe(false)
    expect(clearsInput(key({ key: 'Delete' }), false)).toBe(false)
  })

  it('never fires on a modifier combination or on key-up', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey']) {
      expect(clearsInput(key({ [mod]: true }), true)).toBe(false)
    }
    expect(clearsInput(key({ type: 'keyup' }), true)).toBe(false)
  })

  it('ignores every other key', () => {
    for (const k of ['a', 'Enter', 'Escape', 'ArrowLeft']) {
      expect(clearsInput(key({ key: k }), true)).toBe(false)
    }
  })
})

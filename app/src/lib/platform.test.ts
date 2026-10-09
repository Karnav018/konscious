// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { copiesNothing } from './platform'

type Init = Partial<Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>>
function press(key: string, target: Element, init: Init = {}) {
  const e = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, ...init })
  Object.defineProperty(e, 'target', { value: target })
  return e
}

describe('copiesNothing — WebKitGTK would empty the clipboard', () => {
  const header = document.createElement('div')

  it('catches Ctrl+C, Ctrl+X and Ctrl+Insert with nothing selected', () => {
    for (const k of ['c', 'C', 'x', 'Insert']) expect(copiesNothing(press(k, header), '')).toBe(true)
  })

  it('lets a real copy through', () => {
    expect(copiesNothing(press('c', header), 'some text')).toBe(false)
    const input = document.createElement('input')
    input.value = 'hello'
    input.setSelectionRange(0, 5)
    expect(copiesNothing(press('c', input), '')).toBe(false)
    input.setSelectionRange(2, 2)
    expect(copiesNothing(press('c', input), '')).toBe(true)
  })

  it('leaves terminals to do their own copying', () => {
    const term = document.createElement('div')
    term.className = 'xterm'
    const helper = document.createElement('textarea')
    term.appendChild(helper)
    expect(copiesNothing(press('c', helper), '')).toBe(false)
    expect(copiesNothing(press('Insert', helper), '')).toBe(false)
  })

  it('ignores every other key', () => {
    expect(copiesNothing(press('c', header, { ctrlKey: false }), '')).toBe(false)
    expect(copiesNothing(press('c', header, { shiftKey: true }), '')).toBe(false)
    expect(copiesNothing(press('c', header, { altKey: true }), '')).toBe(false)
    expect(copiesNothing(press('v', header), '')).toBe(false)
    expect(copiesNothing(press('Insert', header, { ctrlKey: false, shiftKey: true }), '')).toBe(false)
  })
})

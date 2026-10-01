import { describe, expect, it } from 'vitest'

import { relTo, tildify } from './format'
import { basename, isRoot, join, parent, shellLabel, trimSep } from './path'
import { isBrowserKey, kbd } from './platform'

// Each Mac branch must equal the expression the app used before the Windows
// port; the old expressions are spelled out here as the reference.
describe('macOS paths are unchanged', () => {
  const old = {
    basename: (p: string) => p.replace(/\/+$/, '').split('/').pop() || p,
    trim: (p: string) => p.replace(/\/+$/, '') || '/',
    parent: (p: string) => p.replace(/\/[^/]+$/, '') || '/',
    join: (b: string, n: string) => `${b === '/' ? '' : b}/${n}`,
  }
  const samples = ['/', '/Users', '/Users/k/', '/Users/k/proj', '/a\\b/c', 'rel/x', '']
  it.each(samples)('%j', (p) => {
    expect(basename(p, false)).toBe(old.basename(p))
    expect(trimSep(p, false)).toBe(old.trim(p))
    expect(parent(p, false)).toBe(old.parent(p))
    expect(join(p, 'x', false)).toBe(old.join(p, 'x'))
    expect(isRoot(p, false)).toBe(p === '/')
  })

  it('shows labels with ⌘', () => {
    expect(kbd('N', false)).toBe('⌘N')
    expect(kbd('↵', false)).toBe('⌘↵')
    expect(kbd('−', false)).toBe('⌘−')
    expect(tildify('/Users/k\\x', '/Users/k', false)).toBe('/Users/k\\x')
  })
})

describe('Windows paths', () => {
  it('splits on either separator and keeps drive roots', () => {
    expect(basename('C:\\Users\\k\\proj\\', true)).toBe('proj')
    expect(trimSep('C:\\', true)).toBe('C:\\')
    expect(trimSep('C:\\Users\\', true)).toBe('C:\\Users')
    expect(parent('C:\\Users\\k', true)).toBe('C:\\Users')
    expect(parent('C:\\Users', true)).toBe('C:\\')
    expect(parent('C:\\', true)).toBe('C:\\')
    expect(isRoot('D:\\', true)).toBe(true)
    expect(join('C:\\', 'Users', true)).toBe('C:\\Users')
    expect(join('C:\\Users', 'k', true)).toBe('C:\\Users\\k')
  })

  it('shortens home and workspace paths', () => {
    expect(tildify('C:\\Users\\k\\proj', 'C:\\Users\\k', true)).toBe('~\\proj')
    expect(relTo('C:\\p\\hawk\\api', 'C:\\p\\hawk', true)).toBe('.\\api')
  })

  it('labels shells and shortcuts', () => {
    expect(shellLabel('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(shellLabel(undefined)).toBe('powershell')
    expect(kbd('N', true)).toBe('Ctrl+Shift+N')
    expect(kbd('↵', true)).toBe('Ctrl+Shift+Enter')
    expect(kbd('−', true)).toBe('Ctrl+-')
  })

  it('cancels WebView2 page keys only', () => {
    const k = (key: string, m: Partial<KeyboardEvent> = {}) =>
      ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m }) as KeyboardEvent
    expect(isBrowserKey(k('r', { ctrlKey: true }))).toBe(true)
    expect(isBrowserKey(k('F5'))).toBe(true)
    expect(isBrowserKey(k('p', { ctrlKey: true }))).toBe(true)
    expect(isBrowserKey(k('ArrowLeft', { altKey: true }))).toBe(true)
    expect(isBrowserKey(k('c', { ctrlKey: true }))).toBe(false)
    expect(isBrowserKey(k('r'))).toBe(false)
  })
})

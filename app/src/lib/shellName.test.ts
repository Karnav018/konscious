import { describe, expect, it } from 'vitest'

import { shellName } from './path'

describe('shell labels', () => {
  it('names the shell from its path; without one, the platform default', () => {
    expect(shellName('/usr/bin/bash', false, true)).toBe('bash')
    expect(shellName('/usr/bin/fish', false, true)).toBe('fish')
    expect(shellName(undefined, false, true)).toBe('bash') // Linux: zsh often isn't there
    expect(shellName(undefined, false, false)).toBe('zsh') // macOS
    expect(shellName('C:\\Program Files\\PowerShell\\7\\pwsh.exe', true, false)).toBe('pwsh')
  })
})

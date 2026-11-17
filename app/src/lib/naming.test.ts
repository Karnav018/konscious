import { describe, expect, it } from 'vitest'

import { cleanName, NAME_MAX, nameFromTask, uniqueName } from './naming'

describe('nameFromTask', () => {
  it('keeps the words that say what the work is', () => {
    expect(nameFromTask('run the auth tests')).toBe('Auth Tests')
    expect(nameFromTask('Fix the login redirect bug on Safari')).toBe('Login Redirect Bug')
    expect(nameFromTask('build the usage chart on the dashboard from the /metrics endpoint')).toBe('Usage Chart Dashboard')
  })

  it('keeps acronyms and inner capitals', () => {
    expect(nameFromTask('compare RLS policies for tenants')).toBe('RLS Policies Tenants')
    expect(nameFromTask('wire UsageChart into the page')).toBe('Wire UsageChart Page')
  })

  it('stays within the limit and is empty when nothing is usable', () => {
    const long = nameFromTask('internationalisation localisation configuration')
    expect(long.length).toBeLessThanOrEqual(NAME_MAX)
    expect(long).toBe('Internationalisation')
    expect(nameFromTask('please just do it!!!')).toBe('')
    expect(nameFromTask('')).toBe('')
  })
})

describe('cleanName', () => {
  it('drops anything but letters, digits, spaces and dashes', () => {
    expect(cleanName('  Auth\n\u001b[31mTests; rm -rf  ')).toBe('Auth 31mTests rm -rf')
    expect(cleanName('--dangerously-skip-permissions')).toBe('dangerously-skip-permiss')
    expect(cleanName('x'.repeat(40))).toHaveLength(NAME_MAX)
  })
})

describe('uniqueName', () => {
  it('numbers a name the workspace already has', () => {
    expect(uniqueName('Auth Tests', ['Backend'])).toBe('Auth Tests')
    expect(uniqueName('Auth Tests', ['auth tests', 'Auth Tests 2'])).toBe('Auth Tests 3')
    const full = 'x'.repeat(NAME_MAX)
    expect(uniqueName(full, [full])).toHaveLength(NAME_MAX)
  })
})

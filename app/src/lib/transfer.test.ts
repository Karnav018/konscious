import { describe, expect, it } from 'vitest'

import { bundleName, joinPath, placements, size, slugFor } from './transfer'

describe('where a transcript goes', () => {
  it('encodes a path the way Claude Code does', () => {
    expect(slugFor('/Users/you/code/hawk')).toBe('-Users-you-code-hawk')
    // Windows: the colon and both backslashes each become a dash.
    expect(slugFor('C:\\git\\hawk')).toBe('C--git-hawk')
    expect(slugFor('/a/my_app.v2')).toBe('-a-my-app-v2')
  })

  it('agrees with the engine that the encoding is lossy', () => {
    // This is Claude's behaviour, not ours, and it is why we warn.
    expect(slugFor('/p/spec-rl')).toBe(slugFor('/p/spec/rl'))
  })
})

describe('joinPath', () => {
  it('uses the separator of the machine being imported to', () => {
    expect(joinPath('/Users/you/code/hawk', 'backend', false)).toBe('/Users/you/code/hawk/backend')
    expect(joinPath('C:\\git\\hawk', 'backend', true)).toBe('C:\\git\\hawk\\backend')
    expect(joinPath('C:\\git\\hawk', 'web/api', true)).toBe('C:\\git\\hawk\\web\\api')
  })

  it('leaves the root alone for a session that sits at it', () => {
    expect(joinPath('/p/hawk', '', false)).toBe('/p/hawk')
    expect(joinPath('/p/hawk/', '', false)).toBe('/p/hawk')
  })
})

describe('placements', () => {
  const sessions = [
    { id: 'a', name: 'Backend', relative: 'backend', kind: 'claude', hasTranscript: true },
    { id: 'b', name: 'Spec runner', relative: 'spec/rl', kind: 'claude', hasTranscript: true },
    { id: 'c', name: 'Other', relative: 'spec-rl', kind: 'claude', hasTranscript: true },
    { id: 'd', name: 'Terminal', relative: 'backend', kind: 'shell', hasTranscript: false },
  ]

  it('places every session under the chosen root', () => {
    const rows = placements(sessions, '/new/hawk', false)
    expect(rows.map((r) => r.cwd)).toEqual([
      '/new/hawk/backend',
      '/new/hawk/spec/rl',
      '/new/hawk/spec-rl',
      '/new/hawk/backend',
    ])
  })

  it('flags the two whose transcripts would share a folder', () => {
    const rows = placements(sessions, '/new/hawk', false)
    expect(rows.filter((r) => r.collides).map((r) => r.name)).toEqual(['Spec runner', 'Other'])
    // Two sessions in one folder is normal and not a collision.
    expect(rows[0].collides).toBe(false)
  })

  it('gives a shell no transcript folder at all', () => {
    const rows = placements(sessions, '/new/hawk', false)
    expect(rows[3].slug).toBeNull()
    expect(rows[3].collides).toBe(false)
  })
})

describe('size', () => {
  it('reads the way a person would say it', () => {
    expect(size(8_178_892)).toBe('7.8 MB')
    expect(size(86_000)).toBe('84 KB')
    expect(size(0)).toBe('no transcript')
  })
})

describe('bundleName', () => {
  it('is a .kon named for the workspace and the day', () => {
    expect(bundleName('Hawk', new Date('2026-10-04T10:00:00Z'))).toBe('hawk-2026-10-04.kon')
    expect(bundleName('My Project!', new Date('2026-10-04T10:00:00Z'))).toBe('my-project-2026-10-04.kon')
    expect(bundleName('///', new Date('2026-10-04T10:00:00Z'))).toBe('workspace-2026-10-04.kon')
  })
})

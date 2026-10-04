import { describe, expect, it } from 'vitest'

import type { NoteTask, SessionMeta } from '../types'
import { blocksOf, cleanFileName, defaultFileName, linkedSession, notesMarkdown, notesPath, ordered } from './notes'

const task = (id: string, text: string, extra: Partial<NoteTask> = {}): NoteTask => ({ id, text, done: false, sessionId: null, ...extra })
const session = (id: string, name: string): SessionMeta => ({
  id, name, workspaceId: 'hawk', kind: 'claude', cwd: '/p', claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
})
const sessions = [session('s1', 'Backend'), session('s2', 'Auth reviewer')]

describe('scratch blocks', () => {
  it('are runs of non-blank lines', () => {
    const b = blocksOf('creds → vault\n\nrepro 401:\n  1. log in\n  2. GET /api/me\n\n\nnpm test')
    expect(b.map((x) => [x.start, x.end])).toEqual([[0, 0], [2, 4], [7, 7]])
    expect(b[1].text).toBe('repro 401:\n  1. log in\n  2. GET /api/me')
  })

  it('treats whitespace-only lines as blank, and nothing as no blocks', () => {
    expect(blocksOf('a\n   \nb').length).toBe(2)
    expect(blocksOf('')).toEqual([])
  })
})

describe('a task’s session', () => {
  it('is the one it was sent to', () => {
    expect(linkedSession(task('t', 'review PR', { sessionId: 's2' }), sessions)?.name).toBe('Auth reviewer')
  })

  it('or an @name in the text (spaces as dashes, any case)', () => {
    expect(linkedSession(task('t', 'ask @backend about TTL'), sessions)?.id).toBe('s1')
    expect(linkedSession(task('t', 'loop in @Auth-Reviewer'), sessions)?.id).toBe('s2')
  })

  it('sending wins over a typed @name; a gone session falls back to the text', () => {
    expect(linkedSession(task('t', '@backend check', { sessionId: 's2' }), sessions)?.id).toBe('s2')
    expect(linkedSession(task('t', '@backend check', { sessionId: 'deleted' }), sessions)?.id).toBe('s1')
  })

  it('ignores emails and unknown names', () => {
    expect(linkedSession(task('t', 'mail ops@backend.io'), sessions)).toBeNull()
    expect(linkedSession(task('t', 'ping @nobody'), sessions)).toBeNull()
  })
})

describe('saving', () => {
  const day = new Date(2026, 9, 4)

  it('names the first file after the workspace and day', () => {
    expect(defaultFileName('Hawk API', day)).toBe('hawk-api-2026-10-04')
  })

  it('keeps file names to a plain name', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('etc-passwd')
    expect(cleanFileName('standup.md')).toBe('standup')
    expect(cleanFileName('  ')).toBe('notes')
  })

  it('puts project notes in notes/, other notes in the picked folder', () => {
    expect(notesPath('repo', { projectPath: '/u/hawk', name: 'standup', dir: null }, false)).toBe('/u/hawk/notes/standup.md')
    expect(notesPath('other', { projectPath: '/u/hawk', name: 'standup', dir: '/u/Notes/' }, false)).toBe('/u/Notes/standup.md')
    expect(notesPath('repo', { projectPath: 'C:\\u\\hawk', name: 'standup', dir: null }, true)).toBe('C:\\u\\hawk\\notes\\standup.md')
    expect(notesPath('app', { projectPath: '/u/hawk', name: 'x', dir: null }, false)).toBeNull()
    expect(notesPath('other', { projectPath: '/u/hawk', name: 'x', dir: null }, false)).toBeNull()
  })

  it('writes a checklist and the scratch pad verbatim', () => {
    const md = notesMarkdown(
      'Hawk',
      {
        tasks: [task('a', 'Bump Node', { done: true }), task('b', 'Review PR', { sessionId: 's2' }), task('c', 'ask @backend')],
        scratch: '# not a heading\n  indented\n```nested fence```\n',
      },
      sessions,
      day,
    )
    expect(md).toContain('# Hawk notes')
    expect(md).toContain('- [ ] Review PR @auth-reviewer')
    expect(md).toContain('- [ ] ask @backend\n') // already mentioned: not repeated
    expect(md.indexOf('- [ ] Review PR')).toBeLessThan(md.indexOf('- [x] Bump Node')) // done sinks
    expect(md).toContain('````text\n# not a heading\n  indented\n```nested fence```\n````')
  })

  it('keeps open tasks above done ones', () => {
    expect(ordered([task('a', 'x', { done: true }), task('b', 'y')]).map((t) => t.id)).toEqual(['b', 'a'])
  })
})

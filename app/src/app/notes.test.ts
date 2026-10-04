import { beforeEach, describe, expect, it, vi } from 'vitest'

// No terminal engine or Tauri here: the pane and the file write are stand-ins.
vi.mock('../lib/terminals', () => ({ terminals: { paste: vi.fn(), bracketedPaste: vi.fn(() => true) } }))
vi.mock('../lib/ipc', () => ({ ipc: { notesExport: vi.fn(async (p: string) => p), pickFolder: vi.fn() }, errorMessage: (e: unknown) => String(e) }))
vi.mock('./actions', () => ({ selectSession: vi.fn(), setMode: vi.fn() }))

import { ipc } from '../lib/ipc'
import { terminals } from '../lib/terminals'
import { addTask, currentNotes, markNotesSaved } from '../state/commands/notes'
import { applyInfo } from '../state/commands/runtime'
import { addSession, addWorkspace } from '../state/commands/workspace'
import { getState, initialState, useApp } from '../state/store'
import type { SessionMeta } from '../types'
import { commitNotesSave, saveNotes, sendTask, sendToPrompt } from './notes'

const session = (id: string, workspaceId: string, name = id): SessionMeta => ({
  id, workspaceId, name, kind: 'claude', cwd: '/p', claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
})
const run = (id: string) =>
  applyInfo({ id, runId: 1, status: 'idle', running: true, pid: 1, exitCode: null, hooksActive: false, startedAt: 1 } as never)
const toast = () => getState().ui.toast

beforeEach(() => {
  useApp.setState(initialState(), true)
  vi.mocked(terminals.paste).mockClear()
  vi.mocked(terminals.bracketedPaste).mockReturnValue(true)
  vi.mocked(ipc.notesExport).mockClear()
})

describe('putting text into a prompt', () => {
  it('pastes it and never presses Enter', () => {
    const ws = addWorkspace('/p/hawk')
    addSession(session('s1', ws.id, 'Backend'))
    run('s1')
    expect(sendToPrompt('s1', 'line one\nline two\n')).toBe(true)
    expect(terminals.paste).toHaveBeenCalledWith('s1', 'line one\nline two')
    expect(toast()).toBe("Added 2 lines to Backend's prompt")
  })

  it('joins lines into one where a paste would run each line', () => {
    const ws = addWorkspace('/p/hawk')
    addSession({ ...session('t1', ws.id, 'zsh'), kind: 'shell' })
    run('t1')
    vi.mocked(terminals.bracketedPaste).mockReturnValue(false)
    sendToPrompt('t1', 'npm test\n  --watch')
    expect(terminals.paste).toHaveBeenCalledWith('t1', 'npm test --watch')
  })

  it('refuses a session that is not running', () => {
    const ws = addWorkspace('/p/hawk')
    addSession(session('s1', ws.id, 'Backend'))
    expect(sendToPrompt('s1', 'hi')).toBe(false)
    expect(terminals.paste).not.toHaveBeenCalled()
    expect(toast()).toContain("isn't running")
  })

  it('a sent task is linked to the session', () => {
    const ws = addWorkspace('/p/hawk')
    addSession(session('s1', ws.id))
    run('s1')
    addTask(ws.id, 'Review PR')
    const t = currentNotes(getState().notes.byWorkspace[ws.id]).tasks[0]
    sendTask(ws.id, t.id, 's1')
    expect(terminals.paste).toHaveBeenCalledWith('s1', 'Review PR')
    expect(currentNotes(getState().notes.byWorkspace[ws.id]).tasks[0].sessionId).toBe('s1')
  })
})

describe('saving notes', () => {
  it('asks where the first time', () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'x')
    saveNotes(ws.id)
    expect(getState().ui.notesSave).toMatchObject({ workspaceId: ws.id, dest: 'app', remember: false })
    expect(getState().ui.notesSave?.name).toMatch(/^hawk-\d{4}-\d{2}-\d{2}$/)
  })

  it('nothing unsaved: nothing to do', () => {
    const ws = addWorkspace('/p/hawk')
    saveNotes(ws.id)
    expect(getState().ui.notesSave).toBeNull()
  })

  it('writes the Markdown file and remembers the place', async () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'Ship notes')
    await commitNotesSave({ workspaceId: ws.id, dest: 'repo', name: 'standup', dir: null, remember: true })
    expect(ipc.notesExport).toHaveBeenCalledWith('/p/hawk/notes/standup.md', expect.stringContaining('- [ ] Ship notes'))
    const wn = getState().notes.byWorkspace[ws.id]
    expect(wn.draft).toBeNull()
    expect(wn.pref).toEqual({ dest: 'repo', name: 'standup', dir: null })
    expect(toast()).toBe('Saved to /p/hawk/notes/standup.md')
  })

  it('with "Always save here", ⌘S saves straight there', async () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'a')
    markNotesSaved(ws.id, null, { dest: 'other', name: 'hawk', dir: '/u/Notes' })
    addTask(ws.id, 'b')
    saveNotes(ws.id)
    await vi.waitFor(() => expect(ipc.notesExport).toHaveBeenCalledWith('/u/Notes/hawk.md', expect.any(String)))
    expect(getState().ui.notesSave).toBeNull()
    saveNotes(ws.id, { saveAs: true }) // nothing unsaved now
    addTask(ws.id, 'c')
    saveNotes(ws.id, { saveAs: true })
    expect(getState().ui.notesSave).toMatchObject({ dest: 'other', dir: '/u/Notes', remember: true })
  })

  it('kept in Konscious: no file is written', async () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'x')
    await commitNotesSave({ workspaceId: ws.id, dest: 'app', name: 'x', dir: null, remember: false })
    expect(ipc.notesExport).not.toHaveBeenCalled()
    expect(getState().notes.byWorkspace[ws.id].draft).toBeNull()
    expect(toast()).toBe('Saved in Konscious')
  })

  it('a failed write keeps everything unsaved', async () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'x')
    vi.mocked(ipc.notesExport).mockRejectedValueOnce('Permission denied')
    await commitNotesSave({ workspaceId: ws.id, dest: 'repo', name: 'x', dir: null, remember: true })
    expect(getState().notes.byWorkspace[ws.id].draft).not.toBeNull()
    expect(getState().notes.byWorkspace[ws.id].pref).toBeNull()
    expect(toast()).toBe("Couldn't save: Permission denied")
  })
})

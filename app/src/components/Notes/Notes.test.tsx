// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The actions reach the terminals and Tauri; here they only need to be asked.
vi.mock('../../app/notes', () => ({
  discardNotesChanges: vi.fn(),
  openTaskSession: vi.fn(),
  saveNotes: vi.fn(),
  sendTask: vi.fn(),
  sendToPrompt: vi.fn(),
  commitNotesSave: vi.fn(),
  pickNotesFolder: vi.fn(),
}))

import { commitNotesSave, discardNotesChanges, openTaskSession, saveNotes, sendTask, sendToPrompt } from '../../app/notes'
import { openPane } from '../../state/commands/layout'
import { addTask, currentNotes, openNotesSave, setScratch, updateNotesSave } from '../../state/commands/notes'
import { applyInfo } from '../../state/commands/runtime'
import { addSession, addWorkspace, setActiveWorkspace } from '../../state/commands/workspace'
import { getState, initialState, useApp } from '../../state/store'
import type { SessionMeta } from '../../types'
import { NotesView } from './Notes'
import { NotesSaveDialog } from './NotesSaveDialog'

const session = (id: string, workspaceId: string, name: string): SessionMeta => ({
  id, workspaceId, name, kind: 'claude', cwd: '/p', claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
})
const run = (id: string) =>
  applyInfo({ id, runId: 1, status: 'idle', running: true, pid: 1, exitCode: null, hooksActive: false, startedAt: 1 } as never)

function hawk() {
  const ws = addWorkspace('/p/hawk')
  setActiveWorkspace(ws.id)
  return ws
}

beforeEach(() => {
  useApp.setState(initialState(), true)
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('Notes — Today', () => {
  it('starts empty and adds a task on Enter', () => {
    const ws = hawk()
    render(<NotesView />)
    expect(screen.getByText(/Nothing planned for hawk yet/)).toBeTruthy()
    const input = screen.getByLabelText('Add a task')
    fireEvent.change(input, { target: { value: 'Review the auth PR' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(currentNotes(getState().notes.byWorkspace[ws.id]).tasks.map((t) => t.text)).toEqual(['Review the auth PR'])
    expect(screen.getByText('Review the auth PR')).toBeTruthy()
    expect(screen.getByText('0 of 1 done')).toBeTruthy()
  })

  it('shows unsaved changes with Discard and Save, and ⌘S saves', () => {
    const ws = hawk()
    addTask(ws.id, 'x')
    render(<NotesView />)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByText('Discard'))
    expect(discardNotesChanges).toHaveBeenCalledWith(ws.id)
    fireEvent.click(screen.getByText('Save'))
    expect(saveNotes).toHaveBeenCalledWith(ws.id)
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    expect(saveNotes).toHaveBeenCalledTimes(2)
  })

  it('offers ➜ only for the selected running session, and @name opens it', () => {
    const ws = hawk()
    addSession(session('s1', ws.id, 'Backend'))
    addTask(ws.id, 'ask @backend about TTL')
    render(<NotesView />)
    expect(screen.queryByTitle("Put in Backend's prompt")).toBeNull() // not selected, not running
    fireEvent.click(screen.getByText('@backend'))
    expect(openTaskSession).toHaveBeenCalledWith('s1')
    cleanup()
    openPane('s1')
    run('s1')
    render(<NotesView />)
    fireEvent.click(screen.getByTitle("Put in Backend's prompt"))
    const task = currentNotes(getState().notes.byWorkspace[ws.id]).tasks[0]
    expect(sendTask).toHaveBeenCalledWith(ws.id, task.id, 's1')
  })
})

describe('Notes — Scratch', () => {
  it('has a ➜ per block that sends it to a running session', () => {
    const ws = hawk()
    addSession(session('s1', ws.id, 'Backend'))
    addSession(session('s2', ws.id, 'Stopped one'))
    run('s1')
    setScratch(ws.id, 'first block\n\nsecond\nblock')
    render(<NotesView />)
    expect(screen.getAllByLabelText(/^Send block \d to a session$/)).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('Send block 2 to a session'))
    expect(screen.getByText('Send block to')).toBeTruthy()
    expect(screen.getByText(/\+1 more/)).toBeTruthy()
    expect(screen.queryByText('Stopped one')).toBeNull() // only running sessions
    fireEvent.click(screen.getByRole('menuitem', { name: /Backend/ }))
    expect(sendToPrompt).toHaveBeenCalledWith('s1', 'second\nblock', 'lines')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('says so when no session is running', () => {
    const ws = hawk()
    setScratch(ws.id, 'a block')
    render(<NotesView />)
    fireEvent.click(screen.getByLabelText('Send block 1 to a session'))
    expect(screen.getByText(/No running sessions in hawk/)).toBeTruthy()
  })
})

describe('Save notes dialog', () => {
  it('shows where each choice writes, and saves the choice', () => {
    const ws = hawk()
    openNotesSave({ workspaceId: ws.id, dest: 'app', name: 'standup', dir: null, remember: false })
    render(<NotesSaveDialog />)
    expect(screen.getByText('/p/hawk/notes/standup.md')).toBeTruthy()
    expect(screen.queryByLabelText('File name')).toBeNull() // kept in Konscious: no file
    fireEvent.click(screen.getByText('Project folder'))
    expect(getState().ui.notesSave?.dest).toBe('repo')
    fireEvent.click(screen.getByText('Always save here for hawk'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(commitNotesSave).toHaveBeenCalledWith({ workspaceId: ws.id, dest: 'repo', name: 'standup', dir: null, remember: true })
  })

  it('"Another folder" needs a folder first', () => {
    const ws = hawk()
    openNotesSave({ workspaceId: ws.id, dest: 'app', name: 'standup', dir: null, remember: false })
    updateNotesSave({ dest: 'other' })
    render(<NotesSaveDialog />)
    expect(screen.getByText('No folder chosen yet')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

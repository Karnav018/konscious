import { beforeEach, describe, expect, it } from 'vitest'

import { checkInvariants } from './invariants'
import {
  addTask,
  clearDone,
  currentNotes,
  deleteTask,
  discardNotes,
  linkTask,
  markNotesSaved,
  openNotesSave,
  setNotesOpen,
  setScratch,
  toggleTask,
} from './commands/notes'
import { addWorkspace, removeWorkspace } from './commands/workspace'
import { decode, hydrate, serialize } from './persistence'
import { getState, initialState, useApp } from './store'

const notes = (id: string) => getState().notes.byWorkspace[id]
const tasks = (id: string) => currentNotes(notes(id)).tasks

beforeEach(() => useApp.setState(initialState(), true))

describe('notes are a draft until saved', () => {
  it('an edit makes a draft; Save makes it the saved notes', () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, '  Review PR  ')
    expect(tasks(ws.id).map((t) => t.text)).toEqual(['Review PR'])
    expect(notes(ws.id).draft).not.toBeNull()
    expect(notes(ws.id).saved.tasks).toEqual([])
    markNotesSaved(ws.id, null)
    expect(notes(ws.id).draft).toBeNull()
    expect(notes(ws.id).saved.tasks.map((t) => t.text)).toEqual(['Review PR'])
    expect(notes(ws.id).lastSaved?.file).toBeNull()
  })

  it('Discard goes back to the saved notes', () => {
    const ws = addWorkspace('/p/hawk')
    setScratch(ws.id, 'kept')
    markNotesSaved(ws.id, '/p/hawk/notes/a.md')
    setScratch(ws.id, 'kept, then more')
    discardNotes(ws.id)
    expect(currentNotes(notes(ws.id)).scratch).toBe('kept')
    expect(notes(ws.id).draft).toBeNull()
  })

  it('editing back to the saved notes leaves nothing unsaved', () => {
    const ws = addWorkspace('/p/hawk')
    setScratch(ws.id, 'abc')
    markNotesSaved(ws.id, null)
    setScratch(ws.id, 'abcd')
    setScratch(ws.id, 'abc')
    expect(notes(ws.id).draft).toBeNull()
  })

  it('tasks: newest first, toggle, link, delete, clear done', () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'one')
    addTask(ws.id, 'two')
    addTask(ws.id, '   ') // blank: ignored
    expect(tasks(ws.id).map((t) => t.text)).toEqual(['two', 'one'])
    const [two, one] = tasks(ws.id)
    toggleTask(ws.id, one.id)
    linkTask(ws.id, two.id, 's1')
    expect(tasks(ws.id).find((t) => t.id === two.id)?.sessionId).toBe('s1')
    clearDone(ws.id)
    expect(tasks(ws.id).map((t) => t.text)).toEqual(['two'])
    deleteTask(ws.id, two.id)
    expect(tasks(ws.id)).toEqual([])
  })

  it('"Always save here" is kept, cleared, or left alone', () => {
    const ws = addWorkspace('/p/hawk')
    const pref = { dest: 'repo' as const, name: 'standup', dir: null }
    markNotesSaved(ws.id, '/p/hawk/notes/standup.md', pref)
    expect(notes(ws.id).pref).toEqual(pref)
    markNotesSaved(ws.id, '/p/hawk/notes/standup.md') // ⌘S with the preference
    expect(notes(ws.id).pref).toEqual(pref)
    markNotesSaved(ws.id, null, null) // saved with the box unticked
    expect(notes(ws.id).pref).toBeNull()
  })

  it('edits to a workspace that is gone are ignored', () => {
    addTask('nope', 'x')
    expect(getState().notes.byWorkspace).toEqual({})
  })
})

describe('notes and workspaces', () => {
  it('go when their workspace is removed, save dialog included', () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'x')
    openNotesSave({ workspaceId: ws.id, dest: 'app', name: 'x', dir: null, remember: false })
    removeWorkspace(ws.id)
    expect(getState().notes.byWorkspace).toEqual({})
    expect(getState().ui.notesSave).toBeNull()
    expect(checkInvariants(getState())).toEqual([])
  })

  it('Notes only opens with a workspace to show', () => {
    setNotesOpen(true)
    expect(getState().ui.notesOpen).toBe(false)
    addWorkspace('/p/hawk')
    setNotesOpen(true)
    expect(getState().ui.notesOpen).toBe(true)
  })

  it('round-trip through the files, an unsaved draft included', () => {
    const ws = addWorkspace('/p/hawk')
    addTask(ws.id, 'saved task')
    markNotesSaved(ws.id, '/p/hawk/notes/a.md', { dest: 'repo', name: 'a', dir: null })
    setScratch(ws.id, 'not saved yet')
    const files = serialize()
    expect(Object.keys(files.notes)).toEqual([ws.id])
    const before = getState().notes
    useApp.setState(initialState(), true)
    hydrate(decode({ ...files, corrupt: [], restored: [] }))
    expect(getState().notes).toEqual(before)
    expect(notes(ws.id).draft?.scratch).toBe('not saved yet')
  })

  it('a bad task is dropped, not the whole file; notes for unknown workspaces are ignored', () => {
    const ws = addWorkspace('/p/hawk')
    const files = serialize()
    const good = { id: 't1', text: 'ok', done: false, sessionId: null }
    const dec = decode({
      ...files,
      notes: {
        [ws.id]: { version: 2, saved: { tasks: [good, { id: 3 }], scratch: 's' }, draft: null, pref: null, lastSaved: null },
        ghost: { version: 2, saved: { tasks: [], scratch: '' }, draft: null, pref: null, lastSaved: null },
      },
      corrupt: [],
      restored: [],
    })
    expect(dec.notes[ws.id].saved.tasks).toEqual([good])
    expect(dec.notes.ghost).toBeUndefined()
    expect(dec.skipped).toBe(1)
  })

  it('a snapshot from before notes loads with none', () => {
    addWorkspace('/p/hawk')
    const { notes: _n, ...older } = serialize()
    expect(decode({ ...older, corrupt: [], restored: [] }).notes).toEqual({})
  })
})

// Notes: per-workspace Today tasks and a scratch pad. Edits go to a draft
// (kept across restarts) until Save makes it the saved copy, or Discard drops
// it. A draft edited back to the saved notes is no draft at all.
import type { Draft } from 'immer'

import { EMPTY_NOTES, sameNotes } from '../../lib/notes'
import type { Notes, NotesSavePref, WorkspaceNotes } from '../../types'
import { act } from '../act'
import { type AppState, getState, type NotesSaveDraft } from '../store'

const fresh = (): WorkspaceNotes => ({ saved: { tasks: [], scratch: '' }, draft: null, pref: null, lastSaved: null })

/** What the Notes view shows: the draft if there is one, else the saved notes. */
export const currentNotes = (wn: WorkspaceNotes | undefined): Notes => wn?.draft ?? wn?.saved ?? EMPTY_NOTES

export const notesOf = (s: AppState, workspaceId: string | null): WorkspaceNotes | undefined =>
  workspaceId ? s.notes.byWorkspace[workspaceId] : undefined

const newTaskId = () => `t-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`

function edit(workspaceId: string, type: string, recipe: (n: Draft<Notes>) => void) {
  if (!getState().workspace.workspaces.some((w) => w.id === workspaceId)) return
  act(`notes/${type}`, (d) => {
    const wn = (d.notes.byWorkspace[workspaceId] ??= fresh())
    wn.draft ??= { tasks: wn.saved.tasks.map((t) => ({ ...t })), scratch: wn.saved.scratch }
    recipe(wn.draft)
    if (sameNotes(wn.draft, wn.saved)) wn.draft = null
  })
}

export function addTask(workspaceId: string, text: string) {
  const t = text.trim()
  if (t) edit(workspaceId, 'addTask', (n) => void n.tasks.unshift({ id: newTaskId(), text: t, done: false, sessionId: null }))
}

export const toggleTask = (workspaceId: string, id: string) =>
  edit(workspaceId, 'toggleTask', (n) => {
    const t = n.tasks.find((x) => x.id === id)
    if (t) t.done = !t.done
  })

export const deleteTask = (workspaceId: string, id: string) =>
  edit(workspaceId, 'deleteTask', (n) => void (n.tasks = n.tasks.filter((x) => x.id !== id)))

export const clearDone = (workspaceId: string) =>
  edit(workspaceId, 'clearDone', (n) => void (n.tasks = n.tasks.filter((x) => !x.done)))

/** Sending a task to a session links it to that session. */
export const linkTask = (workspaceId: string, id: string, sessionId: string) =>
  edit(workspaceId, 'linkTask', (n) => {
    const t = n.tasks.find((x) => x.id === id)
    if (t) t.sessionId = sessionId
  })

export const setScratch = (workspaceId: string, scratch: string) =>
  edit(workspaceId, 'scratch', (n) => void (n.scratch = scratch))

export const discardNotes = (workspaceId: string) =>
  act('notes/discard', (d) => {
    const wn = d.notes.byWorkspace[workspaceId]
    if (wn) wn.draft = null
  })

/** The draft becomes the saved notes. `pref`: set ("Always save here"),
 *  null (cleared), or undefined (kept as it was). */
export function markNotesSaved(workspaceId: string, file: string | null, pref?: NotesSavePref | null) {
  act('notes/saved', (d) => {
    const wn = (d.notes.byWorkspace[workspaceId] ??= fresh())
    if (wn.draft) wn.saved = wn.draft
    wn.draft = null
    wn.lastSaved = { file, at: Date.now() }
    if (pref !== undefined) wn.pref = pref
    if (d.ui.notesSave?.workspaceId === workspaceId) d.ui.notesSave = null
  })
}

export const setNotesOpen = (open: boolean) =>
  act('ui/notesOpen', (d) => {
    d.ui.notesOpen = open && !!d.workspace.activeId
    if (!d.ui.notesOpen) d.ui.notesSave = null
  })

export const toggleNotesOpen = () => setNotesOpen(!getState().ui.notesOpen)

export const openNotesSave = (draft: NotesSaveDraft) => act('ui/notesSaveOpen', (d) => void (d.ui.notesSave = draft))
export const updateNotesSave = (patch: Partial<Omit<NotesSaveDraft, 'workspaceId'>>) =>
  act('ui/notesSave', (d) => {
    if (d.ui.notesSave) Object.assign(d.ui.notesSave, patch)
  })
export const closeNotesSave = () => act('ui/notesSaveClose', (d) => void (d.ui.notesSave = null))

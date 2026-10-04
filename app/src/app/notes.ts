// Notes actions: putting text into a session's prompt, saving, discarding.
import { tildify } from '../lib/format'
import { errorMessage, ipc } from '../lib/ipc'
import { defaultFileName, notesMarkdown, notesPath } from '../lib/notes'
import { join } from '../lib/path'
import { terminals } from '../lib/terminals'
import {
  closeNotesSave,
  currentNotes,
  discardNotes,
  linkTask,
  markNotesSaved,
  notesOf,
  openNotesSave,
} from '../state/commands/notes'
import { flash } from '../state/commands/ui'
import { getState, type NotesSaveDraft } from '../state/store'
import { selectSession, setMode } from './actions'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * Types `text` into a running session's prompt. Never presses Enter: it is a
 * paste, so the user reads it and sends it. A program that doesn't bracket
 * pastes (some shells) would run each line, so there the lines arrive joined
 * into one instead. Returns whether anything was sent.
 */
export function sendToPrompt(sessionId: string, text: string, what = 'text'): boolean {
  const s = getState()
  const meta = s.workspace.sessions[sessionId]
  const body = text.replace(/\s+$/, '')
  if (!meta || !body) return false
  if (!s.runtime.bySession[sessionId]?.running) {
    flash(`${meta.name} isn't running — start it first`)
    return false
  }
  const lines = body.split('\n')
  if (lines.length > 1 && !terminals.bracketedPaste(sessionId)) {
    terminals.paste(sessionId, lines.map((l) => l.trim()).filter(Boolean).join(' '))
    flash(`Added to ${meta.name}'s prompt as one line, so nothing runs`)
    return true
  }
  terminals.paste(sessionId, body)
  flash(lines.length > 1 || what === 'lines' ? `Added ${plural(lines.length, 'line')} to ${meta.name}'s prompt` : `Added to ${meta.name}'s prompt`)
  return true
}

/** A task's ➜: into the selected session's prompt, and linked to it. */
export function sendTask(workspaceId: string, taskId: string, sessionId: string) {
  const task = currentNotes(notesOf(getState(), workspaceId)).tasks.find((t) => t.id === taskId)
  if (task && sendToPrompt(sessionId, task.text)) linkTask(workspaceId, taskId, sessionId)
}

/** A task's @session: that session, alone on the stage. */
export function openTaskSession(sessionId: string) {
  selectSession(sessionId, { focus: true })
  setMode('focus')
}

export function discardNotesChanges(workspaceId: string) {
  if (!notesOf(getState(), workspaceId)?.draft) return
  discardNotes(workspaceId)
  flash('Changes discarded')
}

/** ~/Documents/Konscious — where "Another folder" starts. */
function documentsFolder(): string | null {
  const home = getState().ui.init?.home
  return home ? join(join(home, 'Documents'), 'Konscious') : null
}

/**
 * ⌘S / Save. With "Always save here" set, saves there at once; otherwise (or
 * for Save as…) asks where. Nothing unsaved: nothing to do.
 */
export function saveNotes(workspaceId: string, opts: { saveAs?: boolean } = {}) {
  const s = getState()
  const ws = s.workspace.workspaces.find((w) => w.id === workspaceId)
  const wn = notesOf(s, workspaceId)
  if (!ws || !wn?.draft) return
  if (wn.pref && !opts.saveAs) {
    void commitNotesSave({ workspaceId, ...wn.pref, remember: true })
    return
  }
  openNotesSave({
    workspaceId,
    dest: wn.pref?.dest ?? 'app',
    name: wn.pref?.name ?? defaultFileName(ws.name),
    dir: wn.pref?.dir ?? documentsFolder(),
    remember: !!wn.pref,
  })
}

/** The Save dialog's Save: writes the Markdown file (unless kept in Konscious),
 *  then the draft becomes the saved notes. A failed write keeps the draft. */
export async function commitNotesSave(d: NotesSaveDraft) {
  const s = getState()
  const ws = s.workspace.workspaces.find((w) => w.id === d.workspaceId)
  const wn = notesOf(s, d.workspaceId)
  if (!ws) return
  const path = notesPath(d.dest, { projectPath: ws.path, name: d.name, dir: d.dir })
  if (d.dest !== 'app' && !path) {
    flash('Choose a folder first')
    return
  }
  if (path) {
    const sessions = Object.values(s.workspace.sessions).filter((m) => m.workspaceId === ws.id)
    try {
      await ipc.notesExport(path, notesMarkdown(ws.name, currentNotes(wn), sessions))
    } catch (e) {
      flash(`Couldn't save: ${errorMessage(e)}`)
      return
    }
  }
  const pref = d.remember ? { dest: d.dest, name: d.name, dir: d.dest === 'other' ? d.dir : null } : null
  markNotesSaved(d.workspaceId, path, pref)
  closeNotesSave()
  flash(path ? `Saved to ${tildify(path, s.ui.init?.home)}` : 'Saved in Konscious')
}

export async function pickNotesFolder(current: string | null) {
  return ipc.pickFolder(current ?? documentsFolder() ?? undefined)
}

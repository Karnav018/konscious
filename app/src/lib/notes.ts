// Pure helpers for Notes: no store, no IPC — so they can be tested alone.
import type { NoteTask, Notes, NotesDest, SessionMeta } from '../types'
import { IS_WINDOWS } from './platform'

export const EMPTY_NOTES: Notes = { tasks: [], scratch: '' }

/** Open tasks first (newest first, as added), done ones sink to the bottom. */
export const ordered = (tasks: readonly NoteTask[]) => [...tasks.filter((t) => !t.done), ...tasks.filter((t) => t.done)]

export const sameNotes = (a: Notes, b: Notes) => JSON.stringify(a) === JSON.stringify(b)

/** A scratch block: consecutive non-blank lines. Blank lines split blocks. */
export interface Block {
  start: number
  end: number
  text: string
}

export function blocksOf(scratch: string): Block[] {
  const lines = scratch.split('\n')
  const out: Block[] = []
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const last = out[out.length - 1]
    if (last && last.end === i - 1) last.end = i
    else out.push({ start: i, end: i, text: '' })
  })
  for (const b of out) b.text = lines.slice(b.start, b.end + 1).join('\n')
  return out
}

/** How a session name is written after @: lower case, spaces as dashes. */
export const mentionName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-')

/**
 * The session a task points at: the one it was sent to, if that session is
 * still in this workspace; otherwise the first @name in the text that names
 * one of the workspace's sessions.
 */
export function linkedSession(task: NoteTask, sessions: readonly SessionMeta[]): SessionMeta | null {
  const byId = task.sessionId ? sessions.find((s) => s.id === task.sessionId) : undefined
  if (byId) return byId
  for (const m of task.text.matchAll(/(?:^|\s)@([\w.-]+)/g)) {
    const hit = sessions.find((s) => mentionName(s.name) === m[1].toLowerCase())
    if (hit) return hit
  }
  return null
}

/** "Saturday 4 Oct" — the Today heading. */
export const todayLabel = (now = new Date()) =>
  now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

/** Default file name for a first save: "<workspace>-2026-10-04". */
export function defaultFileName(workspaceName: string, now = new Date()) {
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'notes'
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${slug}-${d}`
}

/** A file name as typed, made safe: no folders, no extension, never empty. */
export const cleanFileName = (name: string) =>
  name
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-\s]+/, '')
    .trim() || 'notes'

/** Where a save goes, or null when it stays in Konscious. */
export function notesPath(
  dest: NotesDest,
  opts: { projectPath: string; name: string; dir: string | null },
  win = IS_WINDOWS,
): string | null {
  if (dest === 'app') return null
  const sep = win ? '\\' : '/'
  const base = dest === 'repo' ? `${opts.projectPath}${sep}notes` : opts.dir
  if (!base) return null
  return `${base.replace(/[\\/]+$/, '')}${sep}${cleanFileName(opts.name)}.md`
}

/** A fence longer than any run of backticks inside, so nothing can close it. */
const fenceFor = (text: string) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))

/**
 * The Markdown file a save writes: the Today list as a checklist (each task's
 * session as @name, unless the text already says it) and the scratch pad
 * verbatim in a fenced block, so indentation and # lines survive.
 */
export function notesMarkdown(
  workspaceName: string,
  notes: Notes,
  sessions: readonly SessionMeta[],
  now = new Date(),
): string {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const out = [`# ${workspaceName} notes`, '', `_${day}_`, '', '## Today', '']
  const tasks = ordered(notes.tasks)
  if (!tasks.length) out.push('_Nothing planned._')
  for (const t of tasks) {
    const s = linkedSession(t, sessions)
    const tag = s && !t.text.toLowerCase().includes(`@${mentionName(s.name)}`) ? ` @${mentionName(s.name)}` : ''
    out.push(`- [${t.done ? 'x' : ' '}] ${t.text.replace(/\s*\n\s*/g, ' ')}${tag}`)
  }
  out.push('', '## Scratch', '')
  const scratch = notes.scratch.replace(/\s+$/, '')
  if (scratch) {
    const f = fenceFor(scratch)
    out.push(`${f}text`, scratch, f)
  } else out.push('_Empty._')
  return out.join('\n') + '\n'
}

// Cross-slice invariants. Checked after every committed action; a violation
// is repaired deterministically (the app keeps working) and reported (so the
// bug that caused it gets fixed). Also run on load to heal older data.
import type { Draft } from 'immer'

import { CAP } from '../lib/grid'
import type { AppState } from './store'

export function checkInvariants(s: AppState): string[] {
  const v: string[] = []
  const { workspaces, sessions, activeId } = s.workspace
  const wsIds = new Set(workspaces.map((w) => w.id))

  if (wsIds.size !== workspaces.length) v.push('workspace ids are not unique')
  if (activeId !== null && !wsIds.has(activeId)) v.push(`active workspace "${activeId}" does not exist`)
  if (activeId === null && workspaces.length > 0) v.push('workspaces exist but none is active')

  for (const [id, m] of Object.entries(sessions)) {
    if (m.id !== id) v.push(`session key ${id} ≠ id ${m.id}`)
    if (!wsIds.has(m.workspaceId)) v.push(`session ${id} belongs to missing workspace ${m.workspaceId}`)
    if (m.kind === 'shell' && m.claudeSessionId) v.push(`shell session ${id} carries a Claude id`)
  }

  for (const [wsId, l] of Object.entries(s.layout.byWorkspace)) {
    if (!wsIds.has(wsId)) v.push(`layout for missing workspace ${wsId}`)
    const mine = (x: string) => sessions[x]?.workspaceId === wsId
    if (new Set(l.open).size !== l.open.length) v.push(`layout ${wsId}: duplicate open panes`)
    if (l.open.length > CAP) v.push(`layout ${wsId}: ${l.open.length} open panes (cap ${CAP})`)
    for (const x of l.open) if (!mine(x)) v.push(`layout ${wsId}: open pane ${x} is not in this workspace`)
    for (const x of l.recent) if (!mine(x)) v.push(`layout ${wsId}: recent ${x} is not in this workspace`)
    if (l.selected !== null && !l.open.includes(l.selected)) v.push(`layout ${wsId}: selected ${l.selected} is not open`)
    if (l.mode === 'focus' && l.open.length === 0) v.push(`layout ${wsId}: focus mode with no panes`)
  }

  for (const id of Object.keys(s.runtime.bySession)) {
    if (!sessions[id]) v.push(`runtime for missing session ${id}`)
  }
  if (s.ui.paneMenu && !sessions[s.ui.paneMenu]) v.push(`pane menu open for missing session ${s.ui.paneMenu}`)
  if (s.ui.newSession && !wsIds.has(s.ui.newSession.workspaceId)) v.push('new-session draft targets a missing workspace')
  for (const id of Object.keys(s.ui.attachments)) {
    if (!sessions[id]) v.push(`attachments kept for missing session ${id}`)
  }
  if (s.ui.confirmDelete && !sessions[s.ui.confirmDelete]) v.push(`delete confirmation for missing session ${s.ui.confirmDelete}`)
  for (const id of Object.keys(s.notes.byWorkspace)) if (!wsIds.has(id)) v.push(`notes for missing workspace ${id}`)
  if (s.ui.notesSave && !wsIds.has(s.ui.notesSave.workspaceId)) v.push('notes save dialog for a missing workspace')
  if (s.ui.confirmRemoveWorkspace && !wsIds.has(s.ui.confirmRemoveWorkspace))
    v.push(`remove confirmation for missing workspace ${s.ui.confirmRemoveWorkspace}`)
  return v
}

/** Brings any state back within the invariants above. Idempotent. */
export function repair(d: Draft<AppState>): void {
  const seen = new Set<string>()
  d.workspace.workspaces = d.workspace.workspaces.filter((w) => !seen.has(w.id) && seen.add(w.id))
  const wsIds = new Set(d.workspace.workspaces.map((w) => w.id))
  if (d.workspace.activeId === null || !wsIds.has(d.workspace.activeId)) {
    d.workspace.activeId = d.workspace.workspaces[0]?.id ?? null
  }

  for (const [id, m] of Object.entries(d.workspace.sessions)) {
    if (!wsIds.has(m.workspaceId)) delete d.workspace.sessions[id]
    else {
      if (m.id !== id) m.id = id
      if (m.kind === 'shell' && m.claudeSessionId) m.claudeSessionId = null
    }
  }
  const sessions = d.workspace.sessions

  for (const wsId of Object.keys(d.layout.byWorkspace)) {
    if (!wsIds.has(wsId)) {
      delete d.layout.byWorkspace[wsId]
      continue
    }
    const l = d.layout.byWorkspace[wsId]
    const mine = (x: string) => sessions[x]?.workspaceId === wsId
    l.open = [...new Set(l.open.filter(mine))].slice(0, CAP)
    l.recent = [...new Set(l.recent.filter(mine))]
    if (l.selected !== null && !l.open.includes(l.selected)) l.selected = l.open[0] ?? null
    if (l.mode === 'focus' && l.open.length === 0) l.mode = 'grid'
  }

  for (const id of Object.keys(d.runtime.bySession)) {
    if (!sessions[id]) delete d.runtime.bySession[id]
  }
  if (d.ui.paneMenu && !sessions[d.ui.paneMenu]) d.ui.paneMenu = null
  if (d.ui.newSession && !wsIds.has(d.ui.newSession.workspaceId)) d.ui.newSession = null
  for (const id of Object.keys(d.ui.attachments)) {
    if (!sessions[id]) delete d.ui.attachments[id]
  }
  if (d.ui.confirmDelete && !sessions[d.ui.confirmDelete]) d.ui.confirmDelete = null
  for (const id of Object.keys(d.notes.byWorkspace)) if (!d.workspace.workspaces.some((w) => w.id === id)) delete d.notes.byWorkspace[id]
  if (d.ui.notesSave && !d.workspace.workspaces.some((w) => w.id === d.ui.notesSave!.workspaceId)) d.ui.notesSave = null
  if (d.ui.confirmRemoveWorkspace && !d.workspace.workspaces.some((w) => w.id === d.ui.confirmRemoveWorkspace))
    d.ui.confirmRemoveWorkspace = null
}

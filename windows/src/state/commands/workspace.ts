import { dropSession } from '../../lib/grid'
import { basename } from '../../lib/path'
import type { SessionMeta, Workspace } from '../../types'
import { act } from '../act'
import { getState } from '../store'
import { layoutOf } from './layout'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace'

export { basename }

export const newSessionId = () => `s-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`

/** Adds (or re-activates) the workspace for `path`. */
export function addWorkspace(path: string): Workspace {
  const { workspaces } = getState().workspace
  const existing = workspaces.find((w) => w.path === path)
  if (existing) {
    setActiveWorkspace(existing.id)
    return existing
  }
  const base = slug(basename(path))
  const taken = new Set(workspaces.map((w) => w.id))
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  const now = Date.now()
  const ws: Workspace = { id, name: basename(path), path, createdAt: now, updatedAt: now }
  act('workspace/add', (d) => {
    d.workspace.workspaces.push(ws)
    d.workspace.activeId = id
    d.layout.byWorkspace[id] = { mode: 'grid', open: [], recent: [], selected: null }
  })
  return ws
}

export function setActiveWorkspace(id: string) {
  act('workspace/setActive', (d) => {
    if (d.workspace.workspaces.some((w) => w.id === id)) d.workspace.activeId = id
  })
}

export function addSession(meta: SessionMeta) {
  act('session/add', (d) => {
    d.workspace.sessions[meta.id] = meta
  })
}

/** Applies only fields that actually change (no-op otherwise). */
export function updateSession(id: string, patch: Partial<Omit<SessionMeta, 'id' | 'workspaceId'>>) {
  const cur = getState().workspace.sessions[id]
  if (!cur) return
  const keys = Object.keys(patch) as (keyof typeof patch)[]
  if (!keys.some((k) => cur[k] !== patch[k])) return
  act(`session/update:${keys.join(',')}`, (d) => {
    Object.assign(d.workspace.sessions[id], patch)
  })
}

/** Removes a session and everything that refers to it, atomically. The
 *  layout change uses the same pure rule as hiding a pane (lib/grid). */
export function removeSession(id: string) {
  const s = getState()
  const meta = s.workspace.sessions[id]
  if (!meta) return
  const nextLayout = dropSession(layoutOf(s.layout.byWorkspace, meta.workspaceId), id)
  act('session/remove', (d) => {
    delete d.workspace.sessions[id]
    delete d.runtime.bySession[id]
    d.layout.byWorkspace[meta.workspaceId] = nextLayout
    if (d.ui.paneMenu === id) d.ui.paneMenu = null
    if (d.ui.confirmDelete === id) d.ui.confirmDelete = null
  })
}

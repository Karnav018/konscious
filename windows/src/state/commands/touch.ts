// Marking a workspace as just used. It lives on its own because both of the
// actions that activate one need it — opening a pane (commands/layout) and
// switching workspace (commands/workspace) — and neither should import the
// other.
import type { Draft } from 'immer'

import type { AppState } from '../store'

/** Stamps `updatedAt`, which is what orders the workspace lists: the one you
 *  haven't touched the longest sinks to the end. */
export function touchWorkspace(d: Draft<AppState>, id: string | null, at = Date.now()) {
  const ws = id ? d.workspace.workspaces.find((w) => w.id === id) : undefined
  if (ws) ws.updatedAt = at
}

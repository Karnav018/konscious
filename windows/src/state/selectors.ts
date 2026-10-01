// React read hooks. Selectors return stable references (store objects are
// immutable and structurally shared), or use useShallow for derived objects,
// so components re-render only when what they read changes.
import { useShallow } from 'zustand/react/shallow'

import type { Status } from '../types'
import { layoutOf } from './commands/layout'
import { runtimeOf } from './commands/runtime'
import { type UiState, useApp } from './store'

export const useUi = <T>(select: (ui: UiState) => T): T => useApp((s) => select(s.ui))

export const useWorkspacesList = () => useApp((s) => s.workspace.workspaces)
export const useSessions = () => useApp((s) => s.workspace.sessions)
export const useActiveWorkspaceId = () => useApp((s) => s.workspace.activeId)
export const useHasWorkspaces = () => useApp((s) => s.workspace.workspaces.length > 0)

export const useActiveWorkspace = () =>
  useApp((s) => s.workspace.workspaces.find((w) => w.id === s.workspace.activeId) ?? null)

export const useWorkspaceName = (id: string | undefined) =>
  useApp((s) => s.workspace.workspaces.find((w) => w.id === id)?.name ?? '')

export const useActiveLayout = () => useApp((s) => layoutOf(s.layout.byWorkspace, s.workspace.activeId))
export const useLayouts = () => useApp((s) => s.layout.byWorkspace)

export const useSession = (id: string | null | undefined) =>
  useApp((s) => (id ? s.workspace.sessions[id] : undefined))

export const useRuntimeOf = (id: string | null | undefined) => useApp((s) => runtimeOf(s.runtime.bySession, id))
export const useRuntimes = () => useApp((s) => s.runtime.bySession)

export const useClaudeSessionCount = () =>
  useApp((s) => Object.values(s.workspace.sessions).filter((x) => x.kind === 'claude').length)

/** Status counts across all workspaces (waiting pill, status bar). */
export function useStatusCounts() {
  return useApp(
    useShallow((s) => {
      const counts: Record<Status, number> = {
        starting: 0, working: 0, waiting: 0, idle: 0, completed: 0, failed: 0, stopped: 0,
      }
      for (const r of Object.values(s.runtime.bySession)) counts[r.status]++
      return counts
    }),
  )
}

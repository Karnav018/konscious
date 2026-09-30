import { useEffect } from 'react'

import {
  jumpWaiting,
  openNewSession,
  openPaneMenu,
  openTerminalHere,
  resetPaneFontSize,
  selectPaneIndex,
  stepPaneFontSize,
  toggleFocus,
} from './app/actions'
import { layoutOf } from './state/commands/layout'
import { bootstrap } from './app/bootstrap'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { DeleteSessionDialog } from './components/DeleteSessionDialog/DeleteSessionDialog'
import { EmptyState } from './components/EmptyState/EmptyState'
import { FirstRun } from './components/FirstRun/FirstRun'
import { Inspector } from './components/Inspector/Inspector'
import { NewSessionModal } from './components/NewSessionModal/NewSessionModal'
import { SessionGrid } from './components/SessionGrid/SessionGrid'
import { StatusBar } from './components/StatusBar/StatusBar'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Toast } from './components/Toast/Toast'
import { WorkspaceMenu } from './components/WorkspaceMenu/WorkspaceMenu'
import { matchShortcut } from './lib/shortcuts'
import {
  cancelDeleteSession,
  closeOverlays,
  flash,
  setBooted,
  setRenaming,
  toggleInspector,
  toggleWorkspaceMenu,
} from './state/commands/ui'
import { useActiveLayout, useHasWorkspaces, useUi } from './state/selectors'
import { getState, type UiState } from './state/store'

const anyOverlayOpen = (ui: UiState) =>
  ui.wsMenu || ui.inspector || !!ui.paneMenu || !!ui.newSession || !!ui.confirmDelete

/** Capture phase: runs before xterm's own key handling. */
function onKeyDown(e: KeyboardEvent) {
  const s = getState()
  const sc = matchShortcut(e)
  if (sc) {
    e.preventDefault()
    e.stopPropagation()
    if (!s.ui.booted || !s.ui.init?.lockOk) return
    switch (sc.type) {
      case 'newSession':
        return void openNewSession()
      case 'newTerminal':
        return void openTerminalHere(layoutOf(s.layout.byWorkspace, s.workspace.activeId).selected)
      case 'workspaceMenu':
        if (!s.workspace.workspaces.length) return
        return toggleWorkspaceMenu(s.workspace.activeId)
      case 'inspector':
        return toggleInspector(s.ui.inspector)
      case 'jumpWaiting':
        return jumpWaiting()
      case 'toggleFocus':
        return toggleFocus()
      case 'selectPane':
        return selectPaneIndex(sc.index)
      case 'fontSize': {
        const sel = layoutOf(s.layout.byWorkspace, s.workspace.activeId).selected
        return sc.delta === 0 ? resetPaneFontSize(sel) : stepPaneFontSize(sel, sc.delta)
      }
    }
  }
  // An open dropdown handles its own Escape (closes the list, not the modal).
  const inOpenDropdown = (document.activeElement as HTMLElement | null)?.closest?.('[role="combobox"][aria-expanded="true"]')
  if (e.key === 'Escape' && anyOverlayOpen(s.ui) && !inOpenDropdown) {
    // Escape belongs to Claude unless an overlay is open.
    e.preventDefault()
    e.stopPropagation()
    if (s.ui.confirmDelete) cancelDeleteSession()
    else if (s.ui.renaming) setRenaming(false)
    else closeOverlays()
    return
  }
  if (e.metaKey && e.key.toLowerCase() === 'a') {
    const el = document.activeElement
    if (el instanceof HTMLInputElement) {
      e.preventDefault()
      el.select()
    }
  }
}

function LockScreen() {
  const base = useUi((u) => u.init?.baseDir)
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-[420px]">
        <div className="font-head text-[20px] font-semibold">Kova is already running</div>
        <div className="text-muted leading-[1.5]">
          Another instance is using <span className="font-mono text-[12px] text-text">{base}</span>. Two copies would
          resume the same Claude sessions twice, so this window stays idle. Quit the other copy and reopen this one.
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const booted = useUi((u) => u.booted)
  const lockOk = useUi((u) => u.init?.lockOk ?? true)
  const wsMenu = useUi((u) => u.wsMenu)
  const inspector = useUi((u) => u.inspector)
  const newSession = useUi((u) => u.newSession)
  const confirmDelete = useUi((u) => u.confirmDelete)
  const firstRun = !useHasWorkspaces()
  const layout = useActiveLayout()

  useEffect(() => {
    const closePaneMenu = (e: MouseEvent) => {
      if (getState().ui.paneMenu && !(e.target as HTMLElement).closest?.('[data-pane-menu]')) openPaneMenu(null)
    }
    window.addEventListener('mousedown', closePaneMenu)
    window.addEventListener('keydown', onKeyDown, true)
    void bootstrap().catch((e) => {
      console.error(e)
      setBooted()
      flash(`Startup failed: ${String(e?.message ?? e)}`)
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', closePaneMenu)
    }
  }, [])

  const main = !booted ? null : !lockOk ? (
    <LockScreen />
  ) : firstRun ? (
    <FirstRun />
  ) : layout.open.length === 0 ? (
    <EmptyState />
  ) : (
    <SessionGrid />
  )

  return (
    <div className="h-full min-w-[1080px] flex flex-col bg-win relative overflow-hidden text-text">
      <TitleBar />
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2 gap-2 bg-win">
          <ErrorBoundary label="main">{main}</ErrorBoundary>
        </div>
      </div>
      <StatusBar />
      <ErrorBoundary label="overlays">
        {booted && lockOk && inspector && !firstRun && <Inspector />}
        {booted && lockOk && wsMenu && !firstRun && <WorkspaceMenu />}
        {booted && lockOk && newSession && <NewSessionModal />}
        {booted && lockOk && confirmDelete && <DeleteSessionDialog />}
      </ErrorBoundary>
      <Toast />
    </div>
  )
}

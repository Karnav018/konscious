import { useEffect } from 'react'

import {
  jumpWaiting,
  movePane,
  openNewSession,
  openPaneMenu,
  openTerminalHere,
  resetPaneFontSize,
  selectPaneIndex,
  stepPaneFontSize,
  toggleFocus,
} from './app/actions'
import { setAppPanel, setAppPopover } from './state/commands/apps'
import { layoutOf } from './state/commands/layout'
import { bootstrap } from './app/bootstrap'
import { startReminders } from './app/reminders'
import { startBundleOpens } from './app/transfer'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { DeleteSessionDialog } from './components/DeleteSessionDialog/DeleteSessionDialog'
import { RemoveWorkspaceDialog } from './components/RemoveWorkspaceDialog/RemoveWorkspaceDialog'
import { EmptyState } from './components/EmptyState/EmptyState'
import { FirstRun } from './components/FirstRun/FirstRun'
import { Inspector } from './components/Inspector/Inspector'
import { NewSessionModal } from './components/NewSessionModal/NewSessionModal'
import { AppsPanel } from './components/Dock/AppsPanel'
import { Transfer } from './components/Transfer/Transfer'
import { Dock } from './components/Dock/Dock'
import { NotesView } from './components/Notes/Notes'
import { NotesSaveDialog } from './components/Notes/NotesSaveDialog'
import { SessionGrid } from './components/SessionGrid/SessionGrid'
import { StatusBar } from './components/StatusBar/StatusBar'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Toast } from './components/Toast/Toast'
import { WorkspaceMenu } from './components/WorkspaceMenu/WorkspaceMenu'
import { IS_WINDOWS, isBrowserKey } from './lib/platform'
import { matchShortcut } from './lib/shortcuts'
import { closeNotesSave, toggleNotesOpen } from './state/commands/notes'
import {
  cancelDeleteSession,
  cancelRemoveWorkspace,
  closeOverlays,
  closeSettingsMenu,
  flash,
  setBooted,
  setRenaming,
  toggleInspector,
  toggleWorkspaceMenu,
} from './state/commands/ui'
import { useActiveLayout, useHasWorkspaces, useUi } from './state/selectors'
import { getState, type UiState } from './state/store'

const anyOverlayOpen = (ui: UiState) =>
  ui.wsMenu || ui.inspector || !!ui.transfer || !!ui.settingsMenu || !!ui.paneMenu || !!ui.newSession || !!ui.confirmDelete || !!ui.confirmRemoveWorkspace || !!ui.notesSave

/** Capture phase: runs before xterm's own key handling. */
function onKeyDown(e: KeyboardEvent) {
  // WebView2 would reload/print/find on the app page itself. Cancel only the
  // browser action; the key still reaches the terminal (Ctrl+R stays ^R).
  if (IS_WINDOWS && isBrowserKey(e)) e.preventDefault()
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
      case 'notes':
        return toggleNotesOpen()
      case 'selectPane':
        return selectPaneIndex(sc.index)
      case 'apps':
        return setAppPanel(s.ui.appPanel ? null : 'catalog')
      case 'movePane':
        return movePane(layoutOf(s.layout.byWorkspace, s.workspace.activeId).selected, sc.delta)
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
    if (s.ui.notesSave) closeNotesSave()
    else if (s.ui.confirmRemoveWorkspace) cancelRemoveWorkspace()
    else if (s.ui.confirmDelete) cancelDeleteSession()
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
  // The previous version still holds its data folder: Konscious only moves
  // it over once that app has quit.
  const oldVersion = useUi((u) => u.init?.previousVersion ?? false)
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-[420px]">
        <div className="font-head text-[20px] font-semibold">
          {oldVersion ? 'The previous version is still running' : 'Konscious is already running'}
        </div>
        {oldVersion ? (
          <div className="text-muted leading-[1.5]">
            Your sessions are still open in the previous version of this app. Quit it, then reopen Konscious — your
            sessions move over and resume on their own.
          </div>
        ) : (
          <div className="text-muted leading-[1.5]">
            Another instance is using <span className="font-mono text-[12px] text-text">{base}</span>. Two copies would
            resume the same Claude sessions twice, so this window stays idle. Quit the other copy and reopen this one.
          </div>
        )}
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
  const confirmRemoveWs = useUi((u) => u.confirmRemoveWorkspace)
  const notesOpen = useUi((u) => u.notesOpen)
  const notesSave = useUi((u) => u.notesSave)
  const firstRun = !useHasWorkspaces()
  const layout = useActiveLayout()

  useEffect(() => {
    const closePopovers = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      const ui = getState().ui
      if (ui.paneMenu && !el.closest?.('[data-pane-menu]')) openPaneMenu(null)
      if (ui.settingsMenu && !el.closest?.('[data-settings-menu],[data-settings-button]')) closeSettingsMenu()
      if (ui.appPopover && !el.closest?.('[data-dock]')) setAppPopover(null)
    }
    window.addEventListener('mousedown', closePopovers)
    const stopReminders = startReminders()
    const stopBundles = startBundleOpens()
    window.addEventListener('keydown', onKeyDown, true)
    // WebView2's page menu (Back, Refresh, Print…) makes no sense in an app;
    // text fields keep theirs for cut/copy/paste.
    const noPageMenu = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
    }
    if (IS_WINDOWS) window.addEventListener('contextmenu', noPageMenu)
    void bootstrap().catch((e) => {
      console.error(e)
      setBooted()
      flash(`Startup failed: ${String(e?.message ?? e)}`)
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('contextmenu', noPageMenu)
      window.removeEventListener('mousedown', closePopovers)
      stopReminders()
      void stopBundles.then((off) => off()).catch(() => {})
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

  const showNotes = booted && lockOk && !firstRun && notesOpen

  return (
    <div className="h-full min-w-[1080px] flex flex-col bg-win relative overflow-hidden text-text">
      <TitleBar />
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2 gap-2 bg-win relative">
          {/* Notes covers the stage; the panes stay laid out (hidden, inert)
              underneath so the terminals keep their size and keep running. */}
          <div className="flex-1 min-h-0 flex flex-col relative">
            <div className={`flex-1 min-h-0 flex flex-col ${showNotes ? 'invisible' : ''}`} inert={showNotes}>
              <ErrorBoundary label="main">{main}</ErrorBoundary>
            </div>
            {showNotes && (
              <div className="absolute inset-0 flex">
                <ErrorBoundary label="notes">
                  <NotesView />
                </ErrorBoundary>
              </div>
            )}
          </div>
          {booted && lockOk && !firstRun && (
            <ErrorBoundary compact label="dock">
              <Dock />
            </ErrorBoundary>
          )}
        </div>
      </div>
      <StatusBar />
      <ErrorBoundary label="overlays">
        {booted && lockOk && inspector && !firstRun && <Inspector />}
        {booted && lockOk && wsMenu && !firstRun && <WorkspaceMenu />}
        {booted && lockOk && newSession && <NewSessionModal />}
        {booted && lockOk && confirmDelete && <DeleteSessionDialog />}
        {booted && lockOk && confirmRemoveWs && <RemoveWorkspaceDialog />}
        {booted && lockOk && notesSave && <NotesSaveDialog />}
        {booted && lockOk && !firstRun && <AppsPanel />}
        {booted && lockOk && <Transfer />}
      </ErrorBoundary>
      <Toast />
    </div>
  )
}

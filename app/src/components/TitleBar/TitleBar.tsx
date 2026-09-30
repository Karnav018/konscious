// 46px title bar (design lines 26–69). Native traffic lights overlay the
// left inset; the usage-limit meters are deferred (no supported data source).
import { jumpWaiting, openNewSession, openTerminalHere, setMode, setTheme } from '../../app/actions'
import { toggleInspector, toggleWorkspaceMenu } from '../../state/commands/ui'
import {
  useActiveLayout,
  useActiveWorkspace,
  useHasWorkspaces,
  useRuntimeOf,
  useSession,
  useStatusCounts,
  useUi,
} from '../../state/selectors'
import { FolderIcon, MoonIcon, PlusIcon, SunIcon, TerminalIcon } from '../common/Icon'
import { Segmented } from '../common/Segmented'
import { StatusGlyph } from '../common/StatusGlyph'
import { UsageBar } from '../common/Usage'
import { Wordmark } from '../common/Wordmark'

export function TitleBar() {
  const theme = useUi((u) => u.theme)
  const limits = useUi((u) => u.limits)
  const limitsAt = useUi((u) => u.limitsAt)
  const limitsLive = useUi((u) => u.limitsLive)
  const fullscreen = useUi((u) => u.fullscreen)
  const wsMenu = useUi((u) => u.wsMenu)
  const inspector = useUi((u) => u.inspector)
  const firstRun = !useHasWorkspaces()
  const ws = useActiveWorkspace()
  const layout = useActiveLayout()
  const counts = useStatusCounts()
  const selected = useSession(layout.selected)
  const selRt = useRuntimeOf(layout.selected)

  return (
    <div
      data-tauri-drag-region
      className="h-[46px] flex-none flex items-center gap-[14px] pr-[10px] border-b border-line bg-side relative z-[23]"
      style={{ paddingLeft: fullscreen ? 14 : 84 }}
    >
      <div data-tauri-drag-region className="flex items-center flex-none">
        <Wordmark size={17} className="pointer-events-none" />
      </div>

      <div
        onClick={() => toggleWorkspaceMenu(ws?.id ?? null)}
        title="Workspaces & sessions (⌘O)"
        className="h-[30px] flex items-center gap-2 pl-[10px] pr-2 rounded-rs border bg-pane cursor-pointer flex-[0_1_auto] min-w-0 max-w-[170px] hover:border-line2"
        style={{ borderColor: wsMenu ? 'var(--accent)' : 'var(--line)' }}
      >
        <FolderIcon className="text-muted flex-none" />
        <span className="font-semibold text-[13px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
          {firstRun ? 'No workspace' : (ws?.name ?? 'Workspace')}
        </span>
        <span className="text-[10px] text-muted flex-none">▾</span>
      </div>

      <div className="flex flex-none">
        <Segmented
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'focus', label: 'Focus' },
          ]}
          value={layout.mode}
          onChange={setMode}
        />
      </div>

      {!firstRun && (
        <div
          onClick={() => void openTerminalHere(layout.selected)}
          title={`New terminal in ${selected ? selected.cwd.split('/').pop() : (ws?.name ?? 'workspace')} (⌘T)`}
          className="h-[30px] pl-2 pr-[10px] flex items-center gap-1 rounded-rs border border-line bg-pane cursor-pointer text-muted flex-none hover:border-line2 hover:text-text"
        >
          <PlusIcon size={12} />
          <TerminalIcon size={15} />
        </div>
      )}

      {counts.waiting > 0 && !firstRun && (
        <div
          onClick={jumpWaiting}
          title="Next session that needs you (⌘J)"
          className="h-[26px] flex items-center gap-1.5 px-[10px] rounded-pill border border-warn text-warn text-[12px] font-medium cursor-pointer whitespace-nowrap flex-none hover:bg-hover"
        >
          <span className="w-1.5 h-1.5 rounded-[3px] bg-warn" />
          {counts.waiting} waiting
        </div>
      )}

      <div data-tauri-drag-region className="flex-1 self-stretch" />

      {!firstRun && <UsageBar limits={limits} observedAt={limitsAt} live={limitsLive} />}

      <div className="flex gap-[2px] items-center">
        <div
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
          className="w-7 h-7 grid place-items-center rounded-rs text-muted cursor-pointer hover:bg-hover hover:text-text"
        >
          {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </div>
        <div
          onClick={() => toggleInspector(inspector)}
          title="Session details (⌘I)"
          className="h-7 max-w-[200px] flex items-center gap-[7px] pl-[10px] pr-2 rounded-rs border bg-pane cursor-pointer flex-none hover:border-line2"
          style={{ borderColor: inspector ? 'var(--accent)' : 'var(--line)' }}
        >
          {selected ? (
            <StatusGlyph status={selRt.status} size={11} />
          ) : (
            <span className="text-[11px] text-faint">●</span>
          )}
          <span className="text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
            {selected?.name ?? 'Details'}
          </span>
          <span className="text-[10px] text-muted flex-none">▾</span>
        </div>
        <div
          onClick={() => void openNewSession()}
          title="New session (⌘N)"
          className="h-7 pl-2 pr-[10px] flex items-center gap-1.5 rounded-rs bg-accent text-accent-ink cursor-pointer text-[12.5px] font-medium ml-1"
        >
          <PlusIcon />
          New session
        </div>
      </div>
    </div>
  )
}

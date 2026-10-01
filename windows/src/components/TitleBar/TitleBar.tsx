// 46px title bar (design lines 26–69). Native traffic lights overlay the
// left inset; the usage-limit meters are deferred (no supported data source).
import { jumpWaiting, openNewSession, openTerminalHere, setMode, setTheme, setWarmthPercent, toggleWarm } from '../../app/actions'
import { isWarm, percentAt } from '../../lib/warmth'
import { basename } from '../../lib/path'
import { IS_WINDOWS, kbd } from '../../lib/platform'
import { toggleInspector, toggleWarmMenu, toggleWorkspaceMenu } from '../../state/commands/ui'
import {
  useActiveLayout,
  useActiveWorkspace,
  useHasWorkspaces,
  useRuntimeOf,
  useSession,
  useStatusCounts,
  useUi,
} from '../../state/selectors'
import { FlameIcon, FolderIcon, MoonIcon, PlusIcon, SunIcon, TerminalIcon } from '../common/Icon'
import { Segmented } from '../common/Segmented'
import { StatusGlyph } from '../common/StatusGlyph'
import { UpdateChip } from '../common/UpdateChip'
import { UsageBar } from '../common/Usage'
import { Wordmark } from '../common/Wordmark'

/** The lamp's popover: on/off and how warm. Warming is a comfort setting, so
 *  it stays a slider rather than a schedule — you warm it when your eyes ask. */
function WarmthMenu() {
  const warm = useUi((u) => u.warm)
  const warmth = useUi((u) => u.warmth)
  const on = warm && isWarm(warmth)
  return (
    <div
      data-warm-menu
      className="absolute top-[42px] right-[10px] w-[244px] p-2.5 bg-raised border border-line2 rounded-rs shadow-pop z-[25] flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12.5px] font-medium">Warm colours</span>
        <div
          onClick={toggleWarm}
          className="h-6 px-2 flex items-center rounded-rs border text-[11px] cursor-pointer"
          style={{
            borderColor: on ? 'var(--accent)' : 'var(--line2)',
            color: on ? 'var(--accent)' : 'var(--faint)',
          }}
        >
          {on ? 'On' : 'Off'}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percentAt(warmth)}
        onChange={(e) => setWarmthPercent(Number(e.target.value))}
        title="How warm"
        className="w-full cursor-pointer"
        style={{ accentColor: 'var(--accent)' }}
      />
      <div className="flex items-center justify-between font-mono text-[10.5px] text-faint">
        <span>Neutral</span>
        <span style={{ color: on ? 'var(--accent)' : 'var(--faint)' }}>{warmth}K</span>
        <span>Amber</span>
      </div>
      <div className="text-[11px] text-muted leading-[1.4]">
        Warms this window only, not the screen. Status colours stay true.
      </div>
    </div>
  )
}

export function TitleBar() {
  const theme = useUi((u) => u.theme)
  const warm = useUi((u) => u.warm)
  const warmth = useUi((u) => u.warmth)
  const warmMenu = useUi((u) => u.warmMenu)
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
      // 84px clears the macOS traffic lights; Windows has a native title bar.
      style={{ paddingLeft: fullscreen || IS_WINDOWS ? 14 : 84 }}
    >
      <div data-tauri-drag-region className="flex items-center flex-none">
        <Wordmark size={17} className="pointer-events-none" />
      </div>

      <div
        onClick={() => toggleWorkspaceMenu(ws?.id ?? null)}
        data-ws-trigger
        title={`Workspaces & sessions (${kbd('O')})`}
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
          title={`New terminal in ${selected ? (IS_WINDOWS ? basename(selected.cwd) : selected.cwd.split('/').pop()) : (ws?.name ?? 'workspace')} (${kbd('T')})`}
          className="h-[30px] pl-2 pr-[10px] flex items-center gap-1 rounded-rs border border-line bg-pane cursor-pointer text-muted flex-none hover:border-line2 hover:text-text"
        >
          <PlusIcon size={12} />
          <TerminalIcon size={15} />
        </div>
      )}

      {counts.waiting > 0 && !firstRun && (
        <div
          onClick={jumpWaiting}
          title={`Next session that needs you (${kbd('J')})`}
          className="h-[26px] flex items-center gap-1.5 px-[10px] rounded-pill border border-warn text-warn text-[12px] font-medium cursor-pointer whitespace-nowrap flex-none hover:bg-hover"
        >
          <span className="w-1.5 h-1.5 rounded-[3px] bg-warn" />
          {counts.waiting} waiting
        </div>
      )}

      <UpdateChip />

      <div data-tauri-drag-region className="flex-1 self-stretch" />

      {!firstRun && <UsageBar limits={limits} observedAt={limitsAt} live={limitsLive} />}

      <div className="flex gap-[2px] items-center">
        <div
          data-warm-button
          onClick={toggleWarmMenu}
          title="Warm colours for late sessions"
          className="w-7 h-7 grid place-items-center rounded-rs cursor-pointer hover:bg-hover hover:text-text"
          style={{ color: warm && isWarm(warmth) ? 'var(--accent)' : 'var(--muted)' }}
        >
          <FlameIcon />
        </div>
        <div
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
          className="w-7 h-7 grid place-items-center rounded-rs text-muted cursor-pointer hover:bg-hover hover:text-text"
        >
          {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </div>
        <div
          onClick={() => toggleInspector(inspector)}
          title={`Session details (${kbd('I')})`}
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
          title={`New session (${kbd('N')})`}
          className="h-7 pl-2 pr-[10px] flex items-center gap-1.5 rounded-rs bg-accent text-accent-ink cursor-pointer text-[12.5px] font-medium ml-1"
        >
          <PlusIcon />
          New session
        </div>
      </div>

      {warmMenu && <WarmthMenu />}
    </div>
  )
}

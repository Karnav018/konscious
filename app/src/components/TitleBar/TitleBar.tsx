// 46px title bar (design lines 26–69). Native traffic lights overlay the
// left inset; the usage-limit meters are deferred (no supported data source).
import { useLayoutEffect, useRef, useState } from 'react'

import { jumpWaiting, openNewSession, openTerminalHere, setMode, switchWorkspace } from '../../app/actions'
import { basename } from '../../lib/path'
import { IS_PC, IS_WINDOWS, kbd } from '../../lib/platform'
import { setNotesOpen } from '../../state/commands/notes'
import { toggleInspector, toggleWorkspaceMenu } from '../../state/commands/ui'
import {
  useActiveLayout,
  useActiveWorkspace,
  useHasWorkspaces,
  useRuntimeOf,
  useSession,
  useStatusCounts,
  useUi,
  useWorkspacesByUse,
} from '../../state/selectors'
import { FolderIcon, PlusIcon, TerminalIcon } from '../common/Icon'
import { Segmented } from '../common/Segmented'
import { StatusGlyph } from '../common/StatusGlyph'
import { UpdateChip } from '../common/UpdateChip'
import { UsageBar } from '../common/Usage'
import { Wordmark } from '../common/Wordmark'
import { QuickMenu, SettingsButtons, SettingsMenu } from '../Settings/Settings'

const wsSegment =
  'relative z-[1] h-[24px] flex items-center gap-1.5 px-2 rounded-rs cursor-pointer min-w-0 max-w-[140px] transition-colors duration-200'

/**
 * The workspace button, as a switch between the two workspaces used most
 * recently (like Grid / Focus): the highlight slides to the one you pick. The
 * pair keeps the order the workspaces were added in, so the highlight moves
 * rather than the names. Clicking the active one opens the menu (as does the
 * workspace shortcut).
 */
function WorkspaceSwitch({ firstRun }: { firstRun: boolean }) {
  const wsMenu = useUi((u) => u.wsMenu)
  const ws = useActiveWorkspace()
  // Ordered by last use: the first one that isn't active is where you were.
  const other = useWorkspacesByUse().find((w) => w.id !== ws?.id)
  const pair = ws && other ? [ws, other].sort((a, b) => a.createdAt - b.createdAt) : ws ? [ws] : []
  const openMenu = () => toggleWorkspaceMenu(ws?.id ?? null)

  // The highlight is one element that slides under whichever segment is
  // active; measured, since names make the segments different widths.
  const segs = useRef(new Map<string, HTMLDivElement>())
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const pairKey = pair.map((w) => w.id).join('|')
  const track = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ws && segs.current.get(ws.id)
      setThumb(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
    }
    measure()
    // A narrow window squeezes the names: follow the segment's new width.
    const ro = new ResizeObserver(measure)
    if (track.current) ro.observe(track.current)
    return () => ro.disconnect()
  }, [ws?.id, ws?.name, other?.name, pairKey])

  return (
    <div
      ref={track}
      data-ws-trigger
      className="relative h-[30px] flex items-center gap-[2px] p-[2px] rounded-rs border bg-sel flex-[0_1_auto] min-w-0"
      style={{ borderColor: wsMenu ? 'var(--accent)' : 'transparent' }}
    >
      {thumb && (
        <div
          aria-hidden
          className="absolute top-[2px] h-[24px] rounded-rs transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width, background: 'var(--raised)', boxShadow: 'var(--segShadow)' }}
        />
      )}
      {firstRun || !ws ? (
        <div onClick={openMenu} className={wsSegment} style={{ color: 'var(--text)' }}>
          <FolderIcon className="text-muted flex-none" />
          <span className="font-semibold text-[13px] whitespace-nowrap">{firstRun ? 'No workspace' : 'Workspace'}</span>
        </div>
      ) : (
        pair.map((w) => {
          const on = w.id === ws.id
          return (
            <div
              key={w.id}
              ref={(el) => void (el ? segs.current.set(w.id, el) : segs.current.delete(w.id))}
              onClick={on ? openMenu : () => switchWorkspace(w.id)}
              title={on ? `Workspaces & sessions (${kbd('O')})` : `Switch to ${w.name}`}
              className={`${wsSegment} ${on ? '' : 'hover:text-text'}`}
              style={{ color: on ? 'var(--text)' : 'var(--muted)' }}
            >
              <FolderIcon
                className="flex-none transition-colors duration-200"
                style={{ color: on ? 'var(--accent)' : 'var(--faint)' }}
              />
              <span
                className={`text-[13px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0 ${on ? 'font-semibold' : 'font-medium'}`}
              >
                {w.name}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

export function TitleBar() {
  const settingsMenu = useUi((u) => u.settingsMenu)
  const limits = useUi((u) => u.limits)
  const limitsAt = useUi((u) => u.limitsAt)
  const limitsLive = useUi((u) => u.limitsLive)
  const fullscreen = useUi((u) => u.fullscreen)
  const inspector = useUi((u) => u.inspector)
  const firstRun = !useHasWorkspaces()
  const ws = useActiveWorkspace()
  const layout = useActiveLayout()
  const notesOpen = useUi((u) => u.notesOpen)
  const counts = useStatusCounts()
  const selected = useSession(layout.selected)
  const selRt = useRuntimeOf(layout.selected)

  return (
    <div
      data-tauri-drag-region
      className="h-[46px] flex-none flex items-center gap-2 pr-[10px] border-b border-line bg-side relative z-[23]"
      // 84px clears the macOS traffic lights; Windows and Linux have a native title bar.
      style={{ paddingLeft: fullscreen || IS_PC ? 14 : 84 }}
    >
      {/* Below 1080px wide — only Linux tiles go there — the bar sheds the
          logo, the usage rings (Claude's status line shows them too) and the
          New session label, so the workspace and session names keep room. */}
      <div data-tauri-drag-region className="flex items-center flex-none max-[700px]:hidden">
        <Wordmark size={17} className="pointer-events-none" />
      </div>

      <WorkspaceSwitch firstRun={firstRun} />

      <div className="flex flex-none">
        <Segmented
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'focus', label: 'Focus' },
            { value: 'notes', label: <span title={IS_PC ? 'Notes' : 'Notes (⌘⇧N)'}>Notes</span> },
          ]}
          value={notesOpen && !firstRun ? 'notes' : layout.mode}
          onChange={(v) => (v === 'notes' ? setNotesOpen(true) : setMode(v))}
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

      {!firstRun && (
        <div className="contents max-[900px]:hidden">
          <UsageBar limits={limits} observedAt={limitsAt} live={limitsLive} />
        </div>
      )}

      {/* When the bar runs out of room the session name gives way (…), never
          New session: it would wrap onto two lines. */}
      <div className="flex gap-[2px] items-center min-w-0">
        <SettingsButtons />
        <div
          onClick={() => toggleInspector(inspector)}
          title={`Session details (${kbd('I')})`}
          className="h-7 max-w-[200px] min-w-[64px] flex items-center gap-[7px] pl-[10px] pr-2 rounded-rs border bg-pane cursor-pointer hover:border-line2"
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
          className="h-7 pl-2 pr-[10px] flex items-center gap-1.5 rounded-rs bg-accent text-accent-ink cursor-pointer text-[12.5px] font-medium ml-1 flex-none whitespace-nowrap"
        >
          <PlusIcon />
          <span className="max-[720px]:hidden">New session</span>
        </div>
      </div>

      {settingsMenu === 'all' && <SettingsMenu />}
      {settingsMenu === 'quick' && <QuickMenu />}
    </div>
  )
}

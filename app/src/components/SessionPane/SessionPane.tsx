// One grid pane (design lines 121–181). The design's mock transcript, input
// line and mode line are Claude's own TUI — here the real xterm fills the body.
import { useEffect, useRef } from 'react'

import {
  focusPane,
  hidePane,
  killSession,
  movePane,
  openNewSession,
  openPaneMenu,
  requestDeleteSession,
  resetPaneFontSize,
  stepPaneFontSize,
  restartSession,
  startNewConversation,
  startSession,
  stopSession,
  toggleFocus,
} from '../../app/actions'
import { STATUS_COLOR, STATUS_LABEL } from '../../lib/format'
import { requestStart, terminals } from '../../lib/terminals'
import { setInspector } from '../../state/commands/ui'
import { isEnded } from '../../state/machine'
import { useRuntimeOf, useSession, useUi } from '../../state/selectors'
import { getState } from '../../state/store'
import type { Runtime, SessionMeta } from '../../types'
import { CloseIcon, DotsIcon, GripIcon, MaximizeIcon, MinimizeIcon } from '../common/Icon'
import { StatusGlyph } from '../common/StatusGlyph'
import { AttachedFiles } from './AttachedFiles'
import { ContextRing, ModelBadge } from '../common/Usage'
import { noDrag, type PaneReorder, paneCell } from '../SessionGrid/usePaneDrag'

/** ⌘⇧← / ⌘⇧→ also move the selected pane. */
const MOVE_HINT = 'Drag to move this pane (⌘⇧← / ⌘⇧→)'

interface MenuItem {
  label: string
  key?: string
  danger?: boolean
  run: () => void
}

function menuFor(meta: SessionMeta, rt: Runtime, reorder: PaneReorder | null): MenuItem[] {
  const items: MenuItem[] = [
    { label: 'Session details', key: '⌘I', run: () => setInspector(true) },
    { label: 'Rename…', run: () => setInspector(true, true) },
    ...(reorder?.canLeft ? [{ label: 'Move left', key: '⌘⇧←', run: () => movePane(meta.id, -1) }] : []),
    ...(reorder?.canRight ? [{ label: 'Move right', key: '⌘⇧→', run: () => movePane(meta.id, 1) }] : []),
    {
      label: 'New session in this folder',
      run: () => void openNewSession({ workspaceId: meta.workspaceId, dir: meta.cwd, kind: meta.kind }),
    },
  ]
  if (rt.running) items.push({ label: 'Stop', run: () => stopSession(meta.id) })
  else items.push({ label: 'Resume session', run: () => void startSession(meta.id) })
  items.push({ label: 'Restart', run: () => void restartSession(meta.id) })
  if (rt.resumeFailed) items.push({ label: 'Start new conversation', run: () => void startNewConversation(meta.id) })
  if (rt.running) items.push({ label: 'Kill process', danger: true, run: () => killSession(meta.id) })
  items.push({
    label: meta.kind === 'shell' ? 'Delete terminal' : 'Delete session…',
    danger: true,
    run: () => requestDeleteSession(meta.id),
  })
  return items
}

function HeaderButton(props: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      title={props.title}
      {...noDrag}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      className="w-6 h-6 flex-none grid place-items-center rounded-rs text-faint cursor-pointer hover:bg-hover hover:text-text"
    >
      {props.children}
    </div>
  )
}

/** "Text size  − 14 +  Default" — stays open while stepping. */
function FontSizeRow({ id, pinned }: { id: string; pinned: number | null }) {
  const step = (d: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    stepPaneFontSize(id, d)
  }
  const btn =
    'w-6 h-6 grid place-items-center rounded-rs border border-line2 cursor-pointer text-[13px] leading-none hover:border-accent'
  return (
    <div className="h-8 px-2 flex items-center gap-1.5 text-[12.5px]" onClick={(e) => e.stopPropagation()}>
      <span className="flex-1">Text size</span>
      <div className={btn} onClick={step(-1)} title="Smaller (⌘−)">−</div>
      <span className="w-8 text-center font-mono text-[11.5px] text-muted">
        {pinned ?? Math.round(terminals.currentFontSize(id))}
      </span>
      <div className={btn} onClick={step(1)} title="Larger (⌘+)">+</div>
      <div
        onClick={(e) => {
          e.stopPropagation()
          resetPaneFontSize(id)
        }}
        title="Automatic size for this pane (⌘0)"
        className="h-6 px-1.5 flex items-center rounded-rs border text-[10.5px] cursor-pointer"
        style={{
          borderColor: pinned ? 'var(--accent)' : 'var(--line)',
          color: pinned ? 'var(--accent)' : 'var(--faint)',
        }}
      >
        Default
      </div>
    </div>
  )
}

function EndedBar({ meta, rt }: { meta: SessionMeta; rt: Runtime }) {
  const why =
    rt.status === 'failed'
      ? rt.resumeFailed
        ? "Couldn't resume this conversation"
        : `Exited${rt.exitCode ? ` with code ${rt.exitCode}` : ''}`
      : rt.status === 'completed'
        ? 'Session ended'
        : 'Not running'
  return (
    <div className="absolute left-0 right-0 bottom-0 flex items-center gap-3 px-3.5 py-2 border-t border-line bg-pane font-mono text-[12px] z-[2]">
      <span style={{ color: STATUS_COLOR[rt.status] }}>—</span>
      <span className="text-muted whitespace-nowrap overflow-hidden text-ellipsis">{why}</span>
      <span className="flex-1" />
      {rt.resumeFailed && (
        <div
          onClick={() => void startNewConversation(meta.id)}
          className="h-6 px-2.5 flex items-center rounded-rs border border-line2 cursor-pointer text-muted hover:text-text font-ui text-[12px]"
        >
          Start new conversation
        </div>
      )}
      <div
        onClick={() => void startSession(meta.id)}
        className="h-6 px-2.5 flex items-center gap-2 rounded-rs bg-accent text-accent-ink cursor-pointer font-ui text-[12px] font-medium"
      >
        {meta.kind === 'claude' ? 'Resume' : 'Restart shell'}
      </div>
    </div>
  )
}

export function SessionPane({
  id,
  selected,
  multi,
  focused,
  reorder,
}: {
  id: string
  selected: boolean
  multi: boolean
  focused: boolean
  /** Set when this pane can be moved to another slot; null when it can't. */
  reorder: PaneReorder | null
}) {
  const meta = useSession(id)
  const rt = useRuntimeOf(id)
  const menuOpen = useUi((u) => u.paneMenu === id)
  // Files from Finder are over this pane: they'll paste here on drop.
  const fileOver = useUi((u) => u.fileDrop === id)
  const shellName = useUi((u) => (u.env?.shell ?? '/bin/zsh').split('/').pop())
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = body.current
    if (!el || !meta) return
    terminals.ensure(id, meta.kind)
    terminals.setFontOverride(id, meta.fontSize)
    terminals.mount(id, el)
    return () => terminals.unmount(id, el)
  }, [id, meta?.kind])

  useEffect(() => {
    if (meta) terminals.setFontOverride(id, meta.fontSize)
  }, [id, meta?.fontSize])

  if (!meta) return null
  const ended = isEnded(rt.status)
  const items = menuOpen ? menuFor(meta, rt, reorder) : []

  return (
    <div
      {...paneCell(id)}
      onMouseDown={() => {
        if (!selected) focusPane(id)
        requestStart(id)
        if (getState().ui.paneMenu && !menuOpen) openPaneMenu(null)
      }}
      className="group/pane flex flex-col min-w-0 min-h-0 bg-pane border rounded-r overflow-hidden relative"
      style={{
        borderColor: reorder?.dropTarget || fileOver || (selected && multi) ? 'var(--accent)' : 'var(--line)',
        boxShadow: fileOver ? 'inset 0 0 0 1px var(--accent)' : undefined,
        // The pane being carried fades; the one under the cursor stays lit.
        opacity: reorder?.dragging ? 0.45 : 1,
      }}
    >
      <div
        {...reorder?.handle}
        className={`h-9 flex-none flex items-center gap-2 ${reorder ? 'pl-1.5' : 'pl-3'} pr-1.5 border-b border-line`}
      >
        {reorder && (
          <div
            title={MOVE_HINT}
            className="w-3.5 h-6 flex-none grid place-items-center text-faint hover:text-text opacity-0 group-hover/pane:opacity-100"
            style={reorder.dragging ? { opacity: 1, cursor: 'grabbing' } : { cursor: 'grab' }}
          >
            <GripIcon size={12} />
          </div>
        )}
        <StatusGlyph status={rt.status} />
        <span className="font-semibold text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0 flex-[0_0_auto] max-w-[55%]">
          {meta.name}
        </span>
        {meta.kind === 'shell' && (
          <span className="font-mono text-[10.5px] px-1.5 py-px rounded-rs bg-sel text-muted flex-none">{shellName}</span>
        )}
        {meta.kind === 'claude' && <ModelBadge model={rt.context?.model} />}
        {rt.unread && <span className="w-1.5 h-1.5 rounded-[3px] bg-accent flex-none" title="Finished while you were away" />}
        <span className="font-mono text-[11px] text-faint whitespace-nowrap overflow-hidden text-ellipsis min-w-0 flex-[1_1_0]">
          {rt.git ? `⎇ ${rt.git.branch}` : ''}
        </span>
        {meta.kind === 'claude' && <ContextRing ctx={rt.context} />}
        <span
          className="text-[11.5px] whitespace-nowrap overflow-hidden min-w-0 flex-[0_100_auto]"
          style={{ color: STATUS_COLOR[rt.status] }}
        >
          {STATUS_LABEL[rt.status]}
        </span>
        <HeaderButton
          title="Session actions"
          onClick={() => openPaneMenu(menuOpen ? null : id)}
        >
          <DotsIcon />
        </HeaderButton>
        <HeaderButton title={focused ? 'Restore (⌘↵)' : 'Focus (⌘↵)'} onClick={() => toggleFocus(id)}>
          {focused ? <MinimizeIcon /> : <MaximizeIcon />}
        </HeaderButton>
        <HeaderButton title="Hide pane (process keeps running)" onClick={() => hidePane(id)}>
          <CloseIcon />
        </HeaderButton>
      </div>

      {menuOpen && (
        <div
          data-pane-menu
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-[34px] right-[56px] w-[236px] p-1 bg-raised border border-line2 rounded-rs shadow-pop z-[5] flex flex-col"
        >
          <FontSizeRow id={id} pinned={meta.fontSize} />
          <div className="h-px bg-line mx-1 my-1" />
          {items.map((m) => (
            <div
              key={m.label}
              onClick={(e) => {
                e.stopPropagation()
                openPaneMenu(null)
                m.run()
              }}
              className="h-7 px-2 flex items-center justify-between rounded-rs cursor-pointer text-[12.5px] hover:bg-sel"
              style={{ color: m.danger ? 'var(--err)' : 'var(--text)' }}
            >
              <span>{m.label}</span>
              <span className="font-mono text-[10.5px] text-faint">{m.key ?? ''}</span>
            </div>
          ))}
        </div>
      )}

      {reorder?.dropTarget && (
        <div
          className="absolute inset-0 z-[4] grid place-items-center pointer-events-none"
          style={{ background: 'var(--accentSoft)' }}
        >
          <span className="px-2.5 py-1 rounded-rs bg-raised border border-accent shadow-pop text-[12px]">Move here</span>
        </div>
      )}

      <div ref={body} className="flex-1 min-h-0 relative" />
      {fileOver && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none z-[3]">
          <span className="px-2.5 py-1 rounded-pill bg-accent text-accent-ink text-[11.5px] font-medium shadow-pop">
            Drop to paste the path
          </span>
        </div>
      )}
      {!ended && <AttachedFiles id={id} />}
      {ended && <EndedBar meta={meta} rt={rt} />}
    </div>
  )
}

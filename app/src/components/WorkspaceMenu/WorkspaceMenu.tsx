// ⌘O popover (design lines 316–365): workspaces on the left, the hovered
// workspace's sessions on the right with In grid / Show toggles.
import { useEffect, useMemo, useState } from 'react'

import {
  hidePane,
  openNewSession,
  pickWorkspaceFolder,
  requestDeleteSession,
  requestRemoveWorkspace,
  selectSession,
  stopWorkspaceSessions,
  switchWorkspace,
} from '../../app/actions'
import { ago, relTo, STATUS_COLOR, STATUS_LABEL, tildify } from '../../lib/format'
import { pickAndImport } from '../../app/transfer'
import { CAP } from '../../lib/grid'
import { shellLabel } from '../../lib/path'
import { IS_WINDOWS } from '../../lib/platform'
import { layoutOf } from '../../state/commands/layout'
import { runtimeOf } from '../../state/commands/runtime'
import { closeWorkspaceMenu, hoverWorkspace, openExport, setWsFilter } from '../../state/commands/ui'
import {
  useActiveWorkspaceId,
  useLayouts,
  useRuntimes,
  useSessions,
  useUi,
  useWorkspacesByUse,
} from '../../state/selectors'
import type { WsFilter } from '../../state/store'
import type { SessionMeta } from '../../types'
import { formatBytes, totalOf, useSessionMemory } from '../../lib/memory'
import { CloseIcon, FolderIcon, StopIcon, TrashIcon } from '../common/Icon'
import { StatusGlyph, useNow } from '../common/StatusGlyph'

const FILTERS: { v: WsFilter; l: string }[] = [
  { v: 'all', l: 'All' },
  { v: 'working', l: 'Working' },
  { v: 'waiting', l: 'Waiting' },
]

const label = 'font-head text-[11.5px] text-faint font-semibold'

const sessionsIn = (sessions: Record<string, SessionMeta>, wsId: string) =>
  Object.values(sessions)
    .filter((x) => x.workspaceId === wsId)
    .sort((a, b) => a.createdAt - b.createdAt)

/** How long "Stop N?" waits for the confirming click. */
const CONFIRM_MS = 3000

/**
 * Stops every running session in the workspace. Asks once ("Stop 4?") since
 * it interrupts whatever Claude is in the middle of; stopped sessions stay in
 * the list and can be resumed.
 */
function StopAllButton({ workspaceId, name, running }: { workspaceId: string; name: string; running: number }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [armed])
  const off = running === 0
  return (
    <div
      onClick={() => {
        if (off) return
        if (!armed) return setArmed(true)
        setArmed(false)
        stopWorkspaceSessions(workspaceId)
      }}
      title={off ? `Nothing is running in ${name}` : `Stop all ${running} running in ${name} — they can be resumed`}
      aria-disabled={off}
      className={`h-7 px-2.5 flex items-center gap-1.5 rounded-rs border text-[12.5px] font-medium whitespace-nowrap flex-none ${off ? 'cursor-default' : 'cursor-pointer hover:border-err hover:text-err'}`}
      style={{
        borderColor: armed ? 'var(--err)' : 'var(--line2)',
        color: off ? 'var(--faint)' : armed ? 'var(--err)' : 'var(--muted)',
        background: armed ? 'var(--hover)' : 'transparent',
      }}
    >
      <StopIcon />
      {armed ? `Stop ${running}?` : 'Stop all'}
    </div>
  )
}

export function WorkspaceMenu() {
  const wsHover = useUi((u) => u.wsHover)
  const wsFilter = useUi((u) => u.wsFilter)
  const home = useUi((u) => u.init?.home)
  const shellTag = useUi((u) => (IS_WINDOWS ? shellLabel(u.env?.shell) : (u.env?.shell ?? '/bin/zsh').split('/').pop()))
  const workspaces = useWorkspacesByUse()
  // Subscribing here means the engine is only polled while this menu is open.
  const memory = useSessionMemory()
  const sessions = useSessions()
  const activeId = useActiveWorkspaceId()
  const runtime = useRuntimes()
  const layouts = useLayouts()
  const now = useNow()
  // Opens under the workspace button, wherever the wordmark and the window
  // chrome (traffic lights, fullscreen) put it.
  const left = useMemo(
    () => document.querySelector<HTMLElement>('[data-ws-trigger]')?.getBoundingClientRect().left ?? 170,
    [],
  )

  const shown = workspaces.find((w) => w.id === (wsHover ?? activeId)) ?? workspaces[0]
  if (!shown) return null
  const all = sessionsIn(sessions, shown.id)
  const running = all.filter((m) => runtimeOf(runtime, m.id).running).length
  const items = all.filter((m) => wsFilter === 'all' || runtimeOf(runtime, m.id).status === wsFilter)
  const shownLayout = layoutOf(layouts, shown.id)

  return (
    <div onMouseDown={closeWorkspaceMenu} className="absolute inset-0 z-[22]">
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ left, maxWidth: `calc(100% - ${left + 20}px)` }}
        className="absolute top-[42px] w-[640px] max-h-[calc(100%-80px)] flex bg-raised border border-line2 rounded-r shadow-pop overflow-hidden"
      >
        <div className="w-[220px] flex-none border-r border-line p-2 flex flex-col gap-[2px] bg-side overflow-auto">
          <div className={`px-2 pt-1.5 pb-2 ${label}`}>Workspaces</div>
          {workspaces.map((w) => {
            const ss = sessionsIn(sessions, w.id)
            const wk = ss.filter((x) => runtimeOf(runtime, x.id).status === 'working').length
            const wt = ss.filter((x) => runtimeOf(runtime, x.id).status === 'waiting').length
            const held = totalOf(memory, ss.map((x) => x.id))
            const hov = (wsHover ?? activeId) === w.id
            const note = wt ? `${wt} waiting` : wk ? `${wk} working` : w.id === activeId ? 'active' : ''
            return (
              <div
                key={w.id}
                onMouseEnter={() => wsHover !== w.id && hoverWorkspace(w.id)}
                onClick={() => switchWorkspace(w.id)}
                className="group/ws relative flex items-center gap-[10px] p-2 rounded-rs cursor-pointer"
                style={{ background: hov ? 'var(--sel)' : 'transparent' }}
              >
                <FolderIcon size={16} className="flex-none" style={{ color: w.id === activeId ? 'var(--accent)' : 'var(--faint)' }} />
                <div className="flex-1 min-w-0 flex flex-col gap-px">
                  <span className="text-[13px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{w.name}</span>
                  <span className="font-mono text-[10.5px] text-faint whitespace-nowrap overflow-hidden text-ellipsis">
                    {tildify(w.path, home)}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-[2px] flex-none transition-opacity group-hover/ws:opacity-0">
                  <span className="font-mono text-[11px] text-muted">
                    {ss.length}
                    {held > 0 && <span className="text-faint"> · {formatBytes(held)}</span>}
                  </span>
                  <span
                    className="text-[10.5px]"
                    style={{ color: wt ? 'var(--warn)' : wk ? 'var(--ok)' : 'var(--faint)' }}
                  >
                    {note}
                  </span>
                </div>
                {/* Hover reveals it in place of the counts. Removing only takes the
                    folder off Konscious's list; the dialog says what goes with it. */}
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    requestRemoveWorkspace(w.id)
                  }}
                  title={`Remove ${w.name} from Konscious…`}
                  aria-label={`Remove ${w.name} from Konscious`}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-rs text-faint opacity-0 transition-opacity group-hover/ws:opacity-100 hover:text-err hover:bg-hover"
                >
                  <CloseIcon />
                </div>
              </div>
            )
          })}
          <div
            onClick={() => void pickWorkspaceFolder()}
            className="mt-1.5 flex items-center gap-[10px] p-2 rounded-rs cursor-pointer text-muted border border-dashed border-line2 hover:text-text hover:border-accent"
          >
            <span className="w-4 text-center">+</span>
            <span className="text-[12.5px]">Add folder…</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
            <span className="flex-1 font-head text-[15px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
              {shown.name} sessions
            </span>
            {FILTERS.map((o) => (
              <div
                key={o.v}
                onClick={() => setWsFilter(o.v)}
                className="h-6 px-[9px] flex items-center rounded-pill cursor-pointer text-[12px]"
                style={{
                  background: wsFilter === o.v ? 'var(--sel)' : 'transparent',
                  color: wsFilter === o.v ? 'var(--text)' : 'var(--muted)',
                }}
              >
                {o.l}
              </div>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto px-2 pb-2 flex flex-col gap-px">
            {items.map((m) => {
              const r = runtimeOf(runtime, m.id)
              const inGrid = shownLayout.open.includes(m.id)
              const isSel = shown.id === activeId && shownLayout.selected === m.id
              const right = r.status === 'idle' ? ago(m.lastActiveAt, now) : STATUS_LABEL[r.status]
              const sub = [
                (m.kind === 'shell' ? `${shellTag} · ` : '') + relTo(m.cwd, shown.path),
                r.git ? `⎇ ${r.git.branch}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <div
                  key={m.id}
                  onClick={() => selectSession(m.id, { focus: true })}
                  className="group flex items-center gap-[10px] p-2 rounded-rs cursor-pointer hover:bg-sel"
                  style={{ background: isSel ? 'var(--sel)' : undefined }}
                >
                  <StatusGlyph status={r.status} size={11} />
                  <div className="flex-1 min-w-0 flex flex-col gap-px">
                    <span className="text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{m.name}</span>
                    <span className="font-mono text-[10.5px] text-faint whitespace-nowrap overflow-hidden text-ellipsis">{sub}</span>
                  </div>
                  <span
                    className="text-[11.5px] flex-none"
                    style={{ color: r.status === 'completed' || r.status === 'stopped' ? 'var(--muted)' : STATUS_COLOR[r.status] }}
                  >
                    {right}
                  </span>
                  {r.unread && <span className="w-1.5 h-1.5 rounded-[3px] bg-accent flex-none" />}
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      requestDeleteSession(m.id)
                    }}
                    title={m.kind === 'shell' ? 'Delete terminal' : 'Delete session…'}
                    aria-label={`Delete ${m.name}`}
                    className="w-6 h-6 grid place-items-center rounded-rs text-faint flex-none opacity-0 group-hover:opacity-100 hover:text-err hover:bg-hover"
                  >
                    <TrashIcon />
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      if (inGrid && shown.id === activeId) hidePane(m.id)
                      else selectSession(m.id)
                    }}
                    title={inGrid ? 'Hide from grid (keeps running)' : 'Add to grid'}
                    className="h-6 min-w-[66px] px-2 flex items-center justify-center rounded-rs border text-[11.5px] flex-none hover:border-accent"
                    style={{
                      borderColor: inGrid ? 'var(--accent)' : 'var(--line2)',
                      color: inGrid ? 'var(--accent)' : 'var(--muted)',
                    }}
                  >
                    {inGrid ? 'In grid' : 'Show'}
                  </div>
                </div>
              )
            })}
            {!items.length && (
              <div className="p-6 text-center text-faint text-[12.5px]">
                {all.length ? 'No sessions match.' : 'No sessions yet.'}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 px-3.5 py-[10px] border-t border-line">
            <span className="text-[11.5px] text-muted">
              {shownLayout.open.length} of {CAP} grid slots used · hidden sessions keep running
            </span>
            <div className="flex items-center gap-2">
              {/* Short labels: the heading above already says which workspace,
                  and the full name makes this row overflow. */}
              <div
                onClick={() => void pickAndImport()}
                title="Import a workspace from a .kon file"
                className="h-7 px-2.5 flex-none flex items-center rounded-rs border border-line2 cursor-pointer text-[12px] text-muted hover:text-text hover:border-accent"
              >
                Import…
              </div>
              <div
                onClick={() => openExport(shown.id)}
                title={`Export ${shown.name} and its conversations as a .kon file`}
                className="h-7 px-2.5 flex-none flex items-center rounded-rs border border-line2 cursor-pointer text-[12px] text-muted hover:text-text hover:border-accent"
              >
                Export…
              </div>
              <span className="flex-1" />
            <div className="flex items-center gap-2 flex-none">
              <div
                onClick={() => void openNewSession({ workspaceId: shown.id, dir: shown.path })}
                title={`New session in ${shown.name}`}
                className="h-7 px-3 flex items-center gap-1.5 rounded-rs bg-accent text-accent-ink cursor-pointer text-[12.5px] font-medium whitespace-nowrap flex-none"
              >
                + New session
              </div>
              <StopAllButton key={shown.id} name={shown.name} workspaceId={shown.id} running={running} />
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

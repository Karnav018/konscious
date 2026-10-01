// ⌘I popover, Session tab (design lines 187–235). Git and Activity tabs are M2.
import { useEffect, useRef, useState } from 'react'

import { copyText, killSession, renameSession, restartSession, startSession, stopSession } from '../../app/actions'
import { ago, clock, STATUS_COLOR, STATUS_LABEL, tildify } from '../../lib/format'
import { shellLabel } from '../../lib/path'
import { IS_WINDOWS } from '../../lib/platform'
import { setInspector, setRenaming } from '../../state/commands/ui'
import { useActiveLayout, useRuntimeOf, useSession, useUi, useWorkspaceName } from '../../state/selectors'
import { getState } from '../../state/store'
import { useNow } from '../common/StatusGlyph'

const label = 'font-head text-[11.5px] text-faint font-semibold'

export function Inspector() {
  const layout = useActiveLayout()
  const id = layout.selected
  const meta = useSession(id)
  const wsName = useWorkspaceName(meta?.workspaceId)
  const rt = useRuntimeOf(id)
  const renaming = useUi((u) => u.renaming)
  const home = useUi((u) => u.init?.home)
  const shell = useUi((u) => (IS_WINDOWS ? shellLabel(u.env?.shell) : (u.env?.shell ?? '/bin/zsh').split('/').pop()))
  const now = useNow(10_000)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming && meta) {
      setDraft(meta.name)
      requestAnimationFrame(() => input.current?.select())
    }
  }, [renaming, meta?.id])

  const commit = () => {
    if (!getState().ui.renaming || !meta) return
    renameSession(meta.id, draft)
    setRenaming(false)
  }

  const statusC = rt.status === 'completed' || rt.status === 'stopped' ? 'var(--muted)' : STATUS_COLOR[rt.status]
  const rows: [string, string][] = meta
    ? [
        ['Claude session', meta.claudeSessionId ?? '—'],
        ['Process', rt.running ? `${meta.kind === 'shell' ? shell : 'claude'} · pid ${rt.pid}` : 'not running'],
        ['Branch', rt.git?.branch ?? '—'],
        ['Started', clock(rt.startedAt)],
        ['Last activity', rt.lastActivityAt ? (ago(rt.lastActivityAt, now) === 'now' ? 'just now' : ago(rt.lastActivityAt, now)) : '—'],
      ]
    : []
  const actions = meta
    ? [
        rt.running
          ? { l: 'Stop', run: () => stopSession(meta.id) }
          : { l: 'Resume', run: () => void startSession(meta.id) },
        { l: 'Restart', run: () => void restartSession(meta.id) },
        { l: 'Kill', c: 'var(--err)', disabled: !rt.running, run: () => killSession(meta.id) },
      ]
    : []

  return (
    <div onMouseDown={() => setInspector(false)} className="absolute inset-0 z-[21]">
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute top-[42px] right-[10px] w-[340px] max-h-[calc(100%-80px)] flex flex-col bg-raised border border-line2 rounded-r shadow-pop overflow-hidden"
      >
        <div className="flex items-center gap-[2px] px-3 pt-[10px] border-b border-line">
          <div className="h-8 px-[10px] flex items-center gap-1.5 cursor-pointer text-[12.5px] font-medium border-b-2 border-accent text-text -mb-px">
            Session
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {!meta ? (
            <div className="p-6 text-center text-faint text-[12.5px]">No session selected.</div>
          ) : (
            <div className="flex flex-col gap-[18px] p-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  {renaming ? (
                    <input
                      ref={input}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          e.currentTarget.blur()
                        }
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setRenaming(false)
                        }
                      }}
                      className="flex-1 min-w-0 h-7 px-2 rounded-rs border border-accent bg-pane outline-none font-head text-[15px] font-semibold text-text"
                    />
                  ) : (
                    <span
                      onDoubleClick={() => setRenaming(true)}
                      title="Double-click to rename"
                      className="font-head text-[17px] font-semibold flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis cursor-text"
                    >
                      {meta.name}
                    </span>
                  )}
                  <span
                    className="text-[11px] font-medium px-2 py-[2px] rounded-pill border whitespace-nowrap"
                    style={{ borderColor: statusC, color: statusC }}
                  >
                    {STATUS_LABEL[rt.status]}
                  </span>
                </div>
                <span className="text-[12px] text-muted">
                  {wsName} · {meta.kind === 'shell' ? 'Terminal' : 'Claude CLI'}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={label}>Directory</span>
                <div className="flex items-center gap-2 px-[10px] py-2 border border-line rounded-rs bg-pane">
                  <span className="flex-1 min-w-0 font-mono text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis select-text">
                    {tildify(meta.cwd, home)}
                  </span>
                  <span onClick={() => void copyText(meta.cwd, 'Path copied')} className="text-[11.5px] text-accent cursor-pointer">
                    Copy
                  </span>
                </div>
              </div>

              <div className="flex flex-col">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 py-[7px] border-b border-line">
                    <span className="text-[12px] text-muted flex-none">{k}</span>
                    <span className="font-mono text-[11.5px] text-right whitespace-nowrap overflow-hidden text-ellipsis select-text">
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <span className={label}>Process</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {actions.map((a) => (
                    <div
                      key={a.l}
                      onClick={a.disabled ? undefined : a.run}
                      className="h-8 flex items-center justify-center rounded-rs border border-line2 bg-raised text-[12.5px] hover:border-accent"
                      style={{
                        color: a.c ?? 'var(--text)',
                        opacity: a.disabled ? 0.45 : 1,
                        cursor: a.disabled ? 'default' : 'pointer',
                      }}
                    >
                      {a.l}
                    </div>
                  ))}
                </div>
                <span className="text-[11.5px] text-faint leading-[1.45]">
                  Hiding a pane never stops Claude. Conversation history stays with the CLI.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Confirmation for removing a workspace (a folder) from Konscious. Only
// Konscious forgets it: the folder stays on disk. When Claude sessions would go
// with it, the Remove button waits for the word "remove" to be typed, like
// deleting a single session does.
import { useEffect, useRef, useState } from 'react'

import { removeWorkspace } from '../../app/actions'
import { tildify } from '../../lib/format'
import { cancelRemoveWorkspace } from '../../state/commands/ui'
import { useRuntimes, useSessions, useUi, useWorkspacesList } from '../../state/selectors'
import { CloseIcon } from '../common/Icon'

export const REMOVE_WORD = 'remove'

export function RemoveWorkspaceDialog() {
  const id = useUi((u) => u.confirmRemoveWorkspace)
  const home = useUi((u) => u.init?.home)
  const ws = useWorkspacesList().find((w) => w.id === id)
  const sessions = useSessions()
  const runtime = useRuntimes()
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTyped('')
    requestAnimationFrame(() => input.current?.focus())
  }, [id])

  if (!id || !ws) return null
  const mine = Object.values(sessions).filter((m) => m.workspaceId === ws.id)
  const claude = mine.filter((m) => m.kind === 'claude').length
  const running = mine.filter((m) => runtime[m.id]?.running).length
  // Typing is only asked for when conversations' panes would go too.
  const needsTyping = claude > 0
  const ok = !needsTyping || typed.trim().toLowerCase() === REMOVE_WORD
  const confirm = () => {
    if (ok) removeWorkspace(ws.id)
  }

  const what =
    mine.length === 0
      ? 'It has no sessions.'
      : `Its ${mine.length === 1 ? 'session' : `${mine.length} sessions`} ${running ? `(${running} running) ` : ''}${
          mine.length === 1 ? 'is' : 'are'
        } stopped and removed from Konscious.${claude ? ' Claude keeps each conversation — reach it again with /resume.' : ''}`

  return (
    <div
      onMouseDown={cancelRemoveWorkspace}
      className="absolute inset-0 bg-overlay flex justify-center items-center z-30"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-ws-title"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[460px] max-w-[calc(100%-40px)] bg-raised border border-line2 rounded-r shadow-pop flex flex-col gap-3.5 p-[18px]"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-rs grid place-items-center flex-none" style={{ background: 'var(--delBg)', color: 'var(--err)' }}>
            <CloseIcon />
          </div>
          <span id="remove-ws-title" className="font-head text-[17px] font-semibold min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
            Remove “{ws.name}” from Konscious?
          </span>
        </div>
        <div className="text-[12.5px] text-muted leading-[1.55] flex flex-col gap-1.5">
          <span>
            The folder <span className="font-mono text-[12px] text-text">{tildify(ws.path, home)}</span> stays on disk with
            all its files — only Konscious stops listing it.
          </span>
          <span>{what}</span>
        </div>
        {needsTyping && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted font-medium">
              Type <span className="font-mono text-text">{REMOVE_WORD}</span> to confirm
            </span>
            <input
              ref={input}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirm()
                }
              }}
              spellCheck={false}
              autoComplete="off"
              aria-label={`Type ${REMOVE_WORD} to confirm`}
              className="h-[34px] px-[10px] rounded-rs border bg-pane outline-none font-mono text-[12.5px] text-text"
              style={{ borderColor: typed && ok ? 'var(--err)' : 'var(--line2)' }}
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <div
            onClick={cancelRemoveWorkspace}
            className="h-8 px-3.5 flex items-center rounded-rs border border-line2 cursor-pointer text-[12.5px] hover:bg-hover"
          >
            Cancel
          </div>
          <button
            type="button"
            disabled={!ok}
            onClick={confirm}
            className="h-8 px-3.5 flex items-center gap-1.5 rounded-rs text-[12.5px] font-medium border-0"
            style={{
              background: ok ? 'var(--err)' : 'var(--sel)',
              color: ok ? '#fff' : 'var(--faint)',
              cursor: ok ? 'pointer' : 'not-allowed',
            }}
          >
            Remove from Konscious
          </button>
        </div>
      </div>
    </div>
  )
}

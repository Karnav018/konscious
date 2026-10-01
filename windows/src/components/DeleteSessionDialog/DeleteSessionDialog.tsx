// Typed confirmation for deleting a session: the Delete button stays
// disabled until the user types "delete", so a stray click can't remove one.
import { useEffect, useRef, useState } from 'react'

import { removeSession } from '../../app/actions'
import { cancelDeleteSession } from '../../state/commands/ui'
import { useRuntimeOf, useSession, useUi, useWorkspaceName } from '../../state/selectors'
import { TrashIcon } from '../common/Icon'

export const CONFIRM_WORD = 'delete'

export function DeleteSessionDialog() {
  const id = useUi((u) => u.confirmDelete)
  const meta = useSession(id)
  const rt = useRuntimeOf(id)
  const wsName = useWorkspaceName(meta?.workspaceId)
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTyped('')
    requestAnimationFrame(() => input.current?.focus())
  }, [id])

  if (!id || !meta) return null
  const ok = typed.trim().toLowerCase() === CONFIRM_WORD
  const confirm = () => {
    if (ok) removeSession(meta.id)
  }

  return (
    <div
      onMouseDown={cancelDeleteSession}
      className="absolute inset-0 bg-overlay flex justify-center items-center z-30"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[calc(100%-40px)] bg-raised border border-line2 rounded-r shadow-pop flex flex-col gap-3.5 p-[18px]"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-rs grid place-items-center flex-none" style={{ background: 'var(--delBg)', color: 'var(--err)' }}>
            <TrashIcon size={16} />
          </div>
          <span id="delete-title" className="font-head text-[17px] font-semibold min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
            Delete “{meta.name}”?
          </span>
        </div>
        <div className="text-[12.5px] text-muted leading-[1.55]">
          {rt.running ? 'Its process will be stopped and the' : 'The'} session is removed from {wsName || 'this workspace'}.{' '}
          {meta.kind === 'claude'
            ? 'The Claude conversation itself stays in Claude’s history — you can still reach it with /resume.'
            : 'This cannot be undone.'}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted font-medium">
            Type <span className="font-mono text-text">{CONFIRM_WORD}</span> to confirm
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
            aria-label={`Type ${CONFIRM_WORD} to confirm`}
            className="h-[34px] px-[10px] rounded-rs border bg-pane outline-none font-mono text-[12.5px] text-text"
            style={{ borderColor: ok ? 'var(--err)' : 'var(--line2)' }}
          />
        </label>
        <div className="flex justify-end gap-2">
          <div
            onClick={cancelDeleteSession}
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
            <TrashIcon size={13} /> Delete session
          </button>
        </div>
      </div>
    </div>
  )
}

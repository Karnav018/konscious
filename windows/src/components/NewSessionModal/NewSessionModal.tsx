// New session modal (design lines 391–445). Branch + worktree fields are M2.
import { useEffect, useRef, useState } from 'react'

import { createSession, expandHome } from '../../app/actions'
import { tildify } from '../../lib/format'
import { ipc } from '../../lib/ipc'
import { isRoot, join, parent, trimSep } from '../../lib/path'
import { closeNewSession, updateNewSessionDraft } from '../../state/commands/ui'
import { useUi, useWorkspacesByUse } from '../../state/selectors'
import type { NewSessionDraft } from '../../state/store'
import type { Kind } from '../../types'
import { Dropdown } from '../common/Dropdown'
import { CloseIcon, FolderIcon } from '../common/Icon'
import { Segmented } from '../common/Segmented'

const fieldLabel = 'text-[12px] text-muted font-medium'
const input =
  'h-[34px] px-[10px] rounded-rs border bg-pane outline-none text-text focus:border-accent'

export function NewSessionModal() {
  const draft = useUi((u) => u.newSession) as NewSessionDraft
  const home = useUi((u) => u.init?.home)
  const workspaces = useWorkspacesByUse()
  const [dir, setDir] = useState(() => tildify(draft.dir, home))
  const [dirOk, setDirOk] = useState(true)
  // Real subfolders of the directory currently entered (not just the workspace root).
  const [listing, setListing] = useState<{ base: string; names: string[] }>({ base: '', names: [] })
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const ws = workspaces.find((w) => w.id === draft.workspaceId) ?? workspaces[0]

  const patch = (p: Partial<NewSessionDraft>) => updateNewSessionDraft(p)

  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus())
  }, [])

  useEffect(() => {
    let cancelled = false
    const target = expandHome(dir)
    const t = setTimeout(async () => {
      const ok = await ipc.fsIsDir(target).catch(() => false)
      const names = ok ? await ipc.fsSubdirs(target).catch(() => [] as string[]) : []
      if (cancelled) return
      setDirOk(ok)
      setListing({ base: ok ? trimSep(target) : '', names })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [dir])

  const create = async () => {
    if (busy) return
    setBusy(true)
    const ok = await createSession({ ...draft, dir })
    if (!ok) setBusy(false)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void create()
    }
  }
  const browse = async () => {
    const picked = await ipc.pickFolder(expandHome(dir))
    if (picked) setDir(tildify(picked, home))
  }

  const shown = dir.trim() || '~'
  return (
    <div
      onMouseDown={closeNewSession}
      className="absolute inset-0 bg-overlay flex justify-center items-center z-20"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[520px] max-w-[calc(100%-40px)] bg-raised border border-line2 rounded-r shadow-pop flex flex-col"
      >
        <div className="flex items-center justify-between px-[18px] pt-4 pb-1">
          <span className="font-head text-[17px] font-semibold">
            {draft.kind === 'shell' ? 'New terminal' : 'New Claude session'}
          </span>
          <div
            onClick={closeNewSession}
            className="w-[26px] h-[26px] grid place-items-center rounded-rs text-faint cursor-pointer hover:bg-hover hover:text-text"
          >
            <CloseIcon size={14} />
          </div>
        </div>
        <div className="flex flex-col gap-3.5 px-[18px] pt-3 pb-[18px]">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className={fieldLabel}>Type</span>
              <Segmented<Kind>
                stretch
                itemClass="h-[26px] text-[12px] font-medium"
                options={[
                  { value: 'claude', label: 'Claude' },
                  { value: 'shell', label: 'Shell' },
                ]}
                value={draft.kind}
                onChange={(kind) => patch({ kind })}
              />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className={fieldLabel}>Workspace</span>
              <Dropdown
                options={workspaces.map((w) => ({
                  value: w.id,
                  label: w.name,
                  detail: tildify(w.path, home),
                  icon: (
                    <FolderIcon
                      className="flex-none"
                      style={{ color: w.id === ws?.id ? 'var(--accent)' : 'var(--faint)' }}
                    />
                  ),
                }))}
                value={draft.workspaceId}
                onChange={(id) => {
                  const w = workspaces.find((x) => x.id === id)
                  if (!w) return
                  patch({ workspaceId: id })
                  setDir(tildify(w.path, home))
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Name</span>
            <input
              ref={nameRef}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              onKeyDown={onKey}
              placeholder={draft.kind === 'shell' ? 'Terminal' : 'Backend API'}
              className={`${input} border-line2 text-[13px] placeholder:text-faint`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Directory</span>
            <div className="flex gap-1.5">
              <input
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                onKeyDown={onKey}
                spellCheck={false}
                className={`${input} flex-1 min-w-0 font-mono text-[12px]`}
                style={{ borderColor: dirOk ? 'var(--line2)' : 'var(--err)' }}
              />
              <div
                onClick={() => void browse()}
                className="h-[34px] px-3 flex items-center rounded-rs border border-line2 cursor-pointer text-[12.5px] text-muted hover:text-text"
              >
                Browse…
              </div>
            </div>
            {listing.base && (listing.names.length > 0 || !isRoot(listing.base)) && (
              <div className="flex flex-wrap gap-1">
                {!isRoot(listing.base) && (
                  <div
                    title="Parent folder"
                    onClick={() => setDir(tildify(parent(listing.base), home))}
                    className="h-[22px] px-2 flex items-center rounded-pill border border-line cursor-pointer font-mono text-[10.5px] text-faint hover:border-accent hover:text-text"
                  >
                    ../
                  </div>
                )}
                {listing.names.map((d) => (
                  <div
                    key={d}
                    onClick={() => setDir(tildify(join(listing.base, d), home))}
                    className="h-[22px] px-2 flex items-center rounded-pill border border-line cursor-pointer font-mono text-[10.5px] text-muted hover:border-accent hover:text-text"
                  >
                    ./{d}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-3 py-[10px] rounded-rs bg-pane border border-line font-mono text-[11.5px] leading-[1.6] flex flex-col">
            <span className="text-text whitespace-nowrap overflow-hidden text-ellipsis">
              $ cd {shown}
              {draft.kind === 'claude' ? ' && claude' : ''}
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <div
              onClick={closeNewSession}
              className="h-8 px-3.5 flex items-center rounded-rs border border-line2 cursor-pointer text-[12.5px] hover:bg-hover"
            >
              Cancel
            </div>
            <div
              onClick={() => void create()}
              className="h-8 px-3.5 flex items-center gap-2 rounded-rs bg-accent text-accent-ink cursor-pointer text-[12.5px] font-medium"
              style={{ opacity: busy ? 0.6 : 1 }}
            >
              Create <span className="font-mono text-[11px] opacity-75">↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

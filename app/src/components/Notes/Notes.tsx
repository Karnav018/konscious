// Notes: the active workspace's Today list and scratch pad, in place of the
// grid (sessions keep running behind it). Edits are a draft until Save (⌘S)
// or Discard; text goes into a session's prompt with ➜, never with Enter.
import { useEffect, useMemo, useRef, useState } from 'react'

import { discardNotesChanges, openTaskSession, saveNotes, sendTask, sendToPrompt } from '../../app/notes'
import { STATUS_COLOR } from '../../lib/format'
import { blocksOf, linkedSession, mentionName, ordered, todayLabel } from '../../lib/notes'
import { basename, shellLabel } from '../../lib/path'
import { IS_PC, IS_WINDOWS } from '../../lib/platform'
import { addTask, clearDone, currentNotes, deleteTask, setScratch, toggleTask } from '../../state/commands/notes'
import { useActiveLayout, useActiveWorkspace, useRuntimes, useSessions, useUi } from '../../state/selectors'
import { useApp } from '../../state/store'
import type { SessionMeta } from '../../types'
import { CheckIcon, CloseIcon, NotesIcon, SendIcon } from '../common/Icon'

// The scratch pad's geometry: the gutter arrows line up with its lines.
const LH = 22
const PAD = 14

const SAVE_KEY = IS_PC ? 'Ctrl+S' : '⌘S'
const isSaveKey = (e: KeyboardEvent) =>
  e.key.toLowerCase() === 's' && !e.shiftKey && !e.altKey && (IS_PC ? e.ctrlKey && !e.metaKey : e.metaKey && !e.ctrlKey)

const btn = 'h-7 px-3 flex items-center rounded-rs cursor-pointer text-[12.5px] whitespace-nowrap'

export function NotesView() {
  const ws = useActiveWorkspace()
  const wn = useApp((s) => (ws ? s.notes.byWorkspace[ws.id] : undefined))
  const sessions = useSessions()
  const runtimes = useRuntimes()
  const layout = useActiveLayout()
  const taskInput = useRef<HTMLInputElement>(null)

  // Typing goes to Notes now, not to the terminal that had focus.
  useEffect(() => {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    taskInput.current?.focus()
  }, [])

  const wsId = ws?.id
  useEffect(() => {
    if (!wsId) return
    const onKey = (e: KeyboardEvent) => {
      if (!isSaveKey(e)) return
      e.preventDefault()
      saveNotes(wsId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wsId])

  const mine = useMemo(
    () => Object.values(sessions).filter((m) => m.workspaceId === wsId).sort((a, b) => a.createdAt - b.createdAt),
    [sessions, wsId],
  )
  if (!ws) return null
  const notes = currentNotes(wn)
  const dirty = !!wn?.draft
  const running = mine.filter((m) => runtimes[m.id]?.running)
  const selected = mine.find((m) => m.id === layout.selected && runtimes[m.id]?.running) ?? null

  const saved = wn?.lastSaved
  const savedLabel = saved?.file ? `Saved to ${basename(saved.file)}` : saved ? 'Saved in Konscious' : 'Saved'
  const pref = wn?.pref
  const saveTip = pref ? `Save to ${pref.dest === 'app' ? 'Konscious' : `${pref.name}.md`} (${SAVE_KEY})` : `Choose where to save (${SAVE_KEY})`

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-pane border border-line rounded-r overflow-hidden" data-notes>
      <div className="h-11 flex-none flex items-center gap-2.5 px-4 border-b border-line">
        <NotesIcon className="flex-none" style={{ color: 'var(--accent)' }} />
        <span className="font-head font-semibold text-[14px]">Notes</span>
        <span className="font-mono text-[11px] px-[7px] py-px rounded-rs bg-sel text-muted max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis">
          {ws.name}
        </span>
        <div className="flex-1" />
        {dirty ? (
          <>
            <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--warn)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--warn)' }} />
              Unsaved changes
            </span>
            {pref && (
              <span onClick={() => saveNotes(ws.id, { saveAs: true })} className="text-[12px] text-muted cursor-pointer whitespace-nowrap hover:text-text">
                Save as…
              </span>
            )}
            <div onClick={() => discardNotesChanges(ws.id)} className={`${btn} border border-line2 text-muted hover:text-text hover:border-err`}>
              Discard
            </div>
            <div
              onClick={() => saveNotes(ws.id)}
              title={saveTip}
              className={`${btn} gap-2 font-medium hover:opacity-90`}
              style={{ background: 'var(--accent)', color: 'var(--accentInk)' }}
            >
              Save<span className="font-mono text-[10.5px] opacity-70">{SAVE_KEY}</span>
            </div>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-[11.5px] text-faint" title={saved?.file ?? undefined}>
            <CheckIcon size={12} />
            {savedLabel}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.25fr)' }}>
        <Today wsId={ws.id} wsName={ws.name} tasks={notes.tasks} sessions={mine} target={selected} inputRef={taskInput} />
        <Scratch wsId={ws.id} wsName={ws.name} scratch={notes.scratch} targets={running} />
      </div>
    </div>
  )
}

function Today({
  wsId,
  wsName,
  tasks,
  sessions,
  target,
  inputRef,
}: {
  wsId: string
  wsName: string
  tasks: ReturnType<typeof currentNotes>['tasks']
  sessions: SessionMeta[]
  target: SessionMeta | null
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [draft, setDraft] = useState('')
  const done = tasks.filter((t) => t.done).length
  const list = ordered(tasks)

  return (
    <div className="min-w-0 min-h-0 flex flex-col border-r border-line">
      <div className="flex-none px-[22px] pt-5 pb-3 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11.5px] font-semibold text-faint">Today</span>
            <span className="font-head text-[20px] font-semibold tracking-[-0.01em]">{todayLabel()}</span>
          </div>
          <span className="font-mono text-[11.5px] text-muted">{tasks.length ? `${done} of ${tasks.length} done` : ''}</span>
        </div>
        <div className="h-[3px] rounded-[2px] bg-sel overflow-hidden">
          <div
            className="h-full rounded-[2px] transition-[width] duration-[350ms]"
            style={{ width: tasks.length ? `${Math.round((done / tasks.length) * 100)}%` : '0%', background: 'var(--accent)' }}
          />
        </div>
        <div className="flex items-center gap-2 h-[38px] px-3 rounded-rs border border-line bg-win">
          <span className="text-faint text-[16px] leading-none">+</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              addTask(wsId, draft)
              setDraft('')
            }}
            placeholder="Add a task, press ↵"
            aria-label="Add a task"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13.5px] text-text"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3.5 pb-2.5 flex flex-col gap-px">
        {list.map((t) => {
          const tag = linkedSession(t, sessions)
          return (
            <div key={t.id} className="flex items-start gap-3 px-2 py-[9px] rounded-rs hover:bg-hover" data-task>
              <div
                role="checkbox"
                aria-checked={t.done}
                aria-label={t.done ? 'Mark not done' : 'Mark done'}
                onClick={() => toggleTask(wsId, t.id)}
                className="w-[17px] h-[17px] mt-px flex-none rounded-[4px] grid place-items-center cursor-pointer"
                style={{
                  border: `1.5px solid ${t.done ? 'var(--accent)' : 'var(--line2)'}`,
                  background: t.done ? 'var(--accent)' : 'transparent',
                  color: 'var(--accentInk)',
                }}
              >
                {t.done && <CheckIcon size={10} />}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <span
                  className="text-[13.5px] leading-[1.45] break-words select-text"
                  style={{ color: t.done ? 'var(--faint)' : 'var(--text)', textDecoration: t.done ? 'line-through' : 'none' }}
                >
                  {t.text}
                </span>
                {tag && (
                  <span
                    onClick={() => openTaskSession(tag.id)}
                    title="Open this session"
                    className="self-start font-mono text-[11px] cursor-pointer hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    @{mentionName(tag.name)}
                  </span>
                )}
              </div>
              {!t.done && target && (
                <div
                  onClick={() => sendTask(wsId, t.id, target.id)}
                  title={`Put in ${target.name}'s prompt`}
                  className="w-6 h-6 flex-none grid place-items-center rounded-rs text-faint cursor-pointer hover:bg-sel hover:text-accent"
                >
                  <SendIcon />
                </div>
              )}
              <div
                onClick={() => deleteTask(wsId, t.id)}
                title="Delete"
                className="w-6 h-6 flex-none grid place-items-center rounded-rs text-faint cursor-pointer hover:bg-sel hover:text-err"
              >
                <CloseIcon size={12} />
              </div>
            </div>
          )
        })}
        {!tasks.length && (
          <div className="px-4 py-8 text-center text-faint text-[13px] leading-[1.5]">
            Nothing planned for {wsName} yet.
            <br />
            Add what you want done today.
          </div>
        )}
      </div>

      <div className="h-[34px] flex-none flex items-center justify-end px-[22px] border-t border-line text-[11.5px]">
        {done > 0 && (
          <span onClick={() => clearDone(wsId)} className="cursor-pointer text-muted hover:text-text">
            Clear done
          </span>
        )}
      </div>
    </div>
  )
}

type Menu = { mode: 'sel' | number; text: string }

function Scratch({ wsId, wsName, scratch, targets }: { wsId: string; wsName: string; scratch: string; targets: SessionMeta[] }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [sel, setSel] = useState('')
  const [scroll, setScroll] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const blocks = useMemo(() => blocksOf(scratch), [scratch])
  const runtimes = useRuntimes()
  const shellName = useUi((u) => (IS_WINDOWS ? shellLabel(u.env?.shell) : (u.env?.shell ?? '/bin/zsh').split('/').pop()))

  // Another workspace's pad: nothing selected, no menu.
  useEffect(() => {
    setSel('')
    setMenu(null)
    setHover(null)
  }, [wsId])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setMenu(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menu])

  const readSel = () => {
    const t = area.current
    const v = t ? t.value.slice(t.selectionStart, t.selectionEnd) : ''
    if (v !== sel) setSel(v)
  }
  const selText = sel.trim()
  const selLines = selText ? selText.split('\n').length : 0
  const band = menu && typeof menu.mode === 'number' ? blocks[menu.mode] : hover != null ? blocks[hover] : undefined
  const lines = menu ? menu.text.split('\n') : []

  const pick = (sessionId: string) => {
    if (!menu) return
    sendToPrompt(sessionId, menu.text, 'lines')
    setMenu(null)
  }

  return (
    <div className="min-w-0 min-h-0 flex flex-col">
      <div className="flex-none px-[22px] pt-5 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[11.5px] font-semibold text-faint">Scratch</span>
          <span className="text-[12.5px] text-muted">
            {selText ? `${selLines} line${selLines === 1 ? '' : 's'} selected` : 'Use ➜ beside a block, or select any text.'}
          </span>
        </div>
        {selText && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu({ mode: 'sel', text: selText })}
            title="Put the selected text into a session's prompt"
            className="h-[30px] pl-[9px] pr-2.5 flex items-center gap-[7px] rounded-rs cursor-pointer text-[12.5px] font-medium whitespace-nowrap flex-none text-text"
            style={{ background: 'var(--accentSoft)' }}
          >
            <SendIcon style={{ color: 'var(--accent)' }} />
            Send selection<span className="text-[10px] text-muted">▾</span>
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        <div className="relative w-10 flex-none overflow-hidden">
          {blocks.map((b, i) => (
            <div
              key={`${b.start}-${i}`}
              onClick={() => setMenu({ mode: i, text: b.text })}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              title="Send this block to a session"
              aria-label={`Send block ${i + 1} to a session`}
              className="absolute left-3 w-[22px] h-[22px] grid place-items-center rounded-rs cursor-pointer hover:bg-sel hover:text-accent"
              style={{
                top: PAD + b.start * LH - scroll - 1,
                color: band === b ? 'var(--accent)' : 'var(--faint)',
                background: menu?.mode === i ? 'var(--sel)' : undefined,
              }}
            >
              <SendIcon size={12} />
            </div>
          ))}
        </div>
        <div className="relative flex-1 min-w-0 flex">
          {band && (
            <div
              className="absolute -left-1.5 right-3.5 rounded-[6px] pointer-events-none"
              style={{ top: PAD + band.start * LH - scroll, height: (band.end - band.start + 1) * LH, background: 'var(--accentSoft)' }}
            />
          )}
          <textarea
            ref={area}
            value={scratch}
            onChange={(e) => setScratch(wsId, e.target.value)}
            onSelect={readSel}
            onMouseUp={readSel}
            onKeyUp={readSel}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            wrap="off"
            spellCheck={false}
            aria-label="Scratch"
            placeholder="Start typing… blank lines split blocks"
            className="relative flex-1 min-w-0 resize-none border-0 outline-none bg-transparent font-mono text-[13px] text-text whitespace-pre overflow-auto select-text"
            style={{ lineHeight: `${LH}px`, padding: `${PAD}px 22px 22px 0` }}
          />
        </div>

        {menu && (
          <>
            <div onMouseDown={() => setMenu(null)} className="fixed inset-0 z-[8]" />
            <div
              className="absolute w-[260px] z-[9] p-1 bg-raised border border-line2 rounded-rs shadow-pop flex flex-col"
              role="menu"
              style={
                menu.mode === 'sel'
                  ? { top: -6, right: 22 }
                  : { top: PAD + (blocks[menu.mode]?.start ?? 0) * LH - scroll + 26, left: 40 }
              }
            >
              <div className="px-2.5 pt-2 pb-1.5 flex flex-col gap-0.5">
                <span className="text-[11.5px] font-semibold text-faint">{menu.mode === 'sel' ? 'Send selection to' : 'Send block to'}</span>
                <span className="font-mono text-[11px] text-muted whitespace-nowrap overflow-hidden text-ellipsis">
                  {lines[0].slice(0, 60)}
                  {lines.length > 1 ? `  +${lines.length - 1} more` : ''}
                </span>
              </div>
              {targets.map((m) => (
                <div
                  key={m.id}
                  role="menuitem"
                  onClick={() => pick(m.id)}
                  className="h-[34px] px-2.5 flex items-center gap-2.5 rounded-rs cursor-pointer hover:bg-sel"
                >
                  <span className="w-[7px] h-[7px] rounded-full flex-none" style={{ background: STATUS_COLOR[runtimes[m.id]?.status ?? 'idle'] }} />
                  <span className="flex-1 min-w-0 text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">{m.name}</span>
                  <span className="font-mono text-[10.5px] text-faint">{m.kind === 'shell' ? shellName : 'claude'}</span>
                </div>
              ))}
              {!targets.length && (
                <div className="px-2.5 pt-1 pb-2.5 text-[12px] text-muted leading-[1.45]">
                  No running sessions in {wsName}. Start one, then send this to it.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

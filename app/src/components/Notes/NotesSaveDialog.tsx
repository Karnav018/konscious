// "Save notes": kept in Konscious, a Markdown file in the project's notes/
// folder, or one in any folder. "Always save here" makes ⌘S save straight
// there next time (Save as… still asks).
import { commitNotesSave, pickNotesFolder } from '../../app/notes'
import { tildify } from '../../lib/format'
import { notesPath } from '../../lib/notes'
import { closeNotesSave, updateNotesSave } from '../../state/commands/notes'
import { useUi, useWorkspacesList } from '../../state/selectors'
import type { NotesDest } from '../../types'
import { CheckIcon } from '../common/Icon'

const OPTIONS: { dest: NotesDest; title: string; sub: string }[] = [
  { dest: 'app', title: 'Keep in Konscious', sub: 'Private to this computer. Not a file in your project.' },
  { dest: 'repo', title: 'Project folder', sub: 'A Markdown file next to your code.' },
  { dest: 'other', title: 'Another folder', sub: 'Any folder on this computer, e.g. your notes app’s folder.' },
]

export function NotesSaveDialog() {
  const d = useUi((u) => u.notesSave)
  const home = useUi((u) => u.init?.home)
  const ws = useWorkspacesList().find((w) => w.id === d?.workspaceId)
  if (!d || !ws) return null

  const pathOf = (dest: NotesDest) => notesPath(dest, { projectPath: ws.path, name: d.name, dir: d.dir })
  const isFile = d.dest !== 'app'
  const ready = !isFile || !!pathOf(d.dest)
  const choose = async () => {
    const dir = await pickNotesFolder(d.dir)
    if (dir) updateNotesSave({ dest: 'other', dir })
  }

  return (
    <div
      onMouseDown={closeNotesSave}
      className="absolute inset-0 bg-overlay grid place-items-center z-30"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-save-title"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[500px] max-w-[calc(100%-40px)] flex flex-col bg-raised border border-line2 rounded-r shadow-pop overflow-hidden"
      >
        <div className="px-[22px] pt-5 pb-1 flex flex-col gap-1">
          <span id="notes-save-title" className="font-head text-[16px] font-semibold">
            Save notes
          </span>
          <span className="text-muted text-[12.5px]">Where should {ws.name}’s notes go?</span>
        </div>

        <div className="px-[22px] py-3.5 flex flex-col gap-2">
          {OPTIONS.map((o) => {
            const on = d.dest === o.dest
            const path = pathOf(o.dest)
            return (
              <div
                key={o.dest}
                role="radio"
                aria-checked={on}
                onClick={() => updateNotesSave({ dest: o.dest })}
                className="flex items-start gap-3 px-3.5 py-3 rounded-rs border cursor-pointer hover:border-accent"
                style={{ borderColor: on ? 'var(--accent)' : 'var(--line2)', background: on ? 'var(--accentSoft)' : 'transparent' }}
              >
                <span
                  className="w-4 h-4 mt-0.5 flex-none rounded-full grid place-items-center"
                  style={{ border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line2)'}` }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: on ? 'var(--accent)' : 'transparent' }} />
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
                  <span className="text-[13px] font-semibold">{o.title}</span>
                  <span className="text-[12px] text-muted leading-[1.45]">{o.sub}</span>
                  {o.dest !== 'app' && (
                    <span className="font-mono text-[11.5px] text-text whitespace-nowrap overflow-hidden text-ellipsis" title={path ?? undefined}>
                      {path ? tildify(path, home) : 'No folder chosen yet'}
                    </span>
                  )}
                  {o.dest === 'repo' && (
                    <span className="text-[11.5px] leading-[1.45]" style={{ color: 'var(--warn)' }}>
                      Inside the repo — add notes/ to .gitignore if it shouldn’t be committed.
                    </span>
                  )}
                </div>
                {o.dest === 'other' && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      void choose()
                    }}
                    className="h-[26px] px-2.5 flex items-center rounded-rs border border-line2 text-[12px] text-muted flex-none cursor-pointer hover:text-text"
                  >
                    Choose…
                  </span>
                )}
              </div>
            )
          })}

          {isFile && (
            <label className="flex flex-col gap-1.5 mt-1.5">
              <span className="text-[12px] font-semibold text-muted">File name</span>
              <div className="flex items-center h-[34px] rounded-rs border border-line2 bg-win overflow-hidden">
                <input
                  value={d.name}
                  onChange={(e) => updateNotesSave({ name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && ready) void commitNotesSave(d)
                  }}
                  spellCheck={false}
                  aria-label="File name"
                  className="flex-1 min-w-0 h-full px-3 bg-transparent border-0 outline-none font-mono text-[12.5px] text-text"
                />
                <span className="px-3 font-mono text-[12.5px] text-faint border-l border-line">.md</span>
              </div>
            </label>
          )}

          <div
            role="checkbox"
            aria-checked={d.remember}
            onClick={() => updateNotesSave({ remember: !d.remember })}
            className="flex items-center gap-2.5 mt-1.5 cursor-pointer text-[12.5px]"
          >
            <span
              className="w-4 h-4 flex-none rounded-[4px] grid place-items-center"
              style={{
                border: `1.5px solid ${d.remember ? 'var(--accent)' : 'var(--line2)'}`,
                background: d.remember ? 'var(--accent)' : 'transparent',
                color: 'var(--accentInk)',
              }}
            >
              {d.remember && <CheckIcon size={10} />}
            </span>
            <span>Always save here for {ws.name}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-[22px] py-3 border-t border-line">
          <div
            onClick={closeNotesSave}
            className="h-8 px-3.5 flex items-center rounded-rs border border-line2 text-muted cursor-pointer hover:text-text"
          >
            Cancel
          </div>
          <button
            type="button"
            disabled={!ready}
            onClick={() => void commitNotesSave(d)}
            className="h-8 px-3.5 flex items-center rounded-rs border-0 font-medium"
            style={{
              background: ready ? 'var(--accent)' : 'var(--sel)',
              color: ready ? 'var(--accentInk)' : 'var(--faint)',
              cursor: ready ? 'pointer' : 'not-allowed',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

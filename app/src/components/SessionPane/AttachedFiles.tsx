// What was dropped or pasted into this pane, as chips above the terminal.
//
// A record, not a tray: the paths have already been typed into the pane, and
// the prompt belongs to Claude, so there is no per-file remove — taking one
// path back out of a line the app cannot read would be guesswork. Clear sends
// Ctrl+U, which genuinely empties the input (Ctrl+Y restores it in Claude).
import { useEffect, useState } from 'react'

import { fileKind, fileName } from '../../lib/attach'
import { ctrl } from '../../lib/platform'
import { ipc } from '../../lib/ipc'
import { terminals } from '../../lib/terminals'
import { clearAttachments } from '../../state/commands/ui'
import { useUi } from '../../state/selectors'
import { CloseIcon, FileIcon } from '../common/Icon'

/** Images are inlined by the engine, under a size cap; anything else gets a
 *  glyph. Null until it has been read, and null for good if it cannot be. */
function useThumbnail(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (fileKind(path) !== 'image') return
    let live = true
    void ipc.fileThumbnail(path).then((u) => live && setUrl(u)).catch(() => {})
    return () => {
      live = false
    }
  }, [path])
  return url
}

function Chip({ path }: { path: string }) {
  const url = useThumbnail(path)
  const name = fileName(path)
  const kind = fileKind(path)
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        void ipc.openFile(path).catch(() => {})
      }}
      title={`${path}\nClick to open`}
      className="h-7 max-w-[180px] flex-none flex items-center gap-1.5 pl-1 pr-2 rounded-rs border border-line2 bg-pane cursor-pointer hover:border-accent"
    >
      {url ? (
        <img src={url} alt="" className="w-5 h-5 rounded-[3px] object-cover flex-none" />
      ) : (
        <span
          className="w-5 h-5 grid place-items-center rounded-[3px] bg-sel flex-none text-faint"
          style={{ color: kind === 'pdf' ? 'var(--accent)' : undefined }}
        >
          <FileIcon size={11} />
        </span>
      )}
      <span className="text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">{name}</span>
    </div>
  )
}

export function AttachedFiles({ id }: { id: string }) {
  const paths = useUi((u) => u.attachments[id])
  if (!paths?.length) return null
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 right-0 bottom-0 flex items-center gap-1.5 px-2 py-1.5 border-t border-line bg-pane overflow-x-auto z-[2]"
    >
      {paths.map((p) => (
        <Chip key={p} path={p} />
      ))}
      <span className="flex-1 min-w-[8px]" />
      <div
        onClick={() => {
          terminals.clearInput(id)
          clearAttachments(id)
        }}
        title={`Clear the prompt (${ctrl('U')} — ${ctrl('Y')} puts it back)`}
        className="h-7 px-2 flex-none flex items-center gap-1 rounded-rs text-faint cursor-pointer hover:bg-hover hover:text-text text-[11.5px]"
      >
        <CloseIcon size={11} />
        Clear
      </div>
    </div>
  )
}

// Files dragged from Finder onto a pane: their paths are typed into that
// pane, the way Terminal does it — so Claude Code attaches a dropped image,
// and a shell gets the path to work on.
//
// Tauri takes file drops away from the page (dragDropEnabled), so they come
// in as Tauri events with a position, not as DOM drag events.
import { paneUnder } from '../components/SessionGrid/usePaneDrag'
import { ipc } from '../lib/ipc'
import { pathsForTerminal } from '../lib/paste'
import { requestStart, terminals } from '../lib/terminals'
import { attachFiles, setFileDrop } from '../state/commands/ui'
import { focusPane } from './actions'

export function startFileDrop() {
  return ipc.onFileDrop((e) => {
    if (e.type === 'leave') return setFileDrop(null)
    const id = paneUnder(e.x, e.y)
    if (e.type !== 'drop') return setFileDrop(id)
    setFileDrop(null)
    if (!id || !e.paths.length) return
    focusPane(id)
    requestStart(id)
    terminals.focus(id)
    terminals.paste(id, pathsForTerminal(e.paths))
    attachFiles(id, e.paths)
  })
}

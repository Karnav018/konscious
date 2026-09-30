import { tildify } from '../../lib/format'
import { CAP } from '../../lib/grid'
import {
  useActiveLayout,
  useActiveWorkspace,
  useClaudeSessionCount,
  useHasWorkspaces,
  useStatusCounts,
  useUi,
} from '../../state/selectors'

/** 26px status bar (design lines 301–304). CPU % is M2. */
export function StatusBar() {
  const ws = useActiveWorkspace()
  const layout = useActiveLayout()
  const counts = useStatusCounts()
  const home = useUi((u) => u.init?.home)
  const claudePath = useUi((u) => u.env?.claudePath)
  const persist = useUi((u) => u.persist)
  const claudeN = useClaudeSessionCount()
  const firstRun = !useHasWorkspaces()

  const left = firstRun || !ws ? `claude · ${claudePath ? tildify(claudePath, home) : 'not found yet'}` : `${ws.name} · ${tildify(ws.path, home)}`
  const right = firstRun
    ? 'no sessions'
    : `${layout.open.length}/${CAP} in grid · ${claudeN} Claude session${claudeN === 1 ? '' : 's'} · ${counts.working} working · ${counts.waiting} waiting`

  return (
    <div className="h-[26px] flex-none flex items-center justify-between gap-4 px-3.5 border-t border-line bg-side font-mono text-[10.5px] text-faint">
      <span className="whitespace-nowrap overflow-hidden text-ellipsis">{left}</span>
      {persist.state !== 'ok' && (
        <span
          className="whitespace-nowrap overflow-hidden text-ellipsis"
          style={{ color: persist.state === 'error' ? 'var(--err)' : 'var(--warn)' }}
          title={persist.message}
        >
          {persist.state === 'error' ? 'Saving failed — retrying' : 'Read-only: data is from a newer version'}
        </span>
      )}
      <span className="whitespace-nowrap">{right}</span>
    </div>
  )
}

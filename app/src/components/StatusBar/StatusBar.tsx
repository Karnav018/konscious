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
  // From the build (CARGO_PKG_VERSION), so it follows every release by itself.
  const version = useUi((u) => u.init?.version)
  const claudePath = useUi((u) => u.env?.claudePath)
  const persist = useUi((u) => u.persist)
  const claudeN = useClaudeSessionCount()
  const firstRun = !useHasWorkspaces()

  const left = firstRun || !ws ? `claude · ${claudePath ? tildify(claudePath, home) : 'not found yet'}` : `${ws.name} · ${tildify(ws.path, home)}`
  const right = firstRun
    ? 'no sessions'
    : `${layout.open.length}/${CAP} in grid · ${claudeN} Claude session${claudeN === 1 ? '' : 's'} · ${counts.working} working · ${counts.waiting} waiting`

  // Three equal columns keep the version centred whatever the sides say.
  return (
    <div className="h-5 flex-none grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-3.5 border-t border-line bg-side font-mono text-[10.5px] leading-none text-faint">
      <span className="whitespace-nowrap overflow-hidden text-ellipsis">{left}</span>
      <span className="flex items-center gap-4 whitespace-nowrap">
        {version && <span title="Konscious version">v{version}</span>}
        {persist.state !== 'ok' && (
          <span
            className="overflow-hidden text-ellipsis"
            style={{ color: persist.state === 'error' ? 'var(--err)' : 'var(--warn)' }}
            title={persist.message}
          >
            {persist.state === 'error' ? 'Saving failed — retrying' : 'Read-only: data is from a newer version'}
          </span>
        )}
      </span>
      <span className="whitespace-nowrap justify-self-end">{right}</span>
    </div>
  )
}

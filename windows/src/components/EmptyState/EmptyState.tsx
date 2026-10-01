import { kbd } from '../../lib/platform'
import { openNewSession } from '../../app/actions'
import { useActiveWorkspace } from '../../state/selectors'

/** No panes open in the active workspace (design lines 108–114). */
export function EmptyState() {
  const ws = useActiveWorkspace()
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-[380px]">
        <div className="font-head text-[20px] font-semibold">No panes open in {ws?.name ?? 'this workspace'}</div>
        <div className="text-muted leading-[1.5]">
          Hidden sessions keep running — closing a pane never stops Claude. Pick one from the workspace menu ({kbd('O')}), or
          start a new one.
        </div>
        <div
          onClick={() => void openNewSession()}
          className="h-8 px-3.5 flex items-center gap-2 rounded-rs bg-accent text-accent-ink cursor-pointer font-medium"
        >
          New session <span className="font-mono text-[11px] opacity-75">{kbd('N')}</span>
        </div>
      </div>
    </div>
  )
}

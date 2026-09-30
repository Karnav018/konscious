import { gridDims, visiblePanes } from '../../lib/grid'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { useActiveLayout } from '../../state/selectors'
import { SessionPane } from '../SessionPane/SessionPane'

export function SessionGrid() {
  const layout = useActiveLayout()
  const visible = visiblePanes(layout)
  const focus = layout.mode === 'focus'
  const { cols, rows } = gridDims(visible.length, focus)
  return (
    <div
      className="flex-1 min-h-0 grid gap-1"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {visible.map((id) => (
        <ErrorBoundary key={id} compact label={`pane ${id}`}>
          <SessionPane id={id} selected={id === layout.selected} multi={layout.open.length > 1} focused={focus} />
        </ErrorBoundary>
      ))}
    </div>
  )
}

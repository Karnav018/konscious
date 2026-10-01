import { movePaneOnto } from '../../app/actions'
import { gridDims, visiblePanes } from '../../lib/grid'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { useActiveLayout } from '../../state/selectors'
import { SessionPane } from '../SessionPane/SessionPane'
import { usePaneDrag } from './usePaneDrag'

export function SessionGrid() {
  const layout = useActiveLayout()
  const visible = visiblePanes(layout)
  const focus = layout.mode === 'focus'
  const { cols, rows } = gridDims(visible.length, focus)
  const { drag, handle } = usePaneDrag(movePaneOnto)
  // Nothing to reorder when one pane fills the stage.
  const reorderable = !focus && visible.length > 1
  return (
    <div
      className="flex-1 min-h-0 grid gap-1"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {visible.map((id, i) => (
        <ErrorBoundary key={id} compact label={`pane ${id}`}>
          <SessionPane
            id={id}
            selected={id === layout.selected}
            multi={layout.open.length > 1}
            focused={focus}
            reorder={
              reorderable
                ? {
                    handle: handle(id),
                    canLeft: i > 0,
                    canRight: i < visible.length - 1,
                    dragging: drag?.id === id,
                    dropTarget: drag?.over === id,
                  }
                : null
            }
          />
        </ErrorBoundary>
      ))}
    </div>
  )
}

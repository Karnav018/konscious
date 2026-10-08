// A small picture of a grid layout with these panes: the selected pane in
// the accent, terminals dim, sessions in between. Used by the dock tile, its
// menu, the nudge and the ⌘L overlay.
import { layRects, layTree, type Node } from '../../lib/layouts'
import type { GridLayoutId, Kind } from '../../types'

export function LayoutGlyph({
  id,
  kinds,
  selected,
  tree,
  width,
  height,
  border = 1.5,
}: {
  id: GridLayoutId
  kinds: readonly Kind[]
  /** Index of the selected pane, or -1. */
  selected: number
  /** The dragged arrangement, for the layout in use; else the layout's own. */
  tree?: Node
  width: number
  height: number
  border?: number
}) {
  const shape =
    tree ??
    layTree(
      id,
      kinds.map((k, i) => ({ i, terminal: k === 'shell' })),
    )
  const { rects } = kinds.length ? layRects(shape) : { rects: [] }
  const inset = border === 1.5 ? 1.5 : 1
  return (
    <span
      className="relative block flex-none"
      style={{ width, height, border: `${border}px solid currentColor`, borderRadius: 3 }}
    >
      {rects.map((r) => (
        <span
          key={r.i}
          className="absolute"
          style={{
            left: `calc(${r.x}% + ${inset}px)`,
            top: `calc(${r.y}% + ${inset}px)`,
            width: `calc(${r.w}% - ${inset * 2}px)`,
            height: `calc(${r.h}% - ${inset * 2}px)`,
            borderRadius: 1,
            background:
              r.i === selected
                ? 'var(--accent)'
                : kinds[r.i] === 'shell'
                  ? 'var(--line2)'
                  : 'color-mix(in srgb, currentColor 35%, transparent)',
          }}
        />
      ))}
    </span>
  )
}

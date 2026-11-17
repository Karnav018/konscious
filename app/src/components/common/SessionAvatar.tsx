// The session's pixel avatar (lib/avatar.ts), drawn crisp at any size.
import { useMemo } from 'react'

import { avatarOf } from '../../lib/avatar'

export function SessionAvatar({ name, size = 14 }: { name: string; size?: number }) {
  const { cells, hue } = useMemo(() => avatarOf(name), [name])
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 7 7"
      aria-hidden
      shapeRendering="crispEdges"
      className="flex-none rounded-[3px]"
      style={{ background: `var(--avBg${hue})` }}
    >
      <g fill={`var(--av${hue})`}>
        {cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1} height={1} />
        ))}
      </g>
    </svg>
  )
}

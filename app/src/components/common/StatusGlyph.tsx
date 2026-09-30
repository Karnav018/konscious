import { useEffect, useState } from 'react'

import { STATUS_COLOR } from '../../lib/format'
import type { Status } from '../../types'

// Claude's own spinner frames, as the design animates them (330ms each).
export const SPINNER_FRAMES = ['✻', '✳', '✢', '·', '✢', '✳'] as const

export function glyphFor(status: Status) {
  if (status === 'completed' || status === 'stopped') return '○'
  return '●'
}

/**
 * Working = a vertical strip of the six frames stepped with a CSS transform
 * animation (see .cw-spinner in globals.css). Transform animations run on
 * WebKit's compositor, so the spinner keeps turning even while the main
 * thread is busy with terminal output — and it costs no React re-renders.
 */
export function StatusGlyph({ status, className = '', size = 12 }: { status: Status; className?: string; size?: number }) {
  const style = { color: STATUS_COLOR[status], fontSize: size }
  if (status === 'working') {
    // Two px larger than the static dot: the spinner's thin frames (✢, ·)
    // read too small at the dot's size.
    return (
      <span className={`cw-spinner flex-none ${className}`} style={{ ...style, fontSize: size + 2 }} aria-label="Working" role="img">
        <span className="cw-spinner-strip" aria-hidden="true">
          {SPINNER_FRAMES.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </span>
      </span>
    )
  }
  return (
    <span className={`inline-block w-3 flex-none text-center leading-none ${className}`} style={style}>
      {glyphFor(status)}
    </span>
  )
}

/** Re-renders every `ms` for relative timestamps. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

// ⌘L's answer: the five layouts in the middle of the stage, the one now in
// use ringed, for a second — then it fades. Like switching apps on macOS.
import { useEffect, useState } from 'react'

import { GRID_LAYOUTS, layoutInfo, treeFor } from '../../lib/layouts'
import { IS_WINDOWS } from '../../lib/platform'
import { useActiveLayout, useSessions, useUi } from '../../state/selectors'
import { LayoutGlyph } from '../common/LayoutGlyph'

const SHOW_MS = 1100
const FADE_MS = 300

export function LayoutHud() {
  const bump = useUi((u) => u.layoutHud)
  const layout = useActiveLayout()
  const sessions = useSessions()
  const [phase, setPhase] = useState<'off' | 'on' | 'fading'>('off')

  useEffect(() => {
    if (!bump) return
    setPhase('on')
    const fade = setTimeout(() => setPhase('fading'), SHOW_MS)
    const off = setTimeout(() => setPhase('off'), SHOW_MS + FADE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(off)
    }
  }, [bump])

  if (phase === 'off') return null
  const kinds = layout.open.map((id) => sessions[id]?.kind ?? 'claude')
  const selected = layout.selected ? layout.open.indexOf(layout.selected) : -1
  const inUse = treeFor(layout.grid, kinds, layout.trees)
  return (
    <div
      className="absolute left-1/2 top-1/2 z-[45] pointer-events-none px-5 pt-4 pb-3.5 rounded-[14px] bg-raised border border-line2 shadow-pop flex flex-col items-center gap-3"
      style={{ transform: 'translate(-50%, -50%)', opacity: phase === 'on' ? 1 : 0, transition: 'opacity .25s' }}
      role="status"
    >
      <div className="flex gap-2.5">
        {GRID_LAYOUTS.map((g) => {
          const on = g.id === layout.grid
          return (
            <span
              key={g.id}
              className="p-[5px] rounded-[8px]"
              style={{
                boxShadow: `inset 0 0 0 ${on ? 2 : 0}px var(--accent)`,
                background: on ? 'var(--accentSoft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              <LayoutGlyph
                id={g.id}
                kinds={kinds}
                selected={selected}
                tree={on && inUse.dragged ? inUse.tree : undefined}
                width={44}
                height={30}
              />
            </span>
          )
        })}
      </div>
      <span className="text-[13px] font-medium">
        {layoutInfo(layout.grid).name}{' '}
        <span className="font-mono text-[11px] text-faint font-normal">
          {IS_WINDOWS ? '· Ctrl+Shift+L next' : '· ⌘L next · ⌘⇧L back'}
        </span>
      </span>
    </div>
  )
}

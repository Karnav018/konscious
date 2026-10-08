// Dragging a pane into another slot. The drag lives in React state here, not
// in the store: it changes with the pointer, and the action log and the saved
// layout should only ever see the move that was actually made.
//
// Pointer events (not HTML5 drag-and-drop): Tauri's own drag-drop handling
// swallows dragover in the webview, and pointer capture keeps the moves
// coming even once the cursor is over a terminal.
import { useCallback, useEffect, useRef, useState } from 'react'

// The two markers the pointer hit-test reads, with the props that write them
// — kept together so an attribute and its selector can never drift apart.
const PANE_SEL = '[data-pane-id]'
const NO_DRAG_SEL = '[data-no-drag]'
/** Spread on a pane's cell: maps a point on screen back to this pane. */
export const paneCell = (id: string) => ({ 'data-pane-id': id })
/** Spread on a header control: pressing it never begins a drag. */
export const noDrag = { 'data-no-drag': '' }
/** Under this many px the press is a click on the header, not a drag. */
const THRESHOLD = 4

export interface PaneDrag {
  id: string
  /** The pane whose slot the cursor is over, when dropping there would move
   *  anything. Kept while the cursor crosses a gap, so the preview holds still. */
  over: string | null
  /** How far the pointer has moved since the press (px): the pane follows it. */
  dx: number
  dy: number
}

/** Handlers to spread on a pane's drag surface (its header and grip). */
export type DragHandle = Pick<
  React.DOMAttributes<HTMLElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
>

/** What a pane needs to take part in reordering (null when it can't). */
export interface PaneReorder {
  handle: DragHandle
  /** A slot exists on that side, so "Move left"/"Move right" can be offered. */
  canLeft: boolean
  canRight: boolean
  dragging: boolean
}

/** The pane at a point on screen (CSS px). Also used by file drops. */
export function paneUnder(x: number, y: number): string | null {
  return document.elementFromPoint(x, y)?.closest(PANE_SEL)?.getAttribute('data-pane-id') ?? null
}

/**
 * `slotAt` says whose slot a point is in. The grid answers from the slots as
 * they were when the drag began, not from what's on screen: the panes slide
 * about while previewing the move, and asking them would flicker back and forth.
 */
export function usePaneDrag(onDrop: (id: string, targetId: string) => void, slotAt: (x: number, y: number) => string | null = paneUnder) {
  const [drag, setDrag] = useState<PaneDrag | null>(null)
  const press = useRef<{ id: string; x: number; y: number; moved: boolean; over: string | null } | null>(null)

  const stop = useCallback(() => {
    press.current = null
    setDrag(null)
  }, [])

  const handle = useCallback(
    (id: string): DragHandle => ({
      onPointerDown: (e) => {
        // Only the primary button, and never from a header control. No
        // preventDefault: the pane still needs the mousedown that selects it.
        if (e.button !== 0 || (e.target as Element).closest(NO_DRAG_SEL)) return
        press.current = { id, x: e.clientX, y: e.clientY, moved: false, over: null }
        e.currentTarget.setPointerCapture(e.pointerId)
      },
      onPointerMove: (e) => {
        const p = press.current
        if (!p) return
        if (!p.moved) {
          if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) < THRESHOLD) return
          p.moved = true
        }
        const under = slotAt(e.clientX, e.clientY)
        // Back over its own slot: no move. Over a gap: keep the last answer.
        if (under) p.over = under === p.id ? null : under
        setDrag({ id: p.id, over: p.over, dx: e.clientX - p.x, dy: e.clientY - p.y })
      },
      onPointerUp: () => {
        const p = press.current
        if (p?.moved && p.over) onDrop(p.id, p.over)
        stop()
      },
      onPointerCancel: stop,
    }),
    [onDrop, stop, slotAt],
  )

  // Escape drops the drag where it started; the cursor says "grabbing"
  // everywhere, not just over the header the pointer is captured by.
  const dragging = !!drag
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      stop()
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.cursor = prev
    }
  }, [dragging, stop])

  return { drag, handle }
}

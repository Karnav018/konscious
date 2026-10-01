// The app screenshot and pieces of it. Every picture on the site is the real
// app: the hero shows the whole window, feature rows show crops of it.
//
// The PNG was captured on a 2x display, so half its pixel size is the size
// the UI really is on screen; crops are capped there so they stay sharp.

export const shot = { src: '/app-window.png', width: 2578, height: 1784 }

/** A region of the screenshot, in its own pixels. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export function Window({ className = '' }: { className?: string }) {
  return (
    <img
      src={shot.src}
      width={shot.width}
      height={shot.height}
      alt="Konscious with five sessions in a grid: three Claude Code sessions working, idle and waiting, a research session and a terminal, with usage rings in the title bar."
      className={`block h-auto w-full ${className}`}
    />
  )
}

/**
 * One region of the screenshot, shrinking on narrow screens. `scale` is CSS
 * pixels per screenshot pixel: 0.5 is actual size; thin title-bar strips are
 * shown a little larger so their text stays readable.
 */
export function Crop({ region: r, label, scale = 0.5 }: { region: Region; label: string; scale?: number }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="w-full overflow-hidden rounded-r border border-line2"
      style={{
        maxWidth: Math.round(r.w * scale),
        aspectRatio: `${r.w} / ${r.h}`,
        backgroundImage: `url(${shot.src})`,
        backgroundSize: `${(shot.width / r.w) * 100}% auto`,
        backgroundPosition: `${(r.x / (shot.width - r.w)) * 100}% ${(r.y / (shot.height - r.h)) * 100}%`,
      }}
    />
  )
}

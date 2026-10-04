// Icons copied from the design's inline SVGs.
type P = { size?: number; className?: string; style?: React.CSSProperties }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const FolderIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M20 19a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
  </svg>
)

export const MoonIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
)

export const SunIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

/** Warm colours for late sessions. */
// Drawn 1.4 units low so the flame (y 2.8–18.4) is centred in its box.
export const FlameIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <g transform="translate(0 1.4)">
      <path d="M12 2.8c3 3.2 4.6 5.6 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-2.8 1.6-5.2 4.6-8.4Z" />
      <path d="M12 18.4a2 2 0 0 0 2-2c0-1.2-2-2.7-2-2.7s-2 1.5-2 2.7a2 2 0 0 0 2 2Z" />
    </g>
  </svg>
)

export const PlusIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2} {...p}>
    <path d="M5 12h14M12 5v14" />
  </svg>
)

export const DotsIcon = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </svg>
)

/** Drink water. Outlined when quiet; `fill` draws the level inside it. */
export const DropIcon = ({ size = 16, fill = 0, ...p }: P & { fill?: number }) => {
  const clip = `drop-${Math.round(fill * 100)}`
  return (
    <svg {...base(size)} strokeWidth={1.6} {...p}>
      <defs>
        <clipPath id={clip}>
          <rect x="0" y={24 - 24 * Math.max(0, Math.min(1, fill))} width="24" height="24" />
        </clipPath>
      </defs>
      <path d="M12 3.2c3 3.6 5 6 5 8.8a5 5 0 0 1-10 0c0-2.8 2-5.2 5-8.8Z" />
      {fill > 0 && (
        <path
          d="M12 3.2c3 3.6 5 6 5 8.8a5 5 0 0 1-10 0c0-2.8 2-5.2 5-8.8Z"
          fill="currentColor"
          stroke="none"
          clipPath={`url(#${clip})`}
        />
      )}
    </svg>
  )
}

/** Pomodoro. A tomato with its leaf, drawn rather than coloured red: the hue
 *  is violet because red belongs to a failed session. */
export const TomatoIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.6} {...p}>
    <path d="M12 6.4c3.4 0 5.8 2.5 5.8 5.9S15.4 20 12 20s-5.8-2.3-5.8-7.7S8.6 6.4 12 6.4Z" />
    <path d="M12 6.4V4.6M12 4.6c-1.5-1-3-.9-3.9-.5.3 1.2 1.3 2.1 2.6 2.3M12 4.6c1.5-1 3-.9 3.9-.5-.3 1.2-1.3 2.1-2.6 2.3" />
  </svg>
)

/** Stand up. */
export const StandIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.6} {...p}>
    <circle cx="12" cy="4.6" r="2.1" />
    <path d="M12 7v6M12 13l-3 7M12 13l3 7M8 9.4h8" />
  </svg>
)

/** The Apps entry in the dock: four outlined squares in app hues, so the
 *  catalog reads as the place the coloured things come from. Not an svg —
 *  the prototype builds it from four boxes, which keeps the 1.5px borders
 *  crisp at this size. */
export const AppsIcon = () => (
  <span style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 8px)', gap: 3, placeContent: 'center' }}>
    {['--water', '--stand', '--cpu', '--ram'].map((hue) => (
      <span
        key={hue}
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          border: `1.5px solid var(${hue})`,
          background: `color-mix(in srgb, var(${hue}) 22%, transparent)`,
        }}
      />
    ))}
  </span>
)

/** The same four squares in one colour, for a header or a list row. */
export const AppsOutlineIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.7} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
  </svg>
)


/** A dropped or pasted file that is not an image. */
export const FileIcon = ({ size = 12, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.6} {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </svg>
)

/** Drag handle — the pane can be moved to another slot in the grid. */
export const GripIcon = ({ size = 13, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <circle cx="9" cy="5" r="1.6" />
    <circle cx="15" cy="5" r="1.6" />
    <circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="19" r="1.6" />
    <circle cx="15" cy="19" r="1.6" />
  </svg>
)

export const MaximizeIcon = ({ size = 13, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
)

export const MinimizeIcon = ({ size = 13, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
)

export const NotesIcon = ({ size = 15, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.6} {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </svg>
)

/** ➜ — put this into a session's prompt. */
export const SendIcon = ({ size = 13, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.6} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const CloseIcon = ({ size = 13, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const TerminalIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.6} {...p}>
    <path d="m5 7 5 5-5 5" />
    <path d="M13 17h6" />
  </svg>
)

export const TrashIcon = ({ size = 13, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
)

export const CheckIcon = ({ size = 13, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.5} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const DownloadIcon = ({ size = 13, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.7} {...p}>
    <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
  </svg>
)

export const SettingsIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const StopIcon = ({ size = 12, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2} {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

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
export const FlameIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={1.5} {...p}>
    <path d="M12 2.8c3 3.2 4.6 5.6 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-2.8 1.6-5.2 4.6-8.4Z" />
    <path d="M12 18.4a2 2 0 0 0 2-2c0-1.2-2-2.7-2-2.7s-2 1.5-2 2.7a2 2 0 0 0 2 2Z" />
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

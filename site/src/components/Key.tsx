import type { ReactNode } from 'react'

/** A keyboard shortcut, drawn like a key cap. */
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-block rounded-rs border border-line2 bg-surface px-1.5 py-px font-ui text-[0.88em] leading-snug text-text">
      {children}
    </kbd>
  )
}

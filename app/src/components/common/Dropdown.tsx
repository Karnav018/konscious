// Select-style dropdown in the design's input language (34px field on --pane,
// list on --raised). Keyboard: ↑/↓ move, Enter/Space choose, Esc closes.
import { type ReactNode, useEffect, useRef, useState } from 'react'

export interface DropdownOption<V extends string> {
  value: V
  label: string
  detail?: string
  icon?: ReactNode
}

export function Dropdown<V extends string>({
  options,
  value,
  onChange,
  placeholder = 'Select…',
}: {
  options: DropdownOption<V>[]
  value: V
  onChange: (v: V) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  const choose = (i: number) => {
    const o = options[i]
    if (o) onChange(o.value)
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, options.length - 1))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter' || e.key === ' ') choose(active)
    else if (e.key === 'Escape') {
      e.stopPropagation() // close the list, not the whole modal
      setOpen(false)
    } else return
    e.preventDefault()
  }

  return (
    <div ref={root} className="relative min-w-0">
      <div
        role="combobox"
        aria-expanded={open}
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className="h-[30px] px-[10px] flex items-center gap-2 rounded-rs border bg-pane cursor-pointer outline-none min-w-0 hover:border-line2 focus:border-accent"
        style={{ borderColor: open ? 'var(--accent)' : 'var(--line2)' }}
      >
        {current?.icon}
        <span className="flex-1 min-w-0 text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
          {current?.label ?? <span className="text-faint">{placeholder}</span>}
        </span>
        <span className="text-[10px] text-muted flex-none">▾</span>
      </div>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[34px] z-10 max-h-[240px] overflow-auto p-1 bg-raised border border-line2 rounded-rs shadow-pop flex flex-col gap-px"
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className="px-2 py-1.5 flex items-center gap-2 rounded-rs cursor-pointer"
              style={{ background: i === active ? 'var(--sel)' : 'transparent' }}
            >
              {o.icon}
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{o.label}</span>
                {o.detail && (
                  <span className="font-mono text-[10.5px] text-faint whitespace-nowrap overflow-hidden text-ellipsis">{o.detail}</span>
                )}
              </div>
              {o.value === value && <span className="text-accent text-[11px] flex-none">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The design's segmented control (`seg()`): raised active item on a --sel track.
interface Option<V extends string> {
  value: V
  label: React.ReactNode
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  stretch = false,
  itemClass = 'h-[26px] px-3 text-[12.5px] font-medium',
}: {
  options: Option<V>[]
  value: V
  onChange: (v: V) => void
  stretch?: boolean
  itemClass?: string
}) {
  return (
    <div className="flex gap-[2px] p-[2px] bg-sel rounded-rs">
      {options.map((o) => {
        const on = o.value === value
        return (
          <div
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`${itemClass} ${stretch ? 'flex-1 justify-center min-w-0' : ''} flex items-center rounded-rs cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis`}
            style={{
              background: on ? 'var(--raised)' : 'transparent',
              color: on ? 'var(--text)' : 'var(--muted)',
              boxShadow: on ? 'var(--segShadow)' : 'none',
            }}
          >
            {o.label}
          </div>
        )
      })}
    </div>
  )
}

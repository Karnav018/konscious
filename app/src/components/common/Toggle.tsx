// An on/off switch. A real <button role="switch"> so it works from the
// keyboard and reads as a switch to assistive tech.
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative w-[30px] h-[18px] flex-none rounded-pill border cursor-pointer transition-colors duration-150"
      style={{ background: on ? 'var(--accent)' : 'var(--sel)', borderColor: on ? 'var(--accent)' : 'var(--line2)' }}
    >
      <span
        className="absolute top-[2px] left-[2px] w-3 h-3 rounded-full transition-transform duration-150"
        style={{
          background: on ? 'var(--accentInk)' : 'var(--muted)',
          transform: on ? 'translateX(12px)' : 'translateX(0)',
        }}
      />
    </button>
  )
}

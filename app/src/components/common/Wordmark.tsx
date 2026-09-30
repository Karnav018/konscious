// The Kova wordmark: "k", an accent ring for the "o", "va" (design: title bar
// at 17px, first-run hero at 40px). Sized in em so the ring always sits on the
// baseline at x-height, whatever the font size.
export function Wordmark({ size = 17, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Kova"
      title="Kova"
      className={`inline-flex items-baseline font-head font-bold leading-none text-text ${className}`}
      style={{ fontSize: size, letterSpacing: '-0.04em' }}
    >
      <span aria-hidden="true">k</span>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: '0.53em',
          height: '0.53em',
          borderRadius: '50%',
          border: '0.13em solid var(--accent)',
          margin: '0 0.06em 0 0.07em',
        }}
      />
      <span aria-hidden="true">va</span>
    </span>
  )
}

// Same mark as the app (app/src/components/common/Wordmark.tsx): "k", an
// accent ring for each "o", the letters between. Sized in em so it scales
// with font size.
const ring: React.CSSProperties = {
  display: 'inline-block',
  width: '0.53em',
  height: '0.53em',
  borderRadius: '50%',
  border: '0.13em solid var(--accent)',
  margin: '0 0.06em 0 0.07em',
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="Konscious"
      className="inline-flex items-baseline font-head font-bold leading-none text-text"
      style={{ fontSize: size, letterSpacing: '-0.04em' }}
    >
      <span aria-hidden="true">k</span>
      <span aria-hidden="true" style={ring} />
      <span aria-hidden="true">nsci</span>
      <span aria-hidden="true" style={ring} />
      <span aria-hidden="true">us</span>
    </span>
  )
}

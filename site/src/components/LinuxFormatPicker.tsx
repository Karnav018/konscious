import { setLinuxFormat, useLinuxFormat } from '../linuxFormat'
import { LINUX_FORMATS, type LinuxFormat } from '../release'

/**
 * Which Linux package the download buttons give. A native select, so it works
 * with a keyboard, a screen reader and a phone's own picker; sized to sit
 * beside a download button.
 */
export function LinuxFormatPicker() {
  const format = useLinuxFormat()
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Linux package</span>
      <select
        value={format}
        onChange={(e) => setLinuxFormat(e.target.value as LinuxFormat)}
        className="cursor-pointer appearance-none rounded-pill border border-line2 bg-surface py-3 pr-10 pl-4 text-[17px] font-medium text-text hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {LINUX_FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <svg aria-hidden="true" viewBox="0 0 12 12" className="pointer-events-none absolute right-4 h-3 w-3 text-muted">
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  )
}

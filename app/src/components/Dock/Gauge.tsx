// The System stats gauge at the top of the dock.
//
// It cycles through what this machine reports every 5 seconds — movement
// without a state change, which is why it holds still while a session is
// waiting for you, and why one stat can be picked to stop it. Dim under 30%,
// its own hue normally, and --hot at 80% or more: magenta rather than amber or
// red, so a loaded machine never reads as a session waiting or failed.
import { useEffect, useState } from 'react'

import { gaugeFill, type MetricKey, METRICS, metricTone } from '../../lib/apps'
import { availableMetrics, shownMetric, statDetail, statValue, useStats } from '../../lib/stats'
import { pinStat, setAppPanel } from '../../state/commands/apps'
import { useUi } from '../../state/selectors'

const CYCLE_MS = 5000

/** The gauge: a ring around the metric's own icon, filled to its reading.
 *  Rotated so it starts at twelve o'clock. */
/** A ring filled to `fill` (0–1) with whatever sits in the middle. Shared, so
 *  there is one piece of circle maths: the gauge puts a stat in it, the
 *  pomodoro puts its tomato in it. Rotated to start at twelve o'clock. */
export function Ring({
  fill,
  colour,
  size,
  children,
}: {
  fill: number
  colour: string
  size: number
  children?: React.ReactNode
}) {
  const r = 10
  const circumference = 2 * Math.PI * r
  const drawn = circumference * Math.max(0, Math.min(1, fill))
  return (
    <div style={{ position: 'relative', width: size, height: size, color: colour }} className="grid place-items-center">
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--line2)" strokeWidth="2.2" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray={`${drawn.toFixed(1)} ${circumference.toFixed(1)}`}
          style={{ transition: 'stroke-dasharray .6s ease, stroke .6s' }}
        />
      </svg>
      {children}
    </div>
  )
}

function MetricRing({ metric, value, size }: { metric: MetricKey | null; value: number | null; size: number }) {
  const fill = metric && value !== null ? gaugeFill(metric, value) : 0
  const colour = metric && value !== null ? toneColor(metric, value) : 'var(--faint)'
  const met = metric ? METRICS.find((m) => m.key === metric)! : null
  return (
    <div className="flex flex-col items-center gap-[2px]">
      <Ring fill={fill} colour={colour} size={size}>
        {metric && <MetricIcon metric={metric} />}
      </Ring>
      <span
        className="font-mono text-[10px] leading-none tabular-nums"
        style={{ color: metric && value !== null && metricTone(metric, value) === 'hot' ? colour : 'var(--text)' }}
      >
        {value === null ? '—' : `${Math.round(value)}${met?.key === 'tmp' ? '°' : '%'}`}
      </span>
    </div>
  )
}

/** A chip, memory sticks, a drive and a thermometer — one per stat, so the
 *  gauge says what it is measuring without a word. */
function MetricIcon({ metric }: { metric: MetricKey }) {
  const paths: Record<MetricKey, React.ReactNode> = {
    cpu: (
      <>
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
        <path d="M10 3.5v3.5M14 3.5v3.5M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" />
      </>
    ),
    ram: (
      <>
        <rect x="3" y="7" width="18" height="10" rx="1.5" />
        <path d="M7.5 11v2M12 11v2M16.5 11v2M6 17v2.5M10 17v2.5M14 17v2.5M18 17v2.5" />
      </>
    ),
    ssd: (
      <>
        <rect x="4" y="4.5" width="16" height="15" rx="2" />
        <circle cx="8.5" cy="15" r="1" />
        <path d="M8 9h8" />
      </>
    ),
    tmp: (
      <>
        <path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z" />
        <path d="M12 9v6.5" />
      </>
    ),
  }
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ position: 'relative' }}
    >
      {paths[metric]}
    </svg>
  )
}

function toneColor(key: MetricKey, value: number): string {
  const hue = METRICS.find((m) => m.key === key)!.hue
  const tone = metricTone(key, value)
  if (tone === 'hot') return 'var(--hot)'
  // Idle is the hue stepped toward muted: dim, not absent.
  return tone === 'quiet' ? `color-mix(in srgb, ${hue} 60%, var(--muted))` : hue
}

export function Gauge({ width, height, waiting }: { width: number; height: number; waiting: boolean }) {
  const stats = useStats()
  const pinned = useUi((u) => u.apps.statPinned)
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState(false)

  // Cycling pauses while a session wants you: the dock must not pull your eye
  // at the moment something else already has a claim on it.
  useEffect(() => {
    if (waiting || pinned || open) return
    const t = setInterval(() => setTick((n) => n + 1), CYCLE_MS)
    return () => clearInterval(t)
  }, [waiting, pinned, open])

  const have = availableMetrics(stats)
  const key = shownMetric(have, tick, pinned)
  const value = stats && key ? statValue(key, stats) : null
  const met = key ? METRICS.find((m) => m.key === key)! : null
  const tone = key && value !== null ? metricTone(key, value) : 'quiet'
  const hue = key && value !== null ? toneColor(key, value) : 'var(--faint)'

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        title={met && value !== null ? `${met.label} ${Math.round(value)}${key === 'tmp' ? '°C' : '%'}` : 'System stats'}
        style={{
          width,
          height,
          borderRadius: 7,
          borderColor: open ? hue : 'transparent',
          background: tone === 'hot' ? 'color-mix(in srgb, var(--hot) 16%, transparent)' : 'transparent',
        }}
        className="grid place-items-center cursor-pointer hover:bg-sel"
      >
        <MetricRing metric={key} value={value} size={26} />
      </div>

      {open && stats && (
        <div
          data-dock-popover
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: width + 14, top: -6, width: 250, boxShadow: 'var(--shadow)' }}
          className="p-2.5 bg-raised border border-line2 rounded-r z-[40] flex flex-col gap-2"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium">This Mac</span>
            <span className="font-mono text-[10px] text-faint">updates every 4 s</span>
          </div>
          {METRICS.map((m) => {
            const v = statValue(m.key, stats)
            const c = v === null ? 'var(--faint)' : toneColor(m.key, v)
            const on = pinned === m.key
            return (
              <div
                key={m.key}
                onClick={() => pinStat(on ? null : m.key)}
                title={on ? 'Resume cycling' : `Hold the gauge on ${m.label}`}
                className="flex flex-col gap-1 px-1.5 py-1 rounded-rs cursor-pointer hover:bg-hover"
                style={{ background: on ? 'var(--sel)' : undefined }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px]">{m.label}</span>
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: c }}>
                    {v === null ? 'not reported' : m.key === 'tmp' ? `${Math.round(v)}°C` : `${Math.round(v)}%`}
                  </span>
                </div>
                <div className="w-full h-[3px] rounded-[2px] overflow-hidden" style={{ background: 'var(--line)' }}>
                  <div style={{ width: `${(v === null ? 0 : gaugeFill(m.key, v)) * 100}%`, height: '100%', background: c }} />
                </div>
                <span className="text-[10.5px] text-faint">{statDetail(m.key, stats)}</span>
              </div>
            )
          })}
          <div
            onClick={() => setAppPanel('sys')}
            className="h-7 flex items-center justify-center rounded-rs border border-line2 cursor-pointer text-[12px] text-muted hover:text-text hover:border-accent"
          >
            Settings
          </div>
        </div>
      )}
    </div>
  )
}

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

const toneColor = (key: MetricKey, value: number): string =>
  metricTone(key, value) === 'hot' ? 'var(--hot)' : METRICS.find((m) => m.key === key)!.hue

export function Gauge({ size, waiting }: { size: number; waiting: boolean }) {
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
  const fill = key && value !== null ? gaugeFill(key, value) : 0
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
          width: size,
          height: size,
          opacity: tone === 'quiet' ? 0.6 : 1,
          borderColor: open ? hue : 'transparent',
          background: tone === 'hot' ? 'color-mix(in srgb, var(--pane) 70%, transparent)' : 'transparent',
        }}
        className="grid place-items-center rounded-rs border cursor-pointer hover:bg-hover"
      >
        {/* A square gauge: a bar that fills from the bottom, under the label. */}
        <div className="flex flex-col items-center gap-[3px] w-full px-1">
          <span className="font-mono text-[8.5px] tracking-[0.04em]" style={{ color: hue }}>
            {met?.short ?? '—'}
          </span>
          <div className="w-full h-[4px] rounded-[2px] overflow-hidden" style={{ background: 'var(--line)' }}>
            <div style={{ width: `${fill * 100}%`, height: '100%', background: hue, transition: 'width 400ms ease' }} />
          </div>
          <span className="font-mono text-[9px] tabular-nums" style={{ color: hue }}>
            {value === null ? '—' : key === 'tmp' ? `${Math.round(value)}°` : `${Math.round(value)}`}
          </span>
        </div>
      </div>

      {open && stats && (
        <div
          data-dock-popover
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: size + 14, top: -6, width: 250, boxShadow: 'var(--shadow)' }}
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

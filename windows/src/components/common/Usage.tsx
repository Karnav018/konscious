// Context-window ring (pane header) and plan-usage bar (title bar), from the
// design. Data: Claude's status-line feed (see claude/hooks.rs).
import { flash } from '../../state/commands/ui'
import { clock, resetsIn, tokens, usageColor } from '../../lib/format'
import type { ContextUsage, Limits } from '../../types'

const CIRC = 37.7 // 2π · r(6)

/** The design's 16px progress ring (track + rounded arc, 12 o'clock start). */
export function Ring({ pct, color }: { pct: number | null; color: string }) {
  const dash = pct == null ? 0 : (Math.max(0, Math.min(100, pct)) / 100) * CIRC
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="flex-none" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--line2)" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${dash.toFixed(1)} ${CIRC}`}
        style={{ transition: 'stroke-dasharray .4s' }}
      />
    </svg>
  )
}

export function ContextRing({ ctx }: { ctx: ContextUsage | null }) {
  const pct = ctx?.pct == null ? null : Math.round(ctx.pct)
  const color = pct == null ? 'var(--line2)' : pct >= 85 ? 'var(--err)' : pct >= 65 ? 'var(--warn)' : 'var(--accent)'
  const tip =
    pct == null
      ? 'Context window · updates after Claude’s first response'
      : `Context window · ${pct}% used (${tokens(ctx?.used)} / ${tokens(ctx?.size)})`
  return (
    <div title={tip} className="flex items-center gap-[5px] flex-none px-1">
      <Ring pct={pct} color={color} />
      <span className="font-mono text-[11px] text-muted">{pct == null ? '—' : `${pct}%`}</span>
    </div>
  )
}

/** Model badge for a Claude pane ("Opus 5.5"), from the status feed. */
export function ModelBadge({ model }: { model: string | null | undefined }) {
  if (!model) return null
  return (
    <span
      title={`Model · ${model}`}
      className="font-mono text-[10.5px] px-1.5 py-px rounded-rs bg-sel text-muted flex-none whitespace-nowrap"
    >
      {model}
    </span>
  )
}

/**
 * 5h / 7d plan usage. Always visible: "—" until Claude reports usage (it
 * does after a reply); the last known values are kept across restarts and
 * shown faded until a live update arrives. A window whose reset time has
 * passed shows "—" rather than a number that is no longer true.
 */
export function UsageBar({
  limits,
  observedAt,
  live,
  now = Date.now(),
}: {
  limits: Limits | null
  observedAt: number | null
  live: boolean
  now?: number
}) {
  const since = observedAt ? ` · as of ${clock(observedAt)}` : ''
  const pending = 'updates after Claude’s next reply'
  const windows = [
    { label: '5h', name: '5-hour limit', w: limits?.fiveHour ?? null },
    { label: '7d', name: 'Weekly limit', w: limits?.sevenDay ?? null },
  ]
  return (
    <div
      onClick={() => flash(live ? 'Usage reported by Claude CLI · /usage for details' : `Plan usage ${pending}`)}
      title={`Claude plan usage limits${live ? '' : since ? `${since} — ${pending}` : ` — ${pending}`}`}
      className="h-7 flex items-center gap-3 px-1 cursor-pointer flex-none"
      style={{ opacity: live ? 1 : 0.7 }}
    >
      {windows.map(({ label, name, w }) => {
        const expired = !!w?.resetsAt && w.resetsAt * 1000 <= now
        const pct = w && !expired ? Math.max(0, Math.min(100, w.pct)) : null
        const tip =
          pct == null
            ? `${name} · ${expired ? 'reset since last update' : 'not reported yet'} — ${pending}`
            : `${name} · ${Math.round(pct)}% used · ${resetsIn(w!.resetsAt, now)}${live ? '' : since}`
        return (
          <div key={label} className="flex items-center gap-[6px]" title={tip}>
            <span className="font-mono text-[11px] text-muted">{label}</span>
            <Ring pct={pct} color={pct == null ? 'var(--line2)' : usageColor(pct)} />
            <span className="font-mono text-[11px] text-text min-w-7">{pct == null ? '—' : `${Math.round(pct)}%`}</span>
          </div>
        )
      })}
    </div>
  )
}

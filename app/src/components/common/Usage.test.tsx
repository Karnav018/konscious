// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContextRing, ModelBadge, UsageBar } from './Usage'

describe('usage widgets', () => {
  afterEach(cleanup)

  it('ring shows percent, token tooltip and design thresholds', () => {
    const { container } = render(<ContextRing ctx={{ id: 's', pct: 79.4, used: 794_000, size: 1_000_000, model: 'Opus 5.5' }} />)
    expect(container.textContent).toBe('79%')
    expect(container.firstElementChild?.getAttribute('title')).toBe('Context window · 79% used (794k / 1M)')
    const arc = container.querySelectorAll('circle')[1]
    expect(arc.getAttribute('stroke')).toBe('var(--warn)') // ≥65 amber
    expect(arc.getAttribute('stroke-dasharray')).toBe('29.8 37.7')
  })

  it('ring waits quietly before the first response', () => {
    const { container } = render(<ContextRing ctx={null} />)
    expect(container.textContent).toBe('—')
  })

  it('usage shows 5h and 7d as rings with threshold colors', () => {
    const { container } = render(
      <UsageBar limits={{ fiveHour: { pct: 11, resetsAt: null }, sevenDay: { pct: 88, resetsAt: null } }} observedAt={1} live />,
    )
    expect(container.textContent).toBe('5h11%7d88%')
    const arcs = [...container.querySelectorAll('svg')].map((s) => s.querySelectorAll('circle')[1])
    expect(arcs.map((a) => a.getAttribute('stroke'))).toEqual(['var(--ok)', 'var(--err)'])
    expect(arcs[0].getAttribute('stroke-dasharray')).toBe('4.1 37.7')
  })

  it('is always visible: placeholders before data, "—" for windows that already reset', () => {
    const empty = render(<UsageBar limits={null} observedAt={null} live={false} />)
    expect(empty.container.textContent).toBe('5h—7d—')
    cleanup()
    const now = 2_000_000_000_000
    const stale = render(
      <UsageBar
        limits={{ fiveHour: { pct: 40, resetsAt: now / 1000 - 60 }, sevenDay: { pct: 38, resetsAt: now / 1000 + 86400 * 3 } }}
        observedAt={now - 3_600_000}
        live={false}
        now={now}
      />,
    )
    expect(stale.container.textContent).toBe('5h—7d38%')
    expect((stale.container.firstElementChild as HTMLElement).style.opacity).toBe('0.7')
  })

  it('model badge shows the current model, hidden until known', () => {
    expect(render(<ModelBadge model="Opus 5.5" />).container.textContent).toBe('Opus 5.5')
    cleanup()
    expect(render(<ModelBadge model={null} />).container.innerHTML).toBe('')
  })
})

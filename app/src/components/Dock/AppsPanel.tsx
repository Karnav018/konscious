// The Apps panel: a built-in catalog, opened from the dock or with ⌘⇧A.
//
// A catalog, not a marketplace — the first release doesn't promise one. Every
// app carries a source line and a list of what it can do, which is where a
// publisher and a permission model would go later. We fill those in rather
// than redesign around them.
import { useEffect, useMemo, useRef, useState } from 'react'

import { toggleWarm } from '../../app/actions'

import {
  APPS,
  appById,
  type AppCategory,
  type AppId,
  BREAK_CHOICES,
  FOCUS_CHOICES,
  isReminder,
  isVertical,
} from '../../lib/apps'
import { askNotifyOnce } from '../../app/reminders'
import { isWarm } from '../../lib/warmth'
import { WarmthRow } from '../Settings/Settings'
import {
  resetPomoRounds,
  setAppOn,
  setAppPanel,
  setAppPinned,
  setAutoMinimise,
  setEvery,
  setPomoLength,
  setSnoozeMin,
} from '../../state/commands/apps'
import { useUi } from '../../state/selectors'
import { getState } from '../../state/store'
import { AppsIcon, AppsOutlineIcon, CloseIcon, DropIcon, FlameIcon, StandIcon, TomatoIcon } from '../common/Icon'

type Filter = 'All' | 'On' | 'Off'
const CATEGORIES: AppCategory[] = ['Reminders', 'Timers', 'Display', 'System']

function Glyph({ id, size = 17 }: { id: AppId; size?: number }) {
  if (id === 'water') return <DropIcon size={size} fill={0.55} />
  if (id === 'stand') return <StandIcon size={size} />
  if (id === 'pomo') return <TomatoIcon size={size} />
  if (id === 'warm') return <FlameIcon size={size} />
  return <AppsOutlineIcon size={size - 1} />
}

function Switch({ on, hue, onClick }: { on: boolean; hue: string; onClick: () => void }) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={on ? 'Turn off' : 'Turn on'}
      style={{ width: 34, height: 20, background: on ? hue : 'var(--line2)' }}
      className="flex-none rounded-pill cursor-pointer relative transition-colors"
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 16 : 2,
          width: 16,
          height: 16,
          background: on ? 'var(--accentInk)' : 'var(--faint)',
          transition: 'left 120ms ease',
        }}
        className="rounded-pill"
      />
    </div>
  )
}

/** A row of choices, which is how every length in here is set. */
function Choices({ value, options, hue, unit, onPick }: { value: number; options: readonly number[]; hue: string; unit: string; onPick: (n: number) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((n) => (
        <div
          key={n}
          onClick={() => onPick(n)}
          style={{ borderColor: value === n ? hue : 'var(--line2)', color: value === n ? hue : 'var(--muted)' }}
          className="h-7 px-2.5 flex items-center rounded-rs border cursor-pointer font-mono text-[11.5px] tabular-nums"
        >
          {n}
          <span className="font-ui text-[10px] ml-0.5 opacity-70">{unit}</span>
        </div>
      ))}
    </div>
  )
}

/** The On/Off word beside an app's name. */
function AppState({ id, hue }: { id: AppId; hue: string }) {
  const on = useAppOn(id)
  return (
    <span className="text-[10.5px]" style={{ color: on ? hue : 'var(--faint)' }}>
      {on ? 'On' : 'Off'}
    </span>
  )
}

function AppSwitch({ id, hue }: { id: AppId; hue: string }) {
  const on = useAppOn(id)
  return <Switch on={on} hue={hue} onClick={() => void turnOn(id, !on)} />
}

function Settings({ id }: { id: AppId }) {
  const app = appById(id)
  const apps = useUi((u) => u.apps)
  const label = 'text-[11px] text-faint'
  // The same component the Settings popover uses, not a copy of it: one
  // slider and one schedule, wherever you reach them from.
  if (id === 'warm') {
    return (
      <div className="flex flex-col gap-2">
        <WarmthRow />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {isReminder(app) && (id === 'water' || id === 'stand') && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className={label}>Remind me every</span>
            <Choices
              value={apps.every[id]}
              options={[20, 30, 40, 50, 60]}
              hue={app.hue}
              unit="min"
              onPick={(n) => setEvery(id, n)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={label}>“In 10 min” holds it for</span>
            <Choices value={apps.snoozeMin} options={[5, 10, 15]} hue={app.hue} unit="min" onPick={setSnoozeMin} />
          </div>
        </>
      )}

      {id === 'pomo' && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className={label}>Focus for</span>
            <Choices
              value={apps.pomoSet.focusMin}
              options={FOCUS_CHOICES}
              hue={app.hue}
              unit="min"
              onPick={(n) => setPomoLength('focusMin', n)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={label}>Then break for</span>
            <Choices
              value={apps.pomoSet.breakMin}
              options={BREAK_CHOICES}
              hue={app.hue}
              unit="min"
              onPick={(n) => setPomoLength('breakMin', n)}
            />
          </div>
          {apps.pomo.rounds > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] flex-1">{apps.pomo.rounds} stretches done</span>
              <div
                onClick={resetPomoRounds}
                className="h-7 px-2.5 flex items-center rounded-rs border border-line2 cursor-pointer text-[11.5px] text-muted hover:text-text"
              >
                Reset
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 flex flex-col">
          <span className="text-[12px]">Show in the dock</span>
          <span className="text-[11px] text-muted">Hiding it here doesn’t turn the app off.</span>
        </div>
        <Switch on={apps.pinned[id]} hue={app.hue} onClick={() => setAppPinned(id, !apps.pinned[id])} />
      </div>

      <div className="h-px bg-line" />
      <div
        onClick={() => setAppOn(id, false)}
        className="h-8 flex items-center justify-center rounded-rs border cursor-pointer text-[12.5px]"
        style={{ borderColor: 'var(--line2)', color: 'var(--err)' }}
      >
        Turn off {app.name}
      </div>
    </div>
  )
}

function Detail({ id }: { id: AppId }) {
  const app = appById(id)
  const on = useAppOn(id)
  const [tab, setTab] = useState<'about' | 'settings'>('about')
  const tabCls = (active: boolean) =>
    `h-8 px-[10px] flex items-center text-[12.5px] font-medium cursor-pointer border-b-2 -mb-px ${
      active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
    }`
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div
        onClick={() => setAppPanel('catalog')}
        className="px-4 pt-3 pb-1 text-[12px] text-muted cursor-pointer hover:text-text w-fit"
      >
        ‹ Apps
      </div>
      <div className="px-4 pb-3 flex items-start gap-3">
        <span
          style={{ color: app.hue, width: 38, height: 38, borderColor: app.hue }}
          className="grid place-items-center rounded-rs border flex-none"
        >
          <Glyph id={id} size={20} />
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-[14px] font-semibold">{app.name}</span>
          <span className="font-mono text-[10.5px] text-faint">Built into Konscious · v1.0</span>
        </div>
        <Switch on={on} hue={app.hue} onClick={() => void turnOn(id, !on)} />
      </div>
      <div className="flex items-center gap-[2px] px-3 border-b border-line">
        <div className={tabCls(tab === 'about')} onClick={() => setTab('about')}>
          About
        </div>
        <div className={tabCls(tab === 'settings')} onClick={() => setTab('settings')}>
          Settings
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {tab === 'about' ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[12.5px] text-muted leading-[1.55]">{app.long}</p>
            <div className="flex flex-col gap-2">
              <span className="text-[11px] text-faint">How it works</span>
              {app.steps.map((step, i) => (
                <div key={step} className="flex gap-2.5">
                  <span className="font-mono text-[10.5px] text-faint flex-none pt-[2px]">{i + 1}</span>
                  <span className="text-[12.5px] leading-[1.5]">{step}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-faint">What this app can do</span>
              {app.can.map((c) => (
                <div key={c} className="flex gap-2 items-baseline">
                  <span style={{ color: app.hue }} className="text-[11px]">
                    ·
                  </span>
                  <span className="text-[12.5px]">{c}</span>
                </div>
              ))}
              <span className="text-[11.5px] text-muted mt-1 leading-[1.45]">
                It never reads your sessions, files or Claude settings.
              </span>
            </div>
          </div>
        ) : (
          <Settings id={id} />
        )}
      </div>
    </div>
  )
}

/** Turning an app on is the one moment we ask about notifications. Warm
 *  colours is the exception twice over: its switch is the warmth setting
 *  itself, and it has nothing to notify about. */
async function turnOn(id: AppId, on: boolean) {
  setAppOn(id, on)
  // Warm colours has no nudge to notify about; switching the app on is also
  // what applies the warmth, so the dock, the catalog and the title-bar flame
  // all still mean the same thing.
  if (id === 'warm') {
    const warmNow = getState().ui.warm && isWarm(getState().ui.warmth)
    if (warmNow !== on) toggleWarm()
    return
  }
  if (on) await askNotifyOnce()
}

/** Whether an app is on, reading warmth from where warmth actually lives. */
function useAppOn(id: AppId): boolean {
  return useUi((u) => u.apps.on[id])
}

export function AppsPanel() {
  const panel = useUi((u) => u.appPanel)
  const apps = useUi((u) => u.apps)
  const allowed = useUi((u) => u.notifyAllowed)
  const [q, setQ] = useState('')
  const [filt, setFilt] = useState<Filter>('All')
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (panel === 'catalog') requestAnimationFrame(() => search.current?.focus())
  }, [panel])

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const isOn = (id: AppId) => apps.on[id]
    return APPS.filter((a) => {
      if (filt === 'On' && !isOn(a.id)) return false
      if (filt === 'Off' && isOn(a.id)) return false
      if (!needle) return true
      return (
        a.name.toLowerCase().includes(needle) ||
        a.desc.toLowerCase().includes(needle) ||
        a.tags.some((t) => t.includes(needle))
      )
    })
  }, [q, filt, apps.on])

  if (panel === null) return null
  const detail = panel !== 'catalog' ? panel : null

  return (
    <div onMouseDown={() => setAppPanel(null)} className="absolute inset-0 z-[30]">
      <div
        data-apps-panel
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          // Centred on the dock's side, sized to its contents. The prototype
          // pins it top and bottom, but that is inside a small window mock —
          // stretched down a real window it is mostly empty.
          ...(isVertical(apps.edge)
            ? { top: '50%', transform: 'translateY(-50%)', [apps.edge === 'left' ? 'left' : 'right']: 8 + 42 }
            : { left: '50%', transform: 'translateX(-50%)', [apps.edge === 'top' ? 'top' : 'bottom']: 8 + 42 }),
          maxHeight: 'calc(100% - 32px)',
          width: 'min(360px, calc(100% - 72px))',
          boxShadow: 'var(--shadow)',
        }}
        className="bg-raised border border-line2 rounded-r flex flex-col overflow-hidden"
      >
        {detail ? (
          <Detail id={detail} />
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 h-11 border-b border-line flex-none">
              <AppsIcon />
              <span className="text-[13px] font-semibold flex-1">Apps</span>
              <span className="font-mono text-[10.5px] text-faint">⌘⇧A</span>
              <div
                onClick={() => setAppPanel(null)}
                className="w-6 h-6 grid place-items-center rounded-rs text-faint cursor-pointer hover:bg-hover hover:text-text"
              >
                <CloseIcon size={12} />
              </div>
            </div>

            <div className="p-3 flex flex-col gap-2 flex-none">
              <input
                ref={search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search apps"
                id="apps-search"
                className="h-8 px-2.5 rounded-rs bg-pane border border-line text-[12.5px] outline-none focus:border-accent"
              />
              <div className="flex gap-1">
                {(['All', 'On', 'Off'] as Filter[]).map((f) => (
                  <div
                    key={f}
                    onClick={() => setFilt(f)}
                    style={{
                      borderColor: filt === f ? 'var(--accent)' : 'var(--line2)',
                      color: filt === f ? 'var(--accent)' : 'var(--muted)',
                    }}
                    className="h-7 px-2.5 flex items-center rounded-rs border cursor-pointer text-[11.5px]"
                  >
                    {f}
                  </div>
                ))}
              </div>
            </div>

            {!allowed && (
              <div className="mx-3 mb-3 p-2.5 rounded-rs border border-line2 bg-pane flex flex-col gap-1 flex-none">
                <span className="text-[12px] font-medium">Notifications are off for Konscious</span>
                <span className="text-[11.5px] text-muted leading-[1.45]">
                  Reminders still work, but only in the dock. You’ll miss them while Konscious is behind another
                  window.
                </span>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto px-3 pb-3 flex flex-col gap-4">
              {CATEGORIES.map((cat) => {
                const inCat = matches.filter((a) => a.category === cat)
                if (!inCat.length) return null
                return (
                  <div key={cat} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] text-faint">{cat}</span>
                      <span className="font-mono text-[10px] text-faint">{inCat.length}</span>
                    </div>
                    {inCat.map((a) => (
                      <div
                        key={a.id}
                        onClick={() => setAppPanel(a.id)}
                        className="flex items-start gap-2.5 p-2 rounded-rs cursor-pointer hover:bg-hover"
                      >
                        <span
                          style={{ color: a.hue, width: 30, height: 30, borderColor: 'var(--line)' }}
                          className="grid place-items-center rounded-rs border flex-none"
                        >
                          <Glyph id={a.id} />
                        </span>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[12.5px] font-medium">{a.name}</span>
                            <AppState id={a.id} hue={a.hue} />
                          </div>
                          <span className="text-[11.5px] text-muted leading-[1.4]">{a.desc}</span>
                        </div>
                        <AppSwitch id={a.id} hue={a.hue} />
                      </div>
                    ))}
                  </div>
                )
              })}
              {!matches.length && (
                <div className="flex flex-col gap-1 items-center text-center py-8 px-4">
                  <span className="text-[12.5px]">Nothing matches “{q}”</span>
                  <span className="text-[11.5px] text-muted leading-[1.45]">
                    Konscious ships with five apps for now. More will follow, and they’ll appear here when they’re
                    ready.
                  </span>
                </div>
              )}

              <div className="h-px bg-line" />
              <div className="flex items-center gap-2 pb-1">
                <div className="flex-1 flex flex-col">
                  <span className="text-[12px]">Tuck the dock away</span>
                  <span className="text-[11px] text-muted leading-[1.4]">
                    Shrinks to the Apps icon when you’re not using it. A due reminder still shows.
                  </span>
                </div>
                <Switch on={apps.autoMinimise} hue="var(--accent)" onClick={() => setAutoMinimise(!apps.autoMinimise)} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

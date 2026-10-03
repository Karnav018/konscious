// Settings: one popover with every setting, plus a title-bar button for the
// feature that landed most recently (lib/features picks it from `since`).
//
// To add a setting: give it a row component and an entry in FEATURES with the
// release it ships in. If it is the newest, it takes over the title-bar button
// on its own and the previous one stays here in Settings.
import { useEffect, useState } from 'react'

import {
  setTheme,
  setWarmHours,
  setWarmPlace,
  setWarmthPercent,
  setWarmWhen,
  toggleWarm,
  warmWindow,
} from '../../app/actions'
import { byNewest, type Landed, newest } from '../../lib/features'
import { clock } from '../../lib/format'
import { isPlace, localPlace, localZone } from '../../lib/sun'
import { isWarm, percentAt, type WarmWhen } from '../../lib/warmth'
import { toggleSettingsMenu } from '../../state/commands/ui'
import { useUi } from '../../state/selectors'
import { FlameIcon, MoonIcon, SettingsIcon, SunIcon } from '../common/Icon'
import { Segmented } from '../common/Segmented'
import { Toggle } from '../common/Toggle'

interface Feature extends Landed {
  title: string
  /** The setting's controls, as Settings shows them. */
  Row: () => React.JSX.Element
  /** Its title-bar button (shown only while it is the newest feature).
   *  Drawn at TITLE_ICON_PX unless the glyph needs another size to look as
   *  big as the gear next to it. */
  Icon: (p: { size?: number }) => React.JSX.Element
  iconSize?: number
  /** Lights the title-bar button while the feature is on. */
  useOn: () => boolean
}

const label = 'flex-1 text-[12.5px] font-medium'
const hint = 'text-[11px] text-muted leading-[1.4]'

const useWarmOn = () => useUi((u) => u.warm && isWarm(u.warmth))

/** "20:00" ⇄ minutes from midnight, which is how the schedule stores them. */
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const fromHhmm = (text: string, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return fallback
  const mins = Number(m[1]) * 60 + Number(m[2])
  return mins >= 0 && mins <= 1439 ? mins : fallback
}

/** When the warmth applies: always, between hours, or sunset to sunrise. */
function WarmScheduleRow() {
  const when = useUi((u) => u.warmWhen)
  const from = useUi((u) => u.warmFrom)
  const to = useUi((u) => u.warmTo)
  const place = useUi((u) => u.warmPlace)
  const on = useWarmOn()
  const [coords, setCoords] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const window = warmWindow(now)
  const zone = localZone()
  const here = place ?? localPlace(now)
  const choice = (v: WarmWhen, label: string) => (
    <div
      key={v}
      onClick={() => setWarmWhen(v)}
      style={{
        borderColor: when === v ? 'var(--accent)' : 'var(--line2)',
        color: when === v ? 'var(--accent)' : 'var(--muted)',
      }}
      className="h-7 px-2.5 flex items-center rounded-rs border cursor-pointer text-[11.5px]"
    >
      {label}
    </div>
  )
  const timeBox =
    'w-[62px] h-7 px-2 rounded-rs bg-pane border border-line text-[12px] font-mono tabular-nums outline-none focus:border-accent'

  return (
    <div className="flex flex-col gap-2" style={{ opacity: on ? 1 : 0.55 }}>
      <span className={label}>When</span>
      <div className="flex gap-1">
        {choice('always', 'All day')}
        {choice('hours', 'Hours')}
        {choice('sun', 'Sunset')}
      </div>

      {when === 'hours' && (
        <div className="flex items-center gap-2">
          <input
            id="warm-from"
            defaultValue={hhmm(from)}
            onBlur={(e) => setWarmHours(fromHhmm(e.target.value, from), to)}
            className={timeBox}
            aria-label="Warm from"
          />
          <span className="text-[11.5px] text-faint">to</span>
          <input
            id="warm-to"
            defaultValue={hhmm(to)}
            onBlur={(e) => setWarmHours(from, fromHhmm(e.target.value, to))}
            className={timeBox}
            aria-label="Warm until"
          />
        </div>
      )}

      {when === 'sun' && (
        <div className="flex flex-col gap-1.5">
          {window ? (
            <span className="font-mono text-[11px] text-muted tabular-nums">
              sunset {clock(window.onAt)} · sunrise {clock(window.offAt)}
            </span>
          ) : (
            <span className="text-[11.5px] text-muted leading-[1.4]">
              The sun doesn’t set here today, so the warmth stays as the switch leaves it.
            </span>
          )}
          {coords ? (
            <div className="flex items-center gap-1.5">
              <input
                id="warm-lat"
                defaultValue={here.lat.toFixed(2)}
                onBlur={(e) => {
                  const next = { lat: Number(e.target.value), lon: here.lon }
                  if (isPlace(next)) setWarmPlace(next)
                }}
                className={timeBox}
                aria-label="Latitude"
              />
              <input
                id="warm-lon"
                defaultValue={here.lon.toFixed(2)}
                onBlur={(e) => {
                  const next = { lat: here.lat, lon: Number(e.target.value) }
                  if (isPlace(next)) setWarmPlace(next)
                }}
                className={timeBox}
                aria-label="Longitude"
              />
              {place && (
                <span
                  onClick={() => {
                    setWarmPlace(null)
                    setCoords(false)
                  }}
                  className="text-[11px] text-accent cursor-pointer"
                >
                  Use my timezone
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-faint">
                {place ? `${here.lat.toFixed(1)}°, ${here.lon.toFixed(1)}°` : `estimated from ${zone}`}
              </span>
              <span onClick={() => setCoords(true)} className="text-[11px] text-accent cursor-pointer">
                Exact coordinates
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WarmthRow() {
  const warmth = useUi((u) => u.warmth)
  const on = useWarmOn()
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={label}>Warm colours</span>
        <Toggle on={on} onChange={() => toggleWarm()} label="Warm colours" />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percentAt(warmth)}
        onChange={(e) => setWarmthPercent(Number(e.target.value))}
        aria-label="How warm"
        className="w-full cursor-pointer"
        style={{ accentColor: 'var(--accent)' }}
      />
      <div className="flex items-center justify-between font-mono text-[10.5px] text-faint">
        <span>Neutral</span>
        <span style={{ color: on ? 'var(--accent)' : 'var(--faint)' }}>{warmth}K</span>
        <span>Amber</span>
      </div>
      <div className={hint}>Warms this window only, not the screen. Status colours stay true.</div>
      <WarmScheduleRow />
    </>
  )
}

function ThemeRow() {
  const theme = useUi((u) => u.theme)
  return (
    <div className="flex items-center gap-2">
      <span className={label}>Appearance</span>
      <Segmented
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        value={theme}
        onChange={setTheme}
        itemClass="h-[24px] px-2.5 text-[12px] font-medium"
      />
    </div>
  )
}

const ThemeIcon = ({ size }: { size?: number }) => {
  const theme = useUi((u) => u.theme)
  return theme === 'dark' ? <MoonIcon size={size} /> : <SunIcon size={size} />
}

export const FEATURES: Feature[] = [
  // The flame is narrow and short in its box; 18px reads as tall as the gear.
  { id: 'warmth', since: '0.2.0', title: 'Warm colours', Row: WarmthRow, Icon: FlameIcon, iconSize: 18, useOn: useWarmOn },
  { id: 'theme', since: '0.1.0', title: 'Appearance', Row: ThemeRow, Icon: ThemeIcon, useOn: () => false },
]

const latest = newest(FEATURES)

const popover =
  'absolute top-[42px] right-[10px] w-[268px] bg-raised border border-line2 rounded-rs shadow-pop z-[25] flex flex-col'

/** Every setting, newest first; the newest is marked "New". */
export function SettingsMenu() {
  return (
    <div data-settings-menu className={popover}>
      <div className="px-3 pt-2.5 pb-1.5 font-head text-[11.5px] text-faint font-semibold">Settings</div>
      {byNewest(FEATURES).map((f) => (
        <div key={f.id} className="px-3 py-2.5 border-t border-line flex flex-col gap-2 relative">
          {f === latest && (
            <span className="absolute top-[11px] right-[52px] px-1.5 rounded-pill bg-accent-soft text-accent text-[10px] font-medium leading-[16px]">
              New
            </span>
          )}
          <f.Row />
        </div>
      ))}
    </div>
  )
}

/** The newest feature's own popover, opened from its title-bar button. */
export function QuickMenu() {
  if (!latest) return null
  return (
    <div data-settings-menu className={popover}>
      <div className="px-3 py-2.5 flex flex-col gap-2">
        <latest.Row />
      </div>
      <div
        onClick={() => toggleSettingsMenu('all')}
        className="px-3 py-2 border-t border-line text-[12px] text-muted cursor-pointer hover:text-text hover:bg-hover rounded-b-rs"
      >
        All settings…
      </div>
    </div>
  )
}

/** Title-bar glyph size: the gear's (it fills its box edge to edge). */
const TITLE_ICON_PX = 15
const iconButton = 'w-7 h-7 grid place-items-center rounded-rs cursor-pointer hover:bg-hover hover:text-text'

/** Title bar: the newest feature's button, then Settings. */
export function SettingsButtons() {
  const open = useUi((u) => u.settingsMenu)
  const on = latest?.useOn() ?? false
  return (
    <>
      {latest && (
        <div
          data-settings-button
          onClick={() => toggleSettingsMenu('quick')}
          title={`${latest.title} — new in ${latest.since}`}
          className={iconButton}
          style={{ color: on || open === 'quick' ? 'var(--accent)' : 'var(--muted)' }}
        >
          <latest.Icon size={latest.iconSize ?? TITLE_ICON_PX} />
        </div>
      )}
      <div
        data-settings-button
        onClick={() => toggleSettingsMenu('all')}
        title="Settings"
        className={iconButton}
        style={{ color: open === 'all' ? 'var(--accent)' : 'var(--muted)' }}
      >
        <SettingsIcon size={TITLE_ICON_PX} />
      </div>
    </>
  )
}

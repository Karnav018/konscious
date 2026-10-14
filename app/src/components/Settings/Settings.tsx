// Settings: a sheet in the middle of the window, with search and grouped rows
// that each open a page; plus a title-bar button for the feature that landed
// most recently (lib/features picks it from `since`), which opens the sheet
// straight on that feature's page.
//
// To add a setting: give it a page component and an entry in FEATURES with the
// release it ships in and the group it sits in. If it is the newest, it takes
// over the title-bar button on its own.
import { useEffect, useRef, useState } from 'react'

import {
  setAccent,
  setPalette,
  setTerminalFont,
  setTerminalSize,
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
import { accentOf, PALETTES, paletteById, statusColors, TERM_FONTS, TERM_SIZES, termFont, type TermFontId } from '../../lib/themes'
import { isWarm, percentAt, type WarmWhen } from '../../lib/warmth'
import { closeSettingsMenu, toggleSettingsMenu } from '../../state/commands/ui'
import { useUi } from '../../state/selectors'
import { CheckIcon, ChevronIcon, CloseIcon, FlameIcon, PaletteIcon, SearchIcon, SettingsIcon, TerminalIcon } from '../common/Icon'
import { Segmented } from '../common/Segmented'
import { Toggle } from '../common/Toggle'

type Group = 'Appearance' | 'Comfort'

interface Feature extends Landed {
  title: string
  group: Group
  /** Extra words search should find it by. */
  keywords: string
  /** Its page lays out its own Sections; otherwise it sits in one card. */
  sections?: boolean
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
// The sheet keeps its own round corners whatever the theme's radius.
const card = 'bg-raised border border-line rounded-[12px] overflow-hidden'
const groupLabel = 'px-1 text-[11px] font-semibold text-faint uppercase tracking-[0.04em]'
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

export function WarmthRow() {
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

/** A titled group on a settings page, like the groups on the list. */
function Section({ title, children, pad = true }: { title?: string; children: React.ReactNode; pad?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {title && <span className={groupLabel}>{title}</span>}
      <div className={`${card} ${pad ? 'p-3.5 flex flex-col gap-3' : ''}`}>{children}</div>
    </div>
  )
}

/** Eight themes, each drawn as a tiny window in the mode in force: its
 *  window, a pane edged in the accent, two lines of text and a status dot. */
function ThemeRow() {
  const mode = useUi((u) => u.theme)
  const current = useUi((u) => u.palette)
  const accents = useUi((u) => u.accents)
  const p = paletteById(current)
  const picked = accents[p.id] ?? 0
  return (
    <>
      <Section>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[13.5px]">Appearance</span>
          <Segmented
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={mode}
            onChange={setTheme}
            itemClass="h-[26px] px-3 text-[12.5px] font-medium"
          />
        </div>
      </Section>
      <Section title="Theme">
        <div className="grid grid-cols-4 gap-x-2.5 gap-y-3">
          {PALETTES.map((t) => {
            const b = t[mode]
            const on = t.id === p.id
            const a = accentOf(t, accents[t.id])[mode]
            return (
              <div key={t.id} onClick={() => void setPalette(t.id)} title={t.desc} className="flex flex-col gap-1.5 cursor-pointer min-w-0">
                <div
                  className="aspect-[16/11] p-[6px] flex gap-[5px] rounded-[10px]"
                  style={{
                    background: b.win,
                    boxShadow: on ? `0 0 0 2px var(--raised), 0 0 0 3.5px var(--accent)` : `inset 0 0 0 1px ${b.line2}`,
                  }}
                >
                  <div
                    className="flex-1 flex flex-col justify-end gap-[4px] p-[6px] rounded-[6px]"
                    style={{ background: b.pane, boxShadow: `inset 0 0 0 1px ${a}` }}
                  >
                    <span className="block h-[3px] w-3/4 rounded-full" style={{ background: b.text }} />
                    <span className="block h-[3px] w-1/2 rounded-full" style={{ background: b.faint }} />
                  </div>
                  <div className="w-[12px] flex flex-col gap-[4px]">
                    <span className="block h-[7px] rounded-full" style={{ background: statusColors(t, mode).ok }} />
                    <span className="block flex-1 rounded-[4px]" style={{ background: b.raised }} />
                  </div>
                </div>
                <span
                  className="text-center text-[11.5px] leading-tight truncate"
                  style={{ color: on ? 'var(--text)' : 'var(--muted)', fontWeight: on ? 600 : 400 }}
                >
                  {t.name}
                </span>
              </div>
            )
          })}
        </div>
      </Section>
      <Section title="Accent">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {p.accents.map((a, i) => (
              <div
                key={a.name}
                onClick={() => void setAccent(p.id, i)}
                title={a.name}
                className="w-[26px] h-[26px] p-[4px] rounded-pill cursor-pointer"
                style={{ boxShadow: i === picked ? 'inset 0 0 0 1.5px var(--text)' : 'none' }}
              >
                <span className="block w-full h-full rounded-pill" style={{ background: a[mode] }} />
              </div>
            ))}
          </div>
          <span className="text-[13px] text-muted">{accentOf(p, picked).name}</span>
        </div>
      </Section>
    </>
  )
}

/** The panes' font and base size, apart from the theme's interface font. */
function TerminalFontRow() {
  const font = useUi((u) => u.termFont)
  const size = useUi((u) => u.fontSize)
  const themeFont = useUi((u) => termFont(paletteById(u.palette), 'theme'))
  return (
    <>
      <Section title="Font" pad={false}>
        {TERM_FONTS.map((f, i) => {
          const on = f.id === font
          return (
            <div
              key={f.id}
              onClick={() => void setTerminalFont(f.id as TermFontId)}
              className="h-[40px] flex items-center gap-3 pl-3.5 cursor-pointer hover:bg-hover"
            >
              <div className={`flex-1 self-stretch flex items-center gap-3 pr-3.5 ${i === TERM_FONTS.length - 1 ? '' : 'border-b border-line'}`}>
                <span className="w-[120px] text-[13.5px] whitespace-nowrap" style={{ fontFamily: `${f.family ?? themeFont}, monospace` }}>
                  {'{} => 0O1lI'}
                </span>
                <span className="flex-1 text-[13px] truncate" style={{ color: on ? 'var(--text)' : 'var(--muted)', fontWeight: on ? 600 : 400 }}>
                  {f.name}
                </span>
                {on && <CheckIcon size={14} className="text-accent" />}
              </div>
            </div>
          )
        })}
      </Section>
      <Section>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[13.5px]">Size</span>
          <Segmented
            options={TERM_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            value={String(size)}
            onChange={(v) => setTerminalSize(Number(v))}
            itemClass="h-[26px] px-2.5 text-[12px] font-mono"
          />
        </div>
      </Section>
      <div className={`${hint} px-1`}>
        Every pane: transcripts, diffs, the prompt and the shell. A pane you sized by hand keeps its own size.
      </div>
    </>
  )
}

export const FEATURES: Feature[] = [
  // The flame is narrow and short in its box; 18px reads as tall as the gear.
  { id: 'warmth', since: '0.2.0', title: 'Warm colours', group: 'Comfort', keywords: 'night amber temperature schedule sunset', Row: WarmthRow, Icon: FlameIcon, iconSize: 18, useOn: useWarmOn },
  // Appearance (dark or light) since 0.1.0; themes and accents since 0.3.4.
  { id: 'theme', since: '0.3.4', title: 'Theme', group: 'Appearance', keywords: 'dark light mode colour color accent palette appearance', sections: true, Row: ThemeRow, Icon: PaletteIcon, useOn: () => false },
  { id: 'termFont', since: '0.3.4', title: 'Terminal font', group: 'Appearance', keywords: 'mono size typeface pane', sections: true, Row: TerminalFontRow, Icon: TerminalIcon, useOn: () => false },
]

const latest = newest(FEATURES)

const GROUPS: Group[] = ['Appearance', 'Comfort']

const matches = (f: Feature, q: string) => `${f.title} ${f.group} ${f.keywords}`.toLowerCase().includes(q)

/** One row of a group: icon, title, "New" for the newest, chevron. */
function FeatureRow({ f, last, onOpen }: { f: Feature; last: boolean; onOpen: () => void }) {
  return (
    <div onClick={onOpen} className="h-[44px] flex items-center gap-3 pl-3.5 cursor-pointer hover:bg-hover">
      <span className="w-5 grid place-items-center text-muted flex-none">
        <f.Icon size={17} />
      </span>
      <div className={`flex-1 self-stretch flex items-center gap-2 pr-3 ${last ? '' : 'border-b border-line'}`}>
        <span className="flex-1 text-[13.5px]">{f.title}</span>
        {f === latest && (
          <span className="px-1.5 rounded-pill bg-accent-soft text-accent text-[10.5px] font-medium leading-[17px]">New</span>
        )}
        <ChevronIcon size={13} className="text-faint" />
      </div>
    </div>
  )
}


/**
 * Every setting, in a sheet centred on the window: search, then the settings
 * in groups; a row opens its page, and Back returns to the list. Opened from
 * the newest feature's title-bar button, it starts on that feature's page.
 */
export function SettingsSheet() {
  const which = useUi((u) => u.settingsMenu)
  const [page, setPage] = useState<string | null>(which === 'quick' ? (latest?.id ?? null) : null)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  // The title-bar button can switch the open sheet to the newest page.
  useEffect(() => {
    if (which === 'quick') setPage(latest?.id ?? null)
  }, [which])
  useEffect(() => {
    if (!page) search.current?.focus()
  }, [page])

  const open = FEATURES.find((f) => f.id === page)
  const q = query.trim().toLowerCase()
  const found = q ? byNewest(FEATURES).filter((f) => matches(f, q)) : []

  return (
    <div className="absolute inset-0 bg-overlay flex justify-center items-center z-30">
      <div
        data-settings-menu
        role="dialog"
        aria-label="Settings"
        className="w-[480px] max-w-[calc(100%-40px)] max-h-[min(680px,calc(100%-64px))] bg-win border border-line2 rounded-[16px] shadow-pop flex flex-col overflow-hidden"
      >
        <div className="h-[56px] flex-none relative flex items-center justify-center px-3">
          <div
            onClick={() => (open ? setPage(null) : closeSettingsMenu())}
            title={open ? 'Back' : 'Close'}
            className="absolute left-3 w-[30px] h-[30px] rounded-pill grid place-items-center bg-sel text-muted cursor-pointer hover:text-text"
          >
            {open ? <ChevronIcon back size={15} /> : <CloseIcon size={14} />}
          </div>
          <span className="font-head text-[14.5px] font-semibold">{open ? open.title : 'Settings'}</span>
        </div>

        <div className="flex-auto min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          {open ? (
            open.sections ? (
              <open.Row />
            ) : (
              <Section>
                <open.Row />
              </Section>
            )
          ) : (
            <>
              <label className="h-[34px] flex-none flex items-center gap-2 px-3 rounded-pill bg-pane border border-line text-faint focus-within:border-line2">
                <SearchIcon size={14} />
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-text placeholder:text-faint"
                />
              </label>
              {q ? (
                found.length ? (
                  <div className={card}>
                    {found.map((f, i) => (
                      <FeatureRow key={f.id} f={f} last={i === found.length - 1} onOpen={() => setPage(f.id)} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-[12.5px] text-faint pt-6">No settings match “{query.trim()}”</div>
                )
              ) : (
                GROUPS.map((g) => {
                  const rows = byNewest(FEATURES).filter((f) => f.group === g)
                  return rows.length ? (
                    <div key={g} className="flex flex-col gap-1.5">
                      <span className={groupLabel}>{g}</span>
                      <div className={card}>
                        {rows.map((f, i) => (
                          <FeatureRow key={f.id} f={f} last={i === rows.length - 1} onOpen={() => setPage(f.id)} />
                        ))}
                      </div>
                    </div>
                  ) : null
                })
              )}
            </>
          )}
        </div>
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

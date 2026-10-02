// Settings: one popover with every setting, plus a title-bar button for the
// feature that landed most recently (lib/features picks it from `since`).
//
// To add a setting: give it a row component and an entry in FEATURES with the
// release it ships in. If it is the newest, it takes over the title-bar button
// on its own and the previous one stays here in Settings.
import { setTheme, setWarmthPercent, toggleWarm } from '../../app/actions'
import { byNewest, type Landed, newest } from '../../lib/features'
import { isWarm, percentAt } from '../../lib/warmth'
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

function WarmthRow() {
  const warmth = useUi((u) => u.warmth)
  const on = useWarmOn()
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={label}>Warm colours</span>
        <Toggle on={on} onChange={toggleWarm} label="Warm colours" />
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

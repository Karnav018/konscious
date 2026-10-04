// Warm colours for late sessions — what f.lux does to a display, done to this
// window. Every colour is multiplied by the RGB of a black body at `kelvin`,
// so the interface drifts toward amber instead of being tinted by a filter
// (a filter over the window would cost subpixel antialiasing on the terminal
// text, which is most of what Konscious draws).
//
// An app cannot touch the display's gamma ramp, so this warms Konscious and
// nothing else on screen. It composes with Night Shift or f.lux if one runs.
import type { Theme } from '../types'

/** Neutral: the daylight white point the palette in tokens.css is drawn for. */
export const NEUTRAL_K = 6500
/** Warmest setting — deep amber, around candlelight. */
export const WARMEST_K = 2000
/** Where the slider starts the first time it is switched on. */
export const DEFAULT_K = 3400

export const isWarm = (kelvin: number) => kelvin < NEUTRAL_K
export const clampK = (kelvin: number) => Math.min(NEUTRAL_K, Math.max(WARMEST_K, Math.round(kelvin)))
/** Off is simply neutral: nothing is rewritten. */
export const effectiveK = (on: boolean, kelvin: number) => (on ? clampK(kelvin) : NEUTRAL_K)

/** Slider position 0–100 (right is warmer) ⇄ colour temperature. */
export const kelvinAt = (percent: number) =>
  clampK(NEUTRAL_K - (Math.min(100, Math.max(0, percent)) / 100) * (NEUTRAL_K - WARMEST_K))
export const percentAt = (kelvin: number) =>
  Math.round(((NEUTRAL_K - clampK(kelvin)) / (NEUTRAL_K - WARMEST_K)) * 100)

/** Colour tokens the warm pass rewrites.
 *
 *  The status palette is deliberately absent — --ok, --warn, --err and --info
 *  are how a pane says working / waiting / failed / idle, and how the usage
 *  rings warn you, so they stay true at every setting. --hot joins them: a
 *  machine under load must never start reading as a session in trouble. The shadows and the
 *  modal overlay are black: warming them would change nothing. */
export const WARMED_TOKENS = [
  '--stage',
  '--win',
  '--side',
  '--pane',
  '--raised',
  '--line',
  '--line2',
  '--text',
  '--muted',
  '--faint',
  '--accent',
  '--accentSoft',
  '--accentInk',
  '--userBg',
  '--water',
  '--stand',
  '--sys',
  '--cpu',
  '--ram',
  '--ssd',
  '--tmp',
  '--pomo',
  '--hover',
  '--sel',
] as const

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** Black-body RGB at `kelvin` (Tanner Helland's approximation), 0–255. */
function blackBody(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return [r, g, b].map((x) => Math.min(255, Math.max(0, x))) as [number, number, number]
}

const NEUTRAL_RGB = blackBody(NEUTRAL_K)

/** Per-channel multipliers, normalised so NEUTRAL_K leaves colours untouched. */
export function multipliers(kelvin: number): [number, number, number] {
  const rgb = blackBody(kelvin)
  return [rgb[0] / NEUTRAL_RGB[0], rgb[1] / NEUTRAL_RGB[1], rgb[2] / NEUTRAL_RGB[2]]
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i

/** `#abc`, `#aabbcc`, `rgb()` and `rgba()` warmed to `kelvin`; any other value
 *  (a gradient, a shadow, `none`) is returned untouched. */
export function warmColor(value: string, kelvin: number): string {
  const v = value.trim()
  if (!isWarm(kelvin)) return v
  const m = multipliers(kelvin)

  const hex = HEX.exec(v)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    const out = [0, 1, 2].map((i) => clamp255(parseInt(h.slice(i * 2, i * 2 + 2), 16) * m[i]))
    return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
  }

  const rgb = RGB.exec(v)
  if (rgb) {
    const out = [0, 1, 2].map((i) => clamp255(Number(rgb[i + 1]) * m[i]))
    return rgb[4] === undefined ? `rgb(${out.join(', ')})` : `rgba(${out.join(', ')}, ${rgb[4]})`
  }
  return v
}

/* ── applying it to the window ────────────────────────────────────── */

// tokens.css stays the one source of the palette: the base values are read
// from it once per theme, with no overrides in place so warm values can never
// compound, and the warm pass writes overrides on <html>.
const base = new Map<Theme, Map<string, string>>()

function baseTokens(theme: Theme): Map<string, string> {
  const cached = base.get(theme)
  if (cached) return cached
  const root = document.documentElement
  for (const token of WARMED_TOKENS) root.style.removeProperty(token)
  const style = getComputedStyle(root)
  const read = new Map(WARMED_TOKENS.map((t) => [t as string, style.getPropertyValue(t).trim()]))
  // Only a complete read is cached: before the stylesheet applies every value
  // is empty, and caching that would leave the palette unwarmable.
  if ([...read.values()].every((v) => v !== '')) base.set(theme, read)
  return read
}

/** Rewrites the warmed tokens for `kelvin`; NEUTRAL_K clears them again. */
export function paintWarmth(theme: Theme, kelvin: number) {
  const root = document.documentElement
  for (const [token, value] of baseTokens(theme)) {
    if (!value) continue
    if (isWarm(kelvin)) root.style.setProperty(token, warmColor(value, kelvin))
    else root.style.removeProperty(token)
  }
}

/* ── when it warms ────────────────────────────────────────────────── */

// A schedule is three choices: all the time, between hours you set, or from
// sunset to sunrise. The strength it returns is 0–1 rather than on/off, so the
// colour eases across each boundary instead of snapping — twenty minutes
// either side, which is slow enough not to notice happening and quick enough
// to be done before you wonder.

export type WarmWhen = 'always' | 'hours' | 'sun'

/** How long a boundary takes to cross, centred on the boundary itself. */
export const RAMP_MS = 40 * 60 * 1000

const DAY_MS = 86_400_000
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Minutes from local midnight as an instant on the day `now` falls in. */
export function atLocalMinutes(now: number, minutes: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime() + minutes * 60_000
}

/** How warm it should be at `now`, 0–1, for a window that runs `onAt` → `offAt`
 *  and may cross midnight. Ramps across both boundaries. */
export function warmStrength(now: number, onAt: number, offAt: number, ramp = RAMP_MS): number {
  const half = ramp / 2
  let end = offAt
  while (end <= onAt) end += DAY_MS
  let best = 0
  // The same window yesterday, today and tomorrow: whichever one `now` is in.
  for (const shift of [-DAY_MS, 0, DAY_MS]) {
    const up = clamp01((now - (onAt + shift - half)) / ramp)
    const down = clamp01((now - (end + shift - half)) / ramp)
    best = Math.max(best, Math.min(up, 1 - down))
  }
  return best
}

/** The next time the schedule changes its mind, which is how long a manual
 *  override lasts: turn it off at dusk and it stays off until dawn. */
export function nextBoundary(now: number, onAt: number, offAt: number): number {
  let end = offAt
  while (end <= onAt) end += DAY_MS
  const candidates: number[] = []
  for (const shift of [-DAY_MS, 0, DAY_MS, 2 * DAY_MS]) candidates.push(onAt + shift, end + shift)
  return candidates.filter((t) => t > now).sort((a, b) => a - b)[0] ?? now + DAY_MS
}

/** The temperature to paint: neutral at strength 0, the chosen warmth at 1. */
export const kelvinFor = (warmth: number, strength: number): number =>
  Math.round(NEUTRAL_K - (NEUTRAL_K - clampK(warmth)) * clamp01(strength))

// Themes: eight palettes, each with a dark and a light variant and three
// accents. A theme changes colour, type and corner radius; the status colours
// (ok, waiting, error) keep their meaning in every one.
//
// tokens.css stays the source of the Konscious theme, so with Konscious and its
// first accent nothing here applies and the app looks exactly as it always
// has. Any other choice is written as overrides on top of tokens.css
// (themeTokens), and the warm-colours pass in lib/warmth works on whatever
// that produces.
import type { Theme } from '../types'

/** Dark or light, as the Appearance switch picks it. */
export type Mode = Theme

export type PaletteId = 'konscious' | 'graphite' | 'ember' | 'moss' | 'tide' | 'paper' | 'riso' | 'contrast'

interface Base {
  stage: string
  win: string
  pane: string
  raised: string
  line: string
  line2: string
  text: string
  muted: string
  faint: string
}

export interface Accent {
  name: string
  dark: string
  light: string
}

export interface Palette {
  id: PaletteId
  name: string
  desc: string
  /** Interface font (CSS family list without fallbacks). */
  ui: string
  /** The terminal font when Terminal font is left on "Theme default". */
  mono: string
  r: number
  rs: number
  accents: [Accent, Accent, Accent]
  dark: Base
  light: Base
  /** Brighter status colours, for High contrast. */
  contrast?: boolean
  /** Terminal selection, when it is not a tint of the accent. */
  selection?: Record<Mode, string>
}

const acc = (name: string, dark: string, light: string): Accent => ({ name, dark, light })

export const PALETTES: Palette[] = [
  {
    id: 'konscious',
    name: 'Konscious',
    desc: 'Cream, plum and charcoal, warm in both modes.',
    ui: "'Poppins'",
    mono: "'JetBrains Mono'",
    r: 10,
    rs: 6,
    accents: [acc('Plum', '#c890a7', '#a35c7a'), acc('Apricot', '#e0a77a', '#a85a24'), acc('Dusk', '#9fb4d9', '#4a69a0')],
    // The values tokens.css ships (used for swatches and derived colours; the
    // stylesheet itself stays in charge of this theme).
    dark: { stage: '#171616', win: '#212121', pane: '#292626', raised: '#312d2d', line: '#383232', line2: '#4a4141', text: '#fbf5e5', muted: '#c9bdb4', faint: '#8c807b' },
    light: { stage: '#efe6cf', win: '#fbf5e5', pane: '#fffcf5', raised: '#fffcf5', line: '#ece2cb', line2: '#dccbc9', text: '#212121', muted: '#5e5654', faint: '#9c8f8b' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    desc: 'Neutral greys with nothing warm in them. Tighter corners, for long days.',
    ui: "'Poppins'",
    mono: "'JetBrains Mono'",
    r: 6,
    rs: 4,
    accents: [acc('Iris', '#8ea8ff', '#3d5bd9'), acc('Mint', '#7fd1b9', '#1c7a60'), acc('Amber', '#f0b46a', '#9c5c0c')],
    dark: { stage: '#0f1012', win: '#17181b', pane: '#1d1f23', raised: '#25282d', line: '#2b2e34', line2: '#3b3f47', text: '#e8eaee', muted: '#a9aeb8', faint: '#727884' },
    light: { stage: '#dfe1e5', win: '#f4f5f7', pane: '#ffffff', raised: '#ffffff', line: '#e3e5e9', line2: '#cdd1d8', text: '#16181c', muted: '#4f5560', faint: '#7f8590' },
  },
  {
    id: 'ember',
    name: 'Ember',
    desc: 'Terracotta on espresso. The warmest theme, easy on the eyes late.',
    ui: "'Poppins'",
    mono: "'Geist Mono'",
    r: 8,
    rs: 5,
    accents: [acc('Clay', '#e08a63', '#b0502b'), acc('Honey', '#d9b26a', '#8e6210'), acc('Olive', '#a6c48a', '#4a7228')],
    dark: { stage: '#120e0b', win: '#1c1713', pane: '#241d18', raised: '#2d251f', line: '#352b24', line2: '#4a3d33', text: '#f3e8dc', muted: '#c8b6a4', faint: '#91806f' },
    light: { stage: '#e8dccb', win: '#f6efe6', pane: '#fffaf4', raised: '#ffffff', line: '#eadccb', line2: '#d6c2ac', text: '#2a1f18', muted: '#6b5848', faint: '#93806e' },
  },
  {
    id: 'moss',
    name: 'Moss',
    desc: 'Forest greens with sage accents. Quiet, rounder corners.',
    ui: "'Poppins'",
    mono: "'IBM Plex Mono'",
    r: 12,
    rs: 7,
    accents: [acc('Sage', '#9fd2a6', '#357046'), acc('Straw', '#e3c77d', '#85640f'), acc('Heather', '#c7a2d6', '#74448a')],
    dark: { stage: '#0c110e', win: '#141b17', pane: '#1a231e', raised: '#222c26', line: '#27322b', line2: '#36463c', text: '#e4ece4', muted: '#a7b8aa', faint: '#728475' },
    light: { stage: '#dde4d9', win: '#f1f4ee', pane: '#fbfcf9', raised: '#ffffff', line: '#dfe6da', line2: '#c6d1c0', text: '#18211b', muted: '#4b5a4f', faint: '#7d8b80' },
  },
  {
    id: 'tide',
    name: 'Tide',
    desc: 'Ink navy with a sea-glass accent. Cool, with strong contrast on panes.',
    ui: "'Poppins'",
    mono: "'IBM Plex Mono'",
    r: 8,
    rs: 5,
    accents: [acc('Sea glass', '#6fd6c8', '#0f736d'), acc('Coral', '#f29f8f', '#b8452f'), acc('Violet', '#b9a6ff', '#5a42c4')],
    dark: { stage: '#080c18', win: '#10172a', pane: '#151d34', raised: '#1c2541', line: '#222c48', line2: '#2f3b5e', text: '#e6ebf5', muted: '#a5b0c8', faint: '#717d9a' },
    light: { stage: '#dbe2ed', win: '#eef2f8', pane: '#fafcff', raised: '#ffffff', line: '#dbe2ee', line2: '#c1cbdf', text: '#121a2e', muted: '#4a5672', faint: '#7c87a0' },
  },
  {
    id: 'paper',
    name: 'Paper',
    desc: 'Monospace everywhere, ink on paper, square corners. A terminal all the way out.',
    ui: "'IBM Plex Mono'",
    mono: "'IBM Plex Mono'",
    r: 2,
    rs: 2,
    accents: [acc('Vermilion', '#ff6a45', '#c9330f'), acc('Signal', '#ffd23f', '#8a6800'), acc('Cobalt', '#6aaeff', '#1d58b8')],
    dark: { stage: '#000000', win: '#0d0d0d', pane: '#121212', raised: '#1a1a1a', line: '#2a2a2a', line2: '#3f3f3f', text: '#f2f2ee', muted: '#b5b5ad', faint: '#7e7e77' },
    light: { stage: '#e4e2da', win: '#f5f3ec', pane: '#fbfaf6', raised: '#ffffff', line: '#dcd9cf', line2: '#bdb9ac', text: '#111111', muted: '#4d4b45', faint: '#7f7c72' },
  },
  {
    id: 'riso',
    name: 'Risograph',
    desc: 'Newsprint and fluorescent print-shop inks. Paper’s monospace and square corners; selections are highlighter yellow.',
    ui: "'IBM Plex Mono'",
    mono: "'IBM Plex Mono'",
    r: 2,
    rs: 2,
    accents: [acc('Fluoro pink', '#ff4fae', '#d1006b'), acc('Riso teal', '#2fc4c0', '#00757a'), acc('Riso blue', '#7d93ff', '#2b45b8')],
    // Black card stock, and newsprint.
    dark: { stage: '#0b0907', win: '#120f0c', pane: '#16130f', raised: '#1f1b16', line: '#2a251e', line2: '#3d362c', text: '#efe9dc', muted: '#bdb4a2', faint: '#857c6b' },
    light: { stage: '#e0d8c3', win: '#ece5d3', pane: '#f4efe1', raised: '#faf7ee', line: '#ddd4bf', line2: '#c4b9a0', text: '#1c1a17', muted: '#4e483e', faint: '#7d7563' },
    selection: { dark: 'rgba(255, 235, 59, 0.26)', light: 'rgba(255, 235, 59, 0.55)' },
  },
  {
    id: 'contrast',
    name: 'High contrast',
    desc: 'Pure black and white, strong borders, brighter status colours. Text clears 7:1 everywhere.',
    ui: "'Poppins'",
    mono: "'JetBrains Mono'",
    r: 6,
    rs: 4,
    contrast: true,
    accents: [acc('Signal', '#ffd500', '#0038d1'), acc('Cyan', '#00e5ff', '#6a00b0'), acc('Pink', '#ff7ad9', '#a8003a')],
    dark: { stage: '#000000', win: '#000000', pane: '#0a0a0a', raised: '#161616', line: '#6a6a6a', line2: '#9a9a9a', text: '#ffffff', muted: '#e6e6e6', faint: '#c4c4c4' },
    light: { stage: '#ffffff', win: '#ffffff', pane: '#ffffff', raised: '#ffffff', line: '#5c5c5c', line2: '#1f1f1f', text: '#000000', muted: '#1a1a1a', faint: '#3a3a3a' },
  },
]

export const DEFAULT_PALETTE: PaletteId = 'konscious'

/** For the settings file's schema. */
export const PALETTE_IDS = ['konscious', 'graphite', 'ember', 'moss', 'tide', 'paper', 'riso', 'contrast'] as const satisfies readonly PaletteId[]

export const paletteById = (id: string): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0]

/** The accent picked for `p`, clamped to the three it has. */
export const accentOf = (p: Palette, index: number | undefined): Accent => p.accents[index ?? 0] ?? p.accents[0]

/* ── terminal font ───────────────────────────────────────────────── */

export type TermFontId = 'theme' | 'jetbrains' | 'plex' | 'geist' | 'fira' | 'sourcecode' | 'inconsolata' | 'ubuntu' | 'space'

/** Every pane's font: transcripts, diffs, the prompt and the shell. Separate
 *  from the theme's interface font. */
export const TERM_FONTS: { id: TermFontId; name: string; family: string | null }[] = [
  { id: 'theme', name: 'Theme default', family: null },
  { id: 'jetbrains', name: 'JetBrains Mono', family: "'JetBrains Mono'" },
  { id: 'plex', name: 'IBM Plex Mono', family: "'IBM Plex Mono'" },
  { id: 'geist', name: 'Geist Mono', family: "'Geist Mono'" },
  { id: 'fira', name: 'Fira Code', family: "'Fira Code'" },
  { id: 'sourcecode', name: 'Source Code Pro', family: "'Source Code Pro'" },
  { id: 'inconsolata', name: 'Inconsolata', family: "'Inconsolata'" },
  { id: 'ubuntu', name: 'Ubuntu Mono', family: "'Ubuntu Mono'" },
  { id: 'space', name: 'Space Mono', family: "'Space Mono'" },
]

/** For the settings file's schema. */
export const TERM_FONT_IDS = ['theme', 'jetbrains', 'plex', 'geist', 'fira', 'sourcecode', 'inconsolata', 'ubuntu', 'space'] as const satisfies readonly TermFontId[]

/** The terminal's font family: the one picked, or the theme's own. Without
 *  fallbacks, so it can be measured; see termFontStack for the CSS list. */
export function termFont(palette: Palette, id: string): string {
  return TERM_FONTS.find((f) => f.id === id)?.family ?? palette.mono
}

export const termFontStack = (family: string) => `${family}, ui-monospace, Menlo, monospace`

/** Sizes the Terminal font setting offers (the panes' base size). */
export const TERM_SIZES = [11, 12, 13, 14, 15] as const

/* ── colour ──────────────────────────────────────────────────────── */

const hex = (h: string) => h.replace('#', '').match(/../g)!.map((v) => parseInt(v, 16))
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** `a` moved `t` of the way toward `b`, in sRGB. */
export const mix = (a: string, b: string, t: number) => {
  const x = hex(a)
  const y = hex(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

export const rgba = (h: string, alpha: number) => `rgba(${hex(h).join(', ')}, ${alpha})`

/** WCAG relative luminance and contrast ratio. */
const lum = (h: string) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** Status colours. The same three meanings everywhere; High contrast only
 *  makes them brighter. */
export function statusColors(p: Palette, mode: Mode) {
  if (p.contrast) return mode === 'dark' ? { ok: '#5dff8a', warn: '#ffcc33', err: '#ff6b6b' } : { ok: '#006b2e', warn: '#7a4f00', err: '#b00020' }
  return mode === 'dark' ? { ok: '#8fce9f', warn: '#e9bc6a', err: '#f07a7a' } : { ok: '#2f7d4d', warn: '#9a6212', err: '#b8352a' }
}

/** The notch island is black whatever the theme. On a window nearly as dark
 *  (Paper, High contrast, Risograph…) it would vanish, so it gets an edge in
 *  the theme's border colour. Konscious's #212121 is light enough without. */
export function islandEdge(p: Palette, mode: Mode): string | null {
  return contrast('#000000', p[mode].win) < 1.25 ? p[mode].line2 : null
}

/** Is this the look tokens.css already gives, with nothing to override? */
export const isStock = (p: Palette, accent: number | undefined) => p.id === DEFAULT_PALETTE && (accent ?? 0) === 0

/**
 * The CSS custom properties that turn tokens.css into `p` in `mode`. Empty for
 * the stock look. Mini-app hues are not here: they stay what tokens.css gives
 * each mode, which is what lib/palette.test.ts measures them against.
 */
export function themeTokens(p: Palette, mode: Mode, accentIndex: number | undefined): Record<string, string> {
  if (isStock(p, accentIndex)) return {}
  const dark = mode === 'dark'
  const accent = dark ? accentOf(p, accentIndex).dark : accentOf(p, accentIndex).light
  const shared = {
    '--accent': accent,
    '--accentSoft': rgba(accent, dark ? 0.16 : 0.1),
    '--accentInk': dark ? '#111111' : '#ffffff',
  }
  // Konscious with another accent: only the accent and what is tinted by it.
  if (p.id === DEFAULT_PALETTE) {
    return dark ? shared : { ...shared, '--hover': rgba(accent, 0.1), '--sel': rgba(accent, 0.18) }
  }
  const b = p[mode]
  const s = statusColors(p, mode)
  const font = `${p.ui}, system-ui, sans-serif`
  return {
    '--ui': font,
    '--head': font,
    '--mono': `${p.mono}, ui-monospace, monospace`,
    '--r': `${p.r}px`,
    '--rs': `${p.rs}px`,
    '--wr': `${p.r + 2}px`,
    '--stage': b.stage,
    '--win': b.win,
    '--side': b.win,
    '--pane': b.pane,
    '--raised': b.raised,
    '--line': b.line,
    '--line2': b.line2,
    '--text': b.text,
    '--muted': b.muted,
    '--faint': b.faint,
    ...shared,
    '--ok': s.ok,
    '--warn': s.warn,
    '--err': s.err,
    '--addBg': rgba(s.ok, dark ? 0.12 : 0.1),
    '--delBg': rgba(s.err, dark ? 0.12 : 0.08),
    '--userBg': dark ? b.raised : mix(b.pane, accent, 0.08),
    '--hover': dark ? rgba(b.text, 0.045) : rgba(accent, 0.1),
    '--sel': dark ? rgba(b.text, 0.075) : rgba(accent, 0.18),
    '--shadow': dark ? '0 30px 80px rgba(0, 0, 0, 0.55)' : `0 24px 60px ${rgba(b.text, 0.14)}`,
    '--overlay': dark ? 'rgba(0, 0, 0, 0.45)' : rgba(b.text, 0.22),
    '--segShadow': dark ? '0 1px 2px rgba(0, 0, 0, 0.25)' : `0 1px 2px ${rgba(b.text, 0.12)}`,
  }
}

/** The stylesheet for `themeTokens`. Two attribute selectors outrank both of
 *  tokens.css's blocks wherever the bundler puts this; the warm pass's inline
 *  values on <html> still sit on top of it. */
export function themeCss(tokens: Record<string, string>): string {
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')
  return body ? `:root[data-theme][data-palette] {\n${body}\n}\n` : ''
}

/* ── terminal colours ────────────────────────────────────────────── */

export interface Ansi {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

// The Konscious set, as it has always shipped.
const STOCK_ANSI: Record<Mode, Ansi> = {
  dark: {
    black: '#383232', red: '#f07a7a', green: '#8fce9f', yellow: '#e9bc6a',
    blue: '#9fb4e0', magenta: '#c890a7', cyan: '#8fcfcf', white: '#e6dfd0',
    brightBlack: '#8c807b', brightRed: '#f59a9a', brightGreen: '#aedcb9', brightYellow: '#f0cd8c',
    brightBlue: '#bccbea', brightMagenta: '#dcb0c2', brightCyan: '#afdddd', brightWhite: '#fbf5e5',
  },
  light: {
    black: '#212121', red: '#c0392b', green: '#3f8f5e', yellow: '#a8741a',
    blue: '#3d6aa8', magenta: '#a35c7a', cyan: '#2e7f86', white: '#5e5654',
    brightBlack: '#9c8f8b', brightRed: '#d9534f', brightGreen: '#4ea570', brightYellow: '#c08a2a',
    brightBlue: '#4f7fc0', brightMagenta: '#b8708f', brightCyan: '#3a959d', brightWhite: '#212121',
  },
}

/** The 16 ANSI colours for `p`: the stock set for Konscious; otherwise built
 *  from the theme's own text, line and status colours, with its accent as
 *  magenta. Blue and cyan keep the stock hues, which read on every pane. */
export function ansiFor(p: Palette, mode: Mode, accentIndex: number | undefined): Ansi {
  const stock = STOCK_ANSI[mode]
  if (p.id === DEFAULT_PALETTE) {
    if (isStock(p, accentIndex)) return stock
    const a = accentOf(p, accentIndex)[mode]
    return { ...stock, magenta: a, brightMagenta: mix(a, mode === 'dark' ? '#ffffff' : '#000000', 0.25) }
  }
  const b = p[mode]
  const s = statusColors(p, mode)
  const a = accentOf(p, accentIndex)[mode]
  const dark = mode === 'dark'
  const lift = (c: string) => mix(c, dark ? '#ffffff' : '#000000', dark ? 0.25 : 0.15)
  return {
    ...stock,
    black: dark ? b.line2 : b.text,
    red: s.err,
    green: s.ok,
    yellow: s.warn,
    magenta: a,
    white: b.muted,
    brightBlack: b.faint,
    brightRed: lift(s.err),
    brightGreen: lift(s.ok),
    brightYellow: lift(s.warn),
    brightMagenta: lift(a),
    brightWhite: b.text,
  }
}

/** Terminal selection: a tint of the accent, never read as an error. */
export const selectionFor = (p: Palette, mode: Mode, accentIndex: number | undefined) =>
  isStock(p, accentIndex)
    ? mode === 'dark'
      ? 'rgba(200,144,167,0.32)'
      : 'rgba(200,144,167,0.35)'
    : (p.selection?.[mode] ?? rgba(accentOf(p, accentIndex)[mode], mode === 'dark' ? 0.32 : 0.3))

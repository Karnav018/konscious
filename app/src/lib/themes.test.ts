/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { ansiFor, contrast, islandEdge, PALETTE_IDS, PALETTES, paletteById, selectionFor, TERM_FONT_IDS, TERM_FONTS, themeCss, themeTokens } from './themes'

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const block = (selector: string) => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
const token = (body: string, name: string) => body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]

describe('themes', () => {
  it('leaves the stock look to tokens.css: Konscious with its first accent writes nothing', () => {
    const k = paletteById('konscious')
    expect(themeTokens(k, 'dark', undefined)).toEqual({})
    expect(themeTokens(k, 'light', 0)).toEqual({})
    expect(themeCss({})).toBe('')
  })

  it("describes Konscious with tokens.css's own values", () => {
    const k = paletteById('konscious')
    for (const [mode, sel] of [['dark', ':root {'], ['light', ":root[data-theme='light']"]] as const) {
      const body = block(sel)
      for (const [name, value] of Object.entries(k[mode])) expect(token(body, name), `${mode} --${name}`).toBe(value)
      expect(token(body, 'accent')).toBe(k.accents[0][mode])
    }
  })

  it('has eight themes, each with three accents, and the ids the settings file accepts', () => {
    expect(PALETTES.map((p) => p.id)).toEqual([...PALETTE_IDS])
    expect(TERM_FONTS.map((f) => f.id)).toEqual([...TERM_FONT_IDS])
    for (const p of PALETTES) expect(p.accents).toHaveLength(3)
  })

  it('keeps text readable and accents visible on panes, in every theme and mode', () => {
    for (const p of PALETTES)
      for (const mode of ['dark', 'light'] as const) {
        const b = p[mode]
        expect(contrast(b.text, b.pane), `${p.id} ${mode} text`).toBeGreaterThanOrEqual(p.contrast ? 7 : 4.5)
        expect(contrast(b.muted, b.pane), `${p.id} ${mode} muted`).toBeGreaterThanOrEqual(4.5)
        for (const a of p.accents) expect(contrast(a[mode], b.pane), `${p.id} ${mode} ${a.name}`).toBeGreaterThanOrEqual(3)
      }
  })

  it('overrides every colour a theme changes, and a Konscious accent only touches the accent', () => {
    const t = themeTokens(paletteById('tide'), 'dark', 1)
    expect(t['--pane']).toBe('#151d34')
    expect(t['--accent']).toBe('#f29f8f')
    expect(t['--r']).toBe('8px')
    expect(themeCss(t)).toContain(':root[data-theme][data-palette] {')
    expect(Object.keys(themeTokens(paletteById('konscious'), 'dark', 2)).sort()).toEqual(['--accent', '--accentInk', '--accentSoft'])
  })

  it('selects in highlighter yellow in Risograph, and in an accent tint elsewhere', () => {
    expect(selectionFor(paletteById('riso'), 'light', 0)).toBe('rgba(255, 235, 59, 0.55)')
    expect(selectionFor(paletteById('paper'), 'light', 0)).toBe('rgba(201, 51, 15, 0.3)')
    expect(selectionFor(paletteById('tide'), 'dark', 0)).toBe('rgba(111, 214, 200, 0.32)')
  })

  it('edges the black notch island only where the window is nearly black', () => {
    expect(islandEdge(paletteById('konscious'), 'dark')).toBeNull()
    expect(islandEdge(paletteById('paper'), 'dark')).toBe('#3f3f3f')
    expect(islandEdge(paletteById('contrast'), 'dark')).toBe('#9a9a9a')
    expect(islandEdge(paletteById('riso'), 'dark')).toBe('#3d362c')
    for (const p of PALETTES) expect(islandEdge(p, 'light'), p.id).toBeNull()
  })

  it('gives terminals the theme accent as magenta', () => {
    expect(ansiFor(paletteById('moss'), 'light', 2).magenta).toBe('#74448a')
    expect(ansiFor(paletteById('konscious'), 'dark', 0).magenta).toBe('#c890a7')
  })
})

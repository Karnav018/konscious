// The palette's one hard rule, measured rather than eyeballed.
//
// --ok, --warn, --err and --info say what a session is doing. A mini app that
// borrows one of them is lying about itself, which is the first rule in
// lib/apps.ts. There was already a test for it, and it compared hex strings —
// so it passed happily while --sit sat ΔEok 0.024 from --ok, which is to say
// while a Sitting tile looked exactly like a session reporting OK.
//
// This reads the real values out of tokens.css, so the test cannot drift away
// from the stylesheet, and compares them in OKLab, where distance is roughly
// what the eye separates.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { APPS, METRICS } from './apps'
import { deltaE } from './oklab'

/** Comfortably past a just-noticeable difference (about 0.02): two colours
 *  this far apart are not mistaken for each other at a glance. */
const MIN = 0.08

const STATUS = ['ok', 'warn', 'err', 'info'] as const

/** The stylesheet itself, so this cannot drift from what actually ships. */
const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')

/**
 * Collisions that predate this test, with the distance each measured when it
 * was found. The guard holds them where they are rather than either failing
 * the build over colours that already shipped or quietly lowering the bar for
 * everything. Anything new has to clear MIN properly.
 *
 *   accent/info  the warm-colours tile uses --accent, which is the app's own
 *                chrome rather than a hue of its own (see lib/apps.ts)
 *   cpu/info     and
 *   ssd/warn     two of the four stats gauge hues, marginal in dark only
 */
const KNOWN: Record<string, number> = {
  'dark accent/info': 0.074,
  'dark cpu/info': 0.077,
  'dark ssd/warn': 0.068,
}

/** The hex tokens declared in one theme's block. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(selector)
  expect(at, `${selector} is missing from tokens.css`).toBeGreaterThanOrEqual(0)
  const body = css.slice(at, css.indexOf('}', at))
  const found: Record<string, string> = {}
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) found[m[1]] = m[2]
  return found
}

const THEMES = {
  dark: tokens(':root {'),
  light: tokens(":root[data-theme='light']"),
}

/** `var(--water)` → `water`. Every app hue is a token reference. */
const nameOf = (hue: string): string => {
  const m = /^var\(--([\w-]+)\)$/.exec(hue)
  expect(m, `app hue ${hue} should be a token`).not.toBeNull()
  return m![1]
}

/** Every hue an app or a gauge paints itself with. */
const HUES = [...new Set([...APPS.map((a) => nameOf(a.hue)), ...METRICS.map((m) => nameOf(m.hue)), 'hot'])]

describe('no app hue can be mistaken for a session state', () => {
  it('declares every hue it uses, in both themes', () => {
    for (const [theme, got] of Object.entries(THEMES)) {
      for (const hue of [...HUES, ...STATUS]) {
        expect(got[hue], `--${hue} is missing from the ${theme} theme`).toBeTruthy()
      }
    }
  })

  for (const [theme, got] of Object.entries(THEMES)) {
    for (const hue of HUES) {
      it(`${theme}: --${hue} is clear of all four status colours`, () => {
        for (const status of STATUS) {
          const got2 = deltaE(got[hue], got[status])
          const known = KNOWN[`${theme} ${hue}/${status}`]
          const floor = known === undefined ? MIN : known - 0.001
          expect(
            got2,
            `--${hue} (${got[hue]}) is ΔEok ${got2.toFixed(3)} from --${status} (${got[status]}) in the ${theme} theme` +
              (known === undefined ? `; it must be at least ${MIN}` : `; it must not get worse than ${known}`),
          ).toBeGreaterThanOrEqual(floor)
        }
      })
    }
  }

  it('knows about exactly the collisions it has been told to tolerate', () => {
    // If a known collision is fixed, this test says so, and the entry should
    // go — otherwise the list rots into a list of colours nobody checks.
    for (const [key, was] of Object.entries(KNOWN)) {
      const [theme, pair] = key.split(' ')
      const [hue, status] = pair.split('/')
      const now = deltaE(THEMES[theme as keyof typeof THEMES][hue], THEMES[theme as keyof typeof THEMES][status])
      expect(now, `${key} now measures ${now.toFixed(3)} — if it clears ${MIN}, drop it from KNOWN`).toBeLessThan(MIN)
      expect(Math.abs(now - was)).toBeLessThan(0.002)
    }
  })

  it('keeps the two newest hues well clear, not just barely', () => {
    // These are the ones that got this test written.
    for (const [theme, got] of Object.entries(THEMES)) {
      for (const hue of ['sit', 'caff']) {
        const worst = Math.min(...STATUS.map((s) => deltaE(got[hue], got[s])))
        expect(worst, `--${hue} in ${theme} is only ${worst.toFixed(3)} from a status colour`).toBeGreaterThan(0.1)
      }
    }
  })
})

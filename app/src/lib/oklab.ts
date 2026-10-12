// Perceptual colour distance, for the one palette rule that matters.
//
// An app's hue must never be mistakable for a session's state: --ok, --warn,
// --err and --info say what a pane is doing, and a mini app that borrows one
// of them is lying about itself. "Not the same hex" is not enough to check
// that — #7fd6a8 and #8fce9f are different values and the same colour to
// look at. So the check is done in OKLab, where distance corresponds to what
// the eye actually separates.
//
// Björn Ottosson's OKLab (2020). Everything here is pure.

export interface Lab {
  L: number
  a: number
  b: number
}

/** #rgb or #rrggbb → 0–1 channels. Throws on anything else: a malformed
 *  token is a bug in the stylesheet, not a colour to guess at. */
export function rgbOf(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`)
  const n = parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** sRGB's transfer curve, undone. */
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

export function oklab(hex: string): Lab {
  const [sr, sg, sb] = rgbOf(hex).map(linear) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * sr + 0.5363325363 * sg + 0.0514459929 * sb)
  const m = Math.cbrt(0.2119034982 * sr + 0.6806995451 * sg + 0.1073969566 * sb)
  const s = Math.cbrt(0.0883024619 * sr + 0.2817188376 * sg + 0.6299787005 * sb)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** How far apart two colours look, 0 being identical. Roughly: 0.02 is a
 *  just-noticeable step, 0.08 is "nobody would confuse these". */
export function deltaE(one: string, two: string): number {
  const x = oklab(one)
  const y = oklab(two)
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}

/** Chroma: how colourful, regardless of hue or lightness. Two colours can
 *  share a hue angle and still be told apart if this differs enough. */
export const chroma = (hex: string): number => {
  const { a, b } = oklab(hex)
  return Math.hypot(a, b)
}

/** Hue angle in degrees, 0–360. */
export const hueAngle = (hex: string): number => {
  const { a, b } = oklab(hex)
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}

/** OKLab back to sRGB. Returns null when the colour is outside the gamut,
 *  because a clamped value is a different colour from the one asked for. */
export function hexOf({ L, a, b }: Lab): string | null {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const out: number[] = []
  for (const c of lin) {
    if (c < -0.001 || c > 1.001) return null
    const v = Math.max(0, Math.min(1, c))
    out.push(v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
  }
  return '#' + out.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

/** Lightness, chroma and hue angle back to a Lab triple. */
export const fromLch = (L: number, C: number, hDeg: number): Lab => ({
  L,
  a: C * Math.cos((hDeg * Math.PI) / 180),
  b: C * Math.sin((hDeg * Math.PI) / 180),
})

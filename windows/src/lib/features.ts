// Which setting gets the title-bar button.
//
// Every user-facing setting lives in the Settings popover. The one that landed
// most recently also gets a button of its own in the title bar, so a new
// feature is one click away while it's new. When a newer one lands it takes
// that place, and the older one stays reachable in Settings — nothing to move
// by hand: the order comes from the `since` version each setting declares.

export interface Landed {
  id: string
  /** The release the feature first shipped in, e.g. "0.2.0". */
  since: string
}

/** Compares "major.minor.patch" versions numerically (0.10.0 > 0.9.0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Newest first. Equal versions keep their listed order (sort is stable). */
export const byNewest = <T extends Landed>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => compareVersions(b.since, a.since))

/** The setting that owns the title-bar button. */
export const newest = <T extends Landed>(list: readonly T[]): T | undefined => byNewest(list)[0]

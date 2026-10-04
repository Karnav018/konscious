// Files dropped or pasted onto a pane.
//
// Their paths are typed into the pane as text, which is the only thing the
// app can do — the prompt belongs to Claude, in another process. So the strip
// these build is a record of what was sent, not a list the app can edit: there
// is no per-file remove, because removing one path from a line we cannot read
// is guesswork. Clearing the whole input is a keystroke, so that is offered
// instead.

/** What a chip shows: a thumbnail for an image, a glyph for anything else. */
export type FileKind = 'image' | 'pdf' | 'file'

const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i

export function fileKind(path: string): FileKind {
  if (IMAGE.test(path)) return 'image'
  return /\.pdf$/i.test(path) ? 'pdf' : 'file'
}

/** The last segment of a path, with either separator. */
export function fileName(path: string): string {
  const clean = path.replace(/[/\\]+$/, '')
  return clean.split(/[/\\]/).pop() || clean
}

/** Keeps the most recent `cap` paths, newest last, without duplicates — the
 *  same file dropped twice is one chip, moved to the end. */
export function withAttached(current: readonly string[], added: readonly string[], cap = 12): string[] {
  const next = [...current.filter((p) => !added.includes(p)), ...added]
  return next.slice(Math.max(0, next.length - cap))
}

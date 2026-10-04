// Moving a workspace between machines: the path rules, mirrored from the
// engine (src-tauri/bundle.rs) so the dialogs can show what will happen
// before anything is written.
//
// A bundle is a `.kon` file. Inside it is a zip, which is deliberate: if a
// bundle ever goes wrong, renaming it to .zip gets the transcripts out by
// hand. Nothing about the format is secret.

/** Claude's own project-folder encoding: every character that is not a letter
 *  or a digit becomes a dash. Lossy by its design — two different paths can
 *  produce one folder — which is why the import dialog shows collisions. */
export const slugFor = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

/** Joins a root and an offset with the separator this platform uses. */
export function joinPath(root: string, relative: string, windows: boolean): string {
  const sep = windows ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')
  if (!relative) return base
  return base + sep + relative.split('/').filter(Boolean).join(sep)
}

export interface Placement {
  id: string
  name: string
  /** Where this session's folder lands on this machine. */
  cwd: string
  /** The folder Claude will keep its transcript in, or null for a shell. */
  slug: string | null
  /** Another session in this import writes to the same folder. */
  collides: boolean
}

/** Where every session in a bundle would land, and which ones would share a
 *  transcript folder with another. */
export function placements(
  sessions: readonly { id: string; name: string; relative: string; kind: string; hasTranscript: boolean }[],
  root: string,
  windows: boolean,
): Placement[] {
  const rows = sessions.map((s) => {
    const cwd = joinPath(root, s.relative, windows)
    return { id: s.id, name: s.name, cwd, slug: s.hasTranscript ? slugFor(cwd) : null, collides: false }
  })
  const counts = new Map<string, number>()
  for (const r of rows) if (r.slug) counts.set(r.slug, (counts.get(r.slug) ?? 0) + 1)
  return rows.map((r) => ({ ...r, collides: r.slug !== null && (counts.get(r.slug) ?? 0) > 1 }))
}

/** "7.8 MB", "840 KB", or nothing at all. */
export function size(bytes: number): string {
  if (bytes <= 0) return 'no transcript'
  const mb = bytes / 1024 ** 2
  return mb < 0.1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`
}

/** A file name someone will recognise a year from now. */
export function bundleName(workspace: string, now = new Date()): string {
  const name = workspace
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') // a trailing "!" must not become a double dash
    .toLowerCase()
  return `${name || 'workspace'}-${now.toISOString().slice(0, 10)}.kon`
}

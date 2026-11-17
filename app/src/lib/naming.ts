// Names for sessions Claude opens (app/agent.ts): a few words taken from the
// task, so the pane says what it is doing. "run the auth tests" → "Auth Tests".
// Pure functions — unit tested.

export const NAME_MAX = 24

// Words that say little about the work: articles, pronouns, filler, and the
// verbs a task usually opens with ("run", "fix", "build").
const SKIP = new Set(
  `a an the and or but to for in on of at by as from into onto with without about over under via per
  i me my we our us you your it its this that these those there here what which who how why when where
  is are be been being was were do does did done will would should could can may might must shall
  please just also now then so very really some any all each every new more most other same such only
  run running build building implement add make create write update fix review check investigate look find
  compare refactor help start begin go get set use using let try see keep change need want work working
  open spin up out off sure ok okay next first last thing things stuff bit
  branch code codebase project repo repository file files issue issues`.split(/\s+/),
)

/** Letters, digits, spaces and dashes only; no leading dash; at most NAME_MAX. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+/, '')
    .slice(0, NAME_MAX)
    .trim()
}

/** Up to three telling words from the task, title-cased, within NAME_MAX.
 *  Acronyms and words with inner capitals keep their shape ("RLS", "UsageChart").
 *  Empty when the task has nothing usable. */
export function nameFromTask(task: string): string {
  const picked: string[] = []
  for (const raw of task.split(/[^\p{L}\p{N}-]+/u)) {
    const word = raw.replace(/^-+|-+$/g, '')
    const lower = word.toLowerCase()
    if (word.length < 2 || /^\d+$/.test(word) || SKIP.has(lower)) continue
    if (picked.some((p) => p.toLowerCase() === lower)) continue
    picked.push(/[A-Z]/.test(word.slice(1)) ? word : word[0].toUpperCase() + word.slice(1).toLowerCase())
    if (picked.length === 3) break
  }
  let name = ''
  for (const w of picked) {
    const next = name ? `${name} ${w}` : w
    if (next.length > NAME_MAX) break
    name = next
  }
  return cleanName(name || (picked[0] ?? ''))
}

/** `name`, or `name 2`, `name 3`… when the workspace already has it
 *  (compared without case). Still within NAME_MAX. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`
    const candidate = `${name.slice(0, NAME_MAX - suffix.length).trim()}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

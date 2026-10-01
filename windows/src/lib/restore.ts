// Restore planning (pure): which sessions resume, and which must fork.
import type { SessionMeta } from '../types'

/** Sessions sharing one Claude conversation: the most recently active resumes
 *  it; the others resume into forks so no two processes write one history. */
export function forksNeeded(pending: SessionMeta[]): Set<string> {
  const byConv = new Map<string, SessionMeta[]>()
  for (const s of pending) {
    if (s.kind !== 'claude' || !s.claudeSessionId) continue
    byConv.set(s.claudeSessionId, [...(byConv.get(s.claudeSessionId) ?? []), s])
  }
  const forks = new Set<string>()
  for (const group of byConv.values()) {
    group.sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(1).forEach((s) => forks.add(s.id))
  }
  return forks
}

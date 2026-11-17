// Shared by the tools Claude sessions call (app/agent.ts, app/agentApps.ts):
// the reply shape, the person's say on anything risky, and finding sessions
// and workspaces by the names Claude knows them by.
import { clearAgentAsk, showAgentAsk } from '../state/commands/ui'
import { type AgentAsk, getState } from '../state/store'
import type { SessionMeta } from '../types'

export interface Reply {
  ok: boolean
  text: string
}

export const ok = (text: string): Reply => ({ ok: true, text })
export const fail = (text: string): Reply => ({ ok: false, text })

/** Who is calling, and which call this is (the dialog answers by it). */
export interface Ctx {
  callId: number
  caller: SessionMeta
}

export type Args = Record<string, unknown>

/** The dialog gives up a little before Rust stops waiting (agent.rs ASK_WAIT). */
const ASK_TIMEOUT_MS = 290_000
const answers = new Map<number, (answer: Answer) => void>()

/** What the person said: yes, no, or nothing before the dialog gave up. */
export type Answer = 'yes' | 'no' | 'none'

/** Shows the request in AgentAskDialog and waits for an answer. One at a
 *  time: callers check `asking()` first and tell Claude to try again. */
export function askPerson(ask: AgentAsk): Promise<Answer> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (getState().ui.agentAsk?.callId === ask.callId) clearAgentAsk()
      settle('none')
    }, ASK_TIMEOUT_MS)
    const settle = (answer: Answer) => {
      clearTimeout(timer)
      answers.delete(ask.callId)
      resolve(answer)
    }
    answers.set(ask.callId, settle)
    showAgentAsk(ask)
  })
}

export const asking = () => !!getState().ui.agentAsk
export const BUSY = fail('Konscious is already asking the person about something else. Try again in a moment.')

/** The dialog's buttons (and Escape, which is No). */
export function answerAgentAsk(yes: boolean) {
  const ask = getState().ui.agentAsk
  if (!ask) return
  clearAgentAsk()
  answers.get(ask.callId)?.(yes ? 'yes' : 'no')
}

/** For Claude when the person said no, or didn't answer at all. */
export function notDone(answer: Exclude<Answer, 'yes'>, what: string): Reply {
  return answer === 'no'
    ? ok(`The person chose not to ${what}. Don’t ask again unless they bring it up.`)
    : ok(`The person didn’t answer, so Konscious didn’t ${what}. Ask again if they still want it.`)
}

/** An exact name first (any case), then a partial one if only one fits.
 *  A string is the reason nothing was picked, written for Claude. */
export function pickByName<T extends { name: string }>(items: readonly T[], name: unknown, what: string): T | string {
  const want = typeof name === 'string' ? name.trim().toLowerCase() : ''
  const all = items.map((i) => `“${i.name}”`).join(', ')
  if (!want) return `Give the ${what}’s name.${all ? ` There are: ${all}.` : ''}`
  const exact = items.filter((i) => i.name.toLowerCase() === want)
  if (exact.length === 1) return exact[0]
  const partial = items.filter((i) => i.name.toLowerCase().includes(want))
  if (!exact.length && partial.length === 1) return partial[0]
  if (exact.length > 1 || partial.length > 1) return `More than one ${what} matches “${String(name)}”. Use the full name.`
  return `No ${what} called “${String(name)}”.${all ? ` There are: ${all}.` : ''}`
}

export const sessionsIn = (workspaceId: string): SessionMeta[] =>
  Object.values(getState().workspace.sessions).filter((m) => m.workspaceId === workspaceId)

/** Plain text for Claude: no control characters, bounded length. */
export const plain = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : ''

/** A whole number within bounds, or null. */
export function wholeIn(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
}

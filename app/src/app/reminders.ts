// The one timer behind the reminders.
//
// A reminder is state, not a timer: lib/apps.ts decides from the clock whether
// a nudge is owed. This checks that every few seconds and writes only when a
// nudge actually crosses into being due — so the action log sees one entry per
// nudge, not one per tick. The notification goes out at the same moment, once.
import { appById, isDue, pomoNotice, pomoOver } from '../lib/apps'
import { ipc } from '../lib/ipc'
import { repaintIfDue } from './actions'
import { advancePomo, markDue, setNotifyAllowed } from '../state/commands/apps'
import { getState } from '../state/store'

/** A pomodoro phase must not end late, so the tick is a second. The work
 *  in it is a few comparisons, and it writes only when something crosses. */
const TICK_MS = 1000

const REMINDERS = ['water', 'stand'] as const

/** True while any session is waiting for the user: a nudge holds, briefly. */
function sessionWaiting(): boolean {
  const s = getState()
  return Object.values(s.runtime.bySession).some((r) => r.status === 'waiting')
}

function tick(now = Date.now()) {
  // The warm schedule crosses its boundaries unattended; this follows them.
  repaintIfDue()
  const s = getState()
  const waiting = sessionWaiting()

  // A pomodoro phase that has run out hands over to the next one, and says so
  // once. A break follows focus; focus follows a break.
  if (s.ui.apps.on.pomo && pomoOver(s.ui.apps.pomo, now)) {
    const ended = s.ui.apps.pomo.phase
    advancePomo(now)
    if (s.ui.notifyAllowed && ended !== 'idle') {
      const said = pomoNotice(ended, s.ui.apps.pomoSet)
      ipc.notify(said.title, said.body)
    }
  }

  for (const id of REMINDERS) {
    if (!s.ui.apps.on[id]) continue
    const state = s.ui.apps.reminders[id]
    if (state.dueAt !== null) continue // already due; it does not stack
    if (!isDue({ every: s.ui.apps.every[id], state, sessionWaiting: waiting, now })) continue
    markDue(id, now)
    const app = appById(id)
    // One notification per nudge. The dock shows it either way.
    if (s.ui.notifyAllowed) ipc.notify(app.name, app.desc)
  }
}

export function startReminders() {
  void ipc.notifyAllowed().then(setNotifyAllowed)
  tick()
  const timer = setInterval(() => tick(), TICK_MS)
  return () => clearInterval(timer)
}

/** Asked once, the first time an app is switched on. */
export async function askNotifyOnce(): Promise<boolean> {
  const s = getState()
  if (s.ui.notifyAllowed) return true
  if (s.ui.apps.asked) return false
  const { markAsked } = await import('../state/commands/apps')
  markAsked()
  const granted = await ipc.notifyAsk()
  setNotifyAllowed(granted)
  return granted
}

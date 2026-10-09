// The one timer behind the reminders.
//
// A reminder is state, not a timer: lib/apps.ts decides from the clock whether
// a nudge is owed. This checks that every few seconds and writes only when a
// nudge actually crosses into being due — so the action log sees one entry per
// nudge, not one per tick.
//
// Every nudge leaves through announce(), which is the single choke point: one
// island alert, one system notification, and neither of them twice. The
// island matters because a system notification can be refused — macOS may
// never have been asked, or may have been told no — and then the dock is the
// only place a reminder lands, which is not somewhere you are looking. The
// island is inside our own window, so it cannot be turned off. Its one honest
// limit is that it is invisible while the window is.
import { appById, isDue, pomoNotice, pomoOver } from '../lib/apps'
import { play } from '../lib/chime'
import { type IslandApp, PHASE_ALERT_MS } from '../lib/island'
import { ipc } from '../lib/ipc'
import { repaintIfDue } from './actions'
import { pollSitting } from './sitting'
import { advancePomo, markDue, setNotifyAllowed } from '../state/commands/apps'
import { pushIsland } from '../state/commands/island'
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

/**
 * One nudge, said once, in every place it should be said.
 *
 * The island is opt-in per app and works without any system permission; the
 * notification needs one and may not have it. Either can be missing; the two
 * together are why a reminder is never silently lost.
 */
export function announce(app: IslandApp, title: string, body: string, ttlMs?: number) {
  const s = getState()
  if (s.ui.apps.island[app]) pushIsland({ app, title, body, ...(ttlMs === undefined ? {} : { ttlMs }) })
  if (s.ui.notifyAllowed) ipc.notify(title, body)
  // Once per nudge, whichever of the above happened. A nudge that showed in
  // three places and chimed three times would be the thing you switch off.
  if (s.ui.apps.sound) play()
}

function tick(now = Date.now()) {
  // The warm schedule crosses its boundaries unattended; this follows them.
  repaintIfDue()
  const s = getState()
  const waiting = sessionWaiting()

  // Sitting measures rather than counts down, so it asks the system how long
  // since your last key or click. It paces itself; this only offers it the
  // tick, so there is still one timer in the app.
  pollSitting(now)

  // A pomodoro phase that has run out hands over to the next one, and says so
  // once. A break follows focus; focus follows a break. The alert is brief
  // because the phase it starts is itself a live activity in the island.
  if (s.ui.apps.on.pomo && pomoOver(s.ui.apps.pomo, now)) {
    const ended = s.ui.apps.pomo.phase
    advancePomo(now)
    if (ended !== 'idle') {
      const said = pomoNotice(ended, s.ui.apps.pomoSet)
      announce('pomo', said.title, said.body, PHASE_ALERT_MS)
    }
  }

  for (const id of REMINDERS) {
    if (!s.ui.apps.on[id]) continue
    const state = s.ui.apps.reminders[id]
    if (state.dueAt !== null) continue // already due; it does not stack
    if (!isDue({ every: s.ui.apps.every[id], state, sessionWaiting: waiting, now })) continue
    markDue(id, now)
    const app = appById(id)
    announce(id, app.name, app.desc)
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

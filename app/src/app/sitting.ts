// The sitting tracker's poller.
//
// lib/sitting.ts decides what one poll means; this is the part that has to
// talk to the OS and the clock. It keeps the last poll's time in a module
// variable rather than in the store, like lib/terminals.ts does: it changes
// every fifteen seconds, nothing renders from it, and a committed action per
// poll would be noise in the log.
import { advance, POLL_MS, sitNotice, streakMs } from '../lib/sitting'
import { ipc } from '../lib/ipc'
import { announce } from './reminders'
import { applySit } from '../state/commands/apps'
import { getState } from '../state/store'

/** When we last got an answer. Null means we have no gap to account for —
 *  the first poll, or the app having just been switched on. */
let last: number | null = null
/** One in flight at a time: the tick comes every second, the poll every
 *  fifteen, and a slow answer must not start a queue. */
let asking = false
/** Set once the platform says it cannot tell us. Then we stop asking, rather
 *  than make the same failing call every fifteen seconds forever. */
let supported = true

/** Offered the tick every second; does something about once in fifteen. */
export function pollSitting(now = Date.now()) {
  if (!supported || asking) return
  if (!getState().ui.apps.on.sit) {
    // Switched off. Forget the gap, so switching it back on starts clean
    // instead of reading the time it spent off as time in the chair.
    last = null
    return
  }
  if (last !== null && now - last < POLL_MS) return
  asking = true
  void ipc
    .systemIdleSecs()
    .then((idleSec) => {
      if (idleSec === null) {
        supported = false
        return
      }
      // The tick's clock throughout, not a fresh reading after the await. The
      // gap between polls is the difference between two of these, so they
      // have to come from the same place or the arithmetic drifts by however
      // long the call happened to take.
      const { state, alert } = advance({ state: getState().ui.apps.sit, idleSec, now, last })
      last = now
      applySit(state)
      if (alert) {
        const said = sitNotice(streakMs(state, now))
        announce('sit', said.title, said.body)
      }
    })
    .catch(() => {
      // A failed call leaves `last` alone: the gap keeps growing, and once it
      // is longer than we can account for the streak ends, which is the
      // honest outcome of not having measured.
    })
    .finally(() => {
      asking = false
    })
}

/** Tests need the module to forget what it has seen. */
export function resetSittingPoll() {
  last = null
  asking = false
  supported = true
}

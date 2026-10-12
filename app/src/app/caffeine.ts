// Logging a drink, and the two things worth saying about it.
//
// The nudges belong here rather than in the tick because nothing about
// caffeine changes on its own: the day's total only moves when you log
// something, so the crossing can only happen on a tap.
import { halfGoneAt, mg, overLimit, pastCutoff, todayTotal } from '../lib/caffeine'
import { clock } from '../lib/format'
import { announce } from './reminders'
import { addDose } from '../state/commands/apps'
import { getState } from '../state/store'

/**
 * A drink, logged — and at most one thing said about it.
 *
 * Going over the day's limit is the more useful of the two warnings, so when
 * a cup does both it is the one that goes out. One nudge per tap, like every
 * other app here.
 */
export function logCaffeine(amount: number, now = Date.now()) {
  const was = getState().ui.apps.caff
  const wasOver = overLimit(was.log, now, was.limitMg)
  addDose(amount, now)
  const caff = getState().ui.apps.caff

  if (!wasOver && overLimit(caff.log, now, caff.limitMg)) {
    announce(
      'caff',
      'Over your caffeine limit',
      `${mg(todayTotal(caff.log, now))} today, past the ${mg(caff.limitMg)} you set.`,
    )
    return
  }
  if (pastCutoff(now, caff.cutoffMin)) {
    announce('caff', 'That one will still be with you', `About half of it is still in you at ${clock(halfGoneAt(now))}.`)
  }
}

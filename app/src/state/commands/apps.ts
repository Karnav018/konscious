// Mini app commands. The rules are pure functions in lib/apps.ts; these put
// their results into the committed state.
import {
  acknowledged,
  type AppId,
  type Edge,
  freshPomo,
  freshReminder,
  type MetricKey,
  pomoAdvance,
  type PomoState,
  skipped,
  snoozed,
  startFocus,
  stopPomo,
} from '../../lib/apps'
import { act } from '../act'
import { getState } from '../store'

type ReminderId = 'water' | 'stand'

export const setDockPlace = (edge: Edge, along: number) =>
  act('apps/dockPlace', (d) => {
    d.ui.apps.edge = edge
    d.ui.apps.along = along
  })

export const setAutoMinimise = (on: boolean) => act('apps/autoMinimise', (d) => void (d.ui.apps.autoMinimise = on))

/** Switching an app on starts its interval from now, so the first nudge is a
 *  full interval away rather than immediate. */
export const setAppOn = (id: AppId, on: boolean, now = Date.now()) =>
  act('apps/setOn', (d) => {
    d.ui.apps.on[id] = on
    if (on && (id === 'water' || id === 'stand')) d.ui.apps.reminders[id] = freshReminder(now)
    if (!on && d.ui.appPopover === id) d.ui.appPopover = null
  })

/** Hiding an app from the dock is not turning it off, which the catalog says. */
export const setAppPinned = (id: AppId, pinned: boolean) =>
  act('apps/setPinned', (d) => {
    d.ui.apps.pinned[id] = pinned
    if (!pinned && d.ui.appPopover === id) d.ui.appPopover = null
  })

export const setAppPopover = (id: AppId | null) => act('apps/popover', (d) => void (d.ui.appPopover = id))
export const setAppPanel = (panel: AppId | 'catalog' | null) =>
  act('apps/panel', (d) => {
    d.ui.appPanel = panel
    d.ui.appPopover = null
  })

export const setNotifyAllowed = (allowed: boolean) =>
  act('apps/notifyAllowed', (d) => void (d.ui.notifyAllowed = allowed))
export const markAsked = () => act('apps/asked', (d) => void (d.ui.apps.asked = true))

/** A nudge has come due: remembered so it stays due until it is dealt with,
 *  and so the notification goes out exactly once. */
export const markDue = (id: ReminderId, at: number) =>
  act('apps/due', (d) => {
    if (d.ui.apps.reminders[id].dueAt === null) d.ui.apps.reminders[id].dueAt = at
  })

/** "Had a glass" / "Done": the interval restarts from the tap. */
export function acknowledge(id: ReminderId, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10)
  const fresh = getState().ui.apps.glassesOn !== today
  act('apps/acknowledge', (d) => {
    d.ui.apps.reminders[id] = acknowledged(now)
    if (id === 'water') {
      d.ui.apps.glasses = (fresh ? 0 : d.ui.apps.glasses) + 1
      d.ui.apps.glassesOn = today
    }
    d.ui.appPopover = null
  })
}

export function snooze(id: ReminderId, now = Date.now()) {
  const minutes = getState().ui.apps.snoozeMin
  act('apps/snooze', (d) => {
    d.ui.apps.reminders[id] = snoozed(d.ui.apps.reminders[id], minutes, now)
    d.ui.appPopover = null
  })
}

/** "Skip this one": nothing counted, but a full interval before the next. */
export const skip = (id: ReminderId, now = Date.now()) =>
  act('apps/skip', (d) => {
    d.ui.apps.reminders[id] = skipped(now)
    d.ui.appPopover = null
  })

export const setEvery = (id: ReminderId, minutes: number) =>
  act('apps/setEvery', (d) => void (d.ui.apps.every[id] = Math.min(600, Math.max(1, Math.round(minutes)))))

export const setSnoozeMin = (minutes: number) =>
  act('apps/setSnooze', (d) => void (d.ui.apps.snoozeMin = Math.min(120, Math.max(1, Math.round(minutes)))))

/* ── pomodoro ─────────────────────────────────────────────────────── */

export const startPomo = (now = Date.now()) =>
  act('apps/pomoStart', (d) => {
    d.ui.apps.pomo = startFocus(d.ui.apps.pomoSet, d.ui.apps.pomo, now)
  })

export const stopPomoTimer = () => act('apps/pomoStop', (d) => void (d.ui.apps.pomo = stopPomo(d.ui.apps.pomo)))

/** A phase ran out: the next one starts itself. */
export const advancePomo = (now = Date.now()) =>
  act('apps/pomoAdvance', (d) => {
    d.ui.apps.pomo = pomoAdvance(d.ui.apps.pomo, d.ui.apps.pomoSet, now)
  })

/** Changing a length while a phase runs restarts it, so the tile never shows
 *  a ring measured against a length that is no longer set. */
export function setPomoLength(which: 'focusMin' | 'breakMin', minutes: number, now = Date.now()) {
  act('apps/pomoLength', (d) => {
    d.ui.apps.pomoSet[which] = Math.min(600, Math.max(1, Math.round(minutes)))
    const running: PomoState = d.ui.apps.pomo
    if (running.phase === 'focus' && which === 'focusMin') d.ui.apps.pomo = startFocus(d.ui.apps.pomoSet, running, now)
    if (running.phase === 'break' && which === 'breakMin') {
      d.ui.apps.pomo = { ...running, endsAt: now + d.ui.apps.pomoSet.breakMin * 60_000 }
    }
  })
}

/** Today's tally, cleared from the app's own settings. */
export const resetPomoRounds = () => act('apps/pomoReset', (d) => void (d.ui.apps.pomo = freshPomo()))

/** Picking a stat stops the gauge cycling; picking it again resumes. */
export const pinStat = (key: MetricKey | null) => act('apps/pinStat', (d) => void (d.ui.apps.statPinned = key))

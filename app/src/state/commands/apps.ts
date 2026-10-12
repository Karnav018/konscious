// Mini app commands. The rules are pure functions in lib/apps.ts; these put
// their results into the committed state.
import type { Draft } from 'immer'

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
import { freshCaff, MAX_MG, withDose } from '../../lib/caffeine'
import { dayKey } from '../../lib/format'
import { type IslandApp, withoutApp } from '../../lib/island'
import { type SitState, withoutStreak } from '../../lib/sitting'
import { act } from '../act'
import { type AppState, getState } from '../store'

type ReminderId = 'water' | 'stand'

/** Dealt with: the app's nudge leaves the notch island too. The dock popover
 *  and the island call the same commands, so clearing belongs here rather
 *  than in either of them. */
function dealtWith(d: Draft<AppState>, app: IslandApp) {
  const gone = d.ui.island.events.filter((e) => e.app === app).map((e) => e.id)
  d.ui.island.events = withoutApp(d.ui.island.events, app)
  if (d.ui.island.expanded && gone.includes(d.ui.island.expanded)) d.ui.island.expanded = null
}

export const setDockPlace = (edge: Edge, along: number) =>
  act('apps/dockPlace', (d) => {
    d.ui.apps.edge = edge
    d.ui.apps.along = along
  })

export const setSound = (on: boolean) => act('apps/sound', (d) => void (d.ui.apps.sound = on))

export const setAutoMinimise = (on: boolean) => act('apps/autoMinimise', (d) => void (d.ui.apps.autoMinimise = on))

/** Switching an app on starts its interval from now, so the first nudge is a
 *  full interval away rather than immediate. */
export const setAppOn = (id: AppId, on: boolean, now = Date.now()) =>
  act('apps/setOn', (d) => {
    d.ui.apps.on[id] = on
    if (on && (id === 'water' || id === 'stand')) d.ui.apps.reminders[id] = freshReminder(now)
    if (!on) {
      if (d.ui.appPopover === id) d.ui.appPopover = null
      dealtWith(d, id)
    }
  })

/** Hiding an app from the dock is not turning it off, which the catalog says. */
export const setAppPinned = (id: AppId, pinned: boolean) =>
  act('apps/setPinned', (d) => {
    d.ui.apps.pinned[id] = pinned
    if (!pinned && d.ui.appPopover === id) d.ui.appPopover = null
  })

export const setAppPopover = (id: AppId | null) =>
  act('apps/popover', (d) => {
    d.ui.appPopover = id
    if (id) d.ui.layoutMenu = false
  })
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
  // The local day, not the UTC one. toISOString() here meant the count
  // rolled over at 05:30 for anyone in IST, and a glass at 01:00 was filed
  // under the previous day.
  const today = dayKey(now)
  const fresh = getState().ui.apps.glassesOn !== today
  act('apps/acknowledge', (d) => {
    d.ui.apps.reminders[id] = acknowledged(now)
    dealtWith(d, id)
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
    dealtWith(d, id)
    d.ui.appPopover = null
  })
}

/** "Skip this one": nothing counted, but a full interval before the next. */
export const skip = (id: ReminderId, now = Date.now()) =>
  act('apps/skip', (d) => {
    d.ui.apps.reminders[id] = skipped(now)
    dealtWith(d, id)
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

export const stopPomoTimer = () =>
  act('apps/pomoStop', (d) => {
    d.ui.apps.pomo = stopPomo(d.ui.apps.pomo)
    dealtWith(d, 'pomo')
  })

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

/* ── caffeine ─────────────────────────────────────────────────────── */

/** A drink, logged now. The log is trimmed to a rolling day as it goes in. */
export const addDose = (mg: number, now = Date.now()) =>
  act('apps/caffDose', (d) => {
    const amount = Math.min(MAX_MG, Math.max(1, Math.round(mg)))
    d.ui.apps.caff.log = withDose(d.ui.apps.caff.log, amount, now)
  })

export const setCaffLimit = (mg: number) =>
  act('apps/caffLimit', (d) => void (d.ui.apps.caff.limitMg = Math.min(2000, Math.max(50, Math.round(mg)))))

export const setCaffCutoff = (minutes: number) =>
  act('apps/caffCutoff', (d) => void (d.ui.apps.caff.cutoffMin = Math.min(1439, Math.max(0, Math.round(minutes)))))

/** "I logged that by mistake": the last drink goes. */
export const undoDose = () =>
  act('apps/caffUndo', (d) => {
    d.ui.apps.caff.log = d.ui.apps.caff.log.slice(0, -1)
    dealtWith(d, 'caff')
  })

/** Clears the log, keeping the limit and the cutoff. */
export const resetCaff = () =>
  act('apps/caffReset', (d) => {
    d.ui.apps.caff = { ...freshCaff(), limitMg: d.ui.apps.caff.limitMg, cutoffMin: d.ui.apps.caff.cutoffMin }
    dealtWith(d, 'caff')
  })

/* ── sitting ──────────────────────────────────────────────────────── */

/** The result of one poll, from lib/sitting's pure advance(). */
export const applySit = (next: SitState) => act('apps/sit', (d) => void (d.ui.apps.sit = next))

export const setSitAlertMin = (minutes: number) =>
  act('apps/sitAlert', (d) => void (d.ui.apps.sit.alertMin = Math.min(600, Math.max(5, Math.round(minutes)))))

/** "Up now": ends the streak by hand, so the next nudge is a full threshold
 *  away rather than arriving again in a minute. */
export const standNow = () =>
  act('apps/sitUp', (d) => {
    d.ui.apps.sit = withoutStreak(d.ui.apps.sit)
    dealtWith(d, 'sit')
  })

/** Today's tally and the longest stretch, cleared from the app's settings. */
export const resetSit = () =>
  act('apps/sitReset', (d) => {
    d.ui.apps.sit = { ...withoutStreak(d.ui.apps.sit), todayMs: 0, longestMs: 0 }
    dealtWith(d, 'sit')
  })

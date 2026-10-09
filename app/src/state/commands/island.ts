// Notch island commands. The rules are pure functions in lib/island.ts; these
// put their results into the committed state.
//
// Nothing here is persisted: an alert is news, and news does not survive a
// restart. The per-app switches live in apps.island, which is saved.
import { type IslandApp, type IslandEvent, islandId, withoutApp, withoutId, withPushed } from '../../lib/island'
import { act } from '../act'

/** An alert from an app. An earlier one from the same app is replaced, not
 *  queued behind: the same rule that stops reminders stacking. */
export function pushIsland(
  e: { app: IslandApp; kind?: IslandEvent['kind']; title: string; body?: string; ttlMs?: number },
  now = Date.now(),
) {
  const event: IslandEvent = {
    id: islandId(e.app, now),
    app: e.app,
    kind: e.kind ?? 'alert',
    title: e.title,
    ...(e.body ? { body: e.body } : {}),
    ...(e.ttlMs !== undefined ? { ttlMs: e.ttlMs } : {}),
    at: now,
  }
  act('island/push', (d) => {
    d.ui.island.events = withPushed(d.ui.island.events, event)
    // A new alert takes the island; whatever was pinned open is no longer it.
    d.ui.island.expanded = null
  })
}

/** The × on an activity: this one goes, the others stay. */
export const dismissIsland = (id: string) =>
  act('island/dismiss', (d) => {
    d.ui.island.events = withoutId(d.ui.island.events, id)
    if (d.ui.island.expanded === id) d.ui.island.expanded = null
  })

/** Clicked: holds the activity open and shows its actions. */
export const expandIsland = (id: string | null) =>
  act('island/expand', (d) => void (d.ui.island.expanded = id))

/** "Show in notch", per app. */
export const setAppIsland = (app: IslandApp, on: boolean) =>
  act('island/setOn', (d) => {
    d.ui.apps.island[app] = on
    if (!on) d.ui.island.events = withoutApp(d.ui.island.events, app)
  })

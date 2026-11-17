// Notch island commands. The rules are pure functions in lib/island.ts; these
// put their results into the committed state.
//
// Nothing here is persisted: an alert is news, and news does not survive a
// restart. The per-app switches live in apps.island, which is saved.
import { type IslandApp, type IslandEvent, islandId, withoutApp, withoutId, withPushed } from '../../lib/island'
import { act } from '../act'

/** An alert from an app. An earlier one from the same app is replaced, not
 *  queued behind: the same rule that stops reminders stacking. A pinned shelf
 *  stays pinned — the new row simply arrives at the top of it. */
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
  })
}

/** The × on an alert: this one goes, the others stay. */
export const dismissIsland = (id: string) =>
  act('island/dismiss', (d) => void (d.ui.island.events = withoutId(d.ui.island.events, id)))

/** A click holds the shelf open; a second click, Escape or a click elsewhere
 *  lets it fold again. */
export const pinIsland = (on: boolean) => act('island/pin', (d) => void (d.ui.island.pinned = on))

/** "Show in notch", per app. */
export const setAppIsland = (app: IslandApp, on: boolean) =>
  act('island/setOn', (d) => {
    d.ui.apps.island[app] = on
    if (!on) d.ui.island.events = withoutApp(d.ui.island.events, app)
  })

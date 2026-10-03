// UI commands: named, so the action log reads like what the user did.
import type { EnvInfo, InitInfo, Limits, Suggestion, Theme } from '../../types'
import { withAttached } from '../../lib/attach'
import type { Place } from '../../lib/sun'
import type { WarmWhen } from '../../lib/warmth'
import { act } from '../act'
import { getState, type NewSessionDraft, type PersistStatus, type SettingsMenu, type UpdateState, type WsFilter } from '../store'

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function flash(message: string) {
  act('ui/toast', (d) => {
    d.ui.toast = message
  })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => act('ui/toastClear', (d) => void (d.ui.toast = null)), 1800)
}

export const setBooted = () => act('app/booted', (d) => void (d.ui.booted = true))
export const setInit = (init: InitInfo) => act('app/init', (d) => void (d.ui.init = init))
export const setEnv = (env: EnvInfo) => act('app/env', (d) => void (d.ui.env = env))
export const setEnvError = (message: string) => act('app/envError', (d) => void (d.ui.envError = message))
export const setSuggestions = (s: Suggestion[]) => act('app/suggestions', (d) => void (d.ui.suggestions = s))
export const setFullscreen = (on: boolean) => act('window/fullscreen', (d) => void (d.ui.fullscreen = on))
export const setThemeValue = (theme: Theme) => act('ui/theme', (d) => void (d.ui.theme = theme))
/** The warm-colours setting. `kelvin` is kept while it is switched off, so the
 *  slider comes back where it was left. */
export const setWarmValue = (on: boolean, kelvin?: number) =>
  act('ui/warmth', (d) => {
    d.ui.warm = on
    if (kelvin !== undefined) d.ui.warmth = kelvin
  })
/** All the time, between hours you set, or sunset to sunrise. */
export const setWarmWhenValue = (when: WarmWhen) => act('ui/warmWhen', (d) => void (d.ui.warmWhen = when))
export const setWarmHoursValue = (fromMin: number, toMin: number) =>
  act('ui/warmHours', (d) => {
    const clamp = (n: number) => Math.min(1439, Math.max(0, Math.round(n)))
    d.ui.warmFrom = clamp(fromMin)
    d.ui.warmTo = clamp(toMin)
  })
export const setWarmPlaceValue = (place: Place | null) => act('ui/warmPlace', (d) => void (d.ui.warmPlace = place))
/** A manual flip that stands until the schedule next changes its mind. */
export const setWarmOverride = (held: { on: boolean; until: number } | null) =>
  act('ui/warmOverride', (d) => void (d.ui.warmOverride = held))

/** Opens the settings popover (or the newest feature's), or closes it when
 *  the same one is already open. */
export const toggleSettingsMenu = (which: SettingsMenu) =>
  act('ui/settingsMenu', (d) => {
    d.ui.settingsMenu = d.ui.settingsMenu === which ? null : which
    d.ui.wsMenu = false
    d.ui.paneMenu = null
  })
/** Fires for every pointer move of a file drag: only a change is a write. */
export function setFileDrop(id: string | null) {
  if (getState().ui.fileDrop !== id) act('ui/fileDrop', (d) => void (d.ui.fileDrop = id))
}
export const closeSettingsMenu = () => act('ui/closeSettingsMenu', (d) => void (d.ui.settingsMenu = null))
export function setLimits(limits: Limits, observedAt = Date.now(), live = true) {
  act(live ? 'usage/limits' : 'usage/limitsRestored', (d) => {
    d.ui.limits = limits
    d.ui.limitsAt = observedAt
    d.ui.limitsLive = live
  })
}
export const setPersistStatus = (p: PersistStatus) => act(`persist/${p.state}`, (d) => void (d.ui.persist = p))
export const setUpdate = (update: UpdateState) => act(`update/${update.state}`, (d) => void (d.ui.update = update))

export function toggleWorkspaceMenu(hover: string | null) {
  act('ui/workspaceMenu', (d) => {
    d.ui.wsMenu = !d.ui.wsMenu
    d.ui.wsHover = hover
    d.ui.inspector = false
    d.ui.paneMenu = null
    d.ui.settingsMenu = null
  })
}
export const hoverWorkspace = (id: string) => act('ui/hoverWorkspace', (d) => void (d.ui.wsHover = id))
export const setWsFilter = (f: WsFilter) => act('ui/wsFilter', (d) => void (d.ui.wsFilter = f))
export const closeWorkspaceMenu = () => act('ui/closeWorkspaceMenu', (d) => void (d.ui.wsMenu = false))

export function setInspector(open: boolean, renaming = false) {
  act('ui/inspector', (d) => {
    d.ui.inspector = open
    d.ui.renaming = open && renaming
    d.ui.wsMenu = false
    d.ui.paneMenu = null
    d.ui.settingsMenu = null
  })
}
export const toggleInspector = (open: boolean) => setInspector(!open)
export const setRenaming = (on: boolean) => act('ui/renaming', (d) => void (d.ui.renaming = on))

export const attachFiles = (id: string, paths: string[]) =>
  act('ui/attach', (d) => {
    d.ui.attachments[id] = withAttached(d.ui.attachments[id] ?? [], paths)
  })
export const clearAttachments = (id: string) =>
  act('ui/attachClear', (d) => {
    delete d.ui.attachments[id]
  })

export const setPaneMenu = (id: string | null) => act('ui/paneMenu', (d) => void (d.ui.paneMenu = id))

export function openNewSessionDraft(draft: NewSessionDraft) {
  act('ui/newSession', (d) => {
    d.ui.newSession = draft
    d.ui.wsMenu = false
    d.ui.paneMenu = null
    d.ui.inspector = false
  })
}
export function updateNewSessionDraft(patch: Partial<NewSessionDraft>) {
  act('ui/newSessionEdit', (d) => {
    if (d.ui.newSession) Object.assign(d.ui.newSession, patch)
  })
}
export const closeNewSession = () => act('ui/newSessionClose', (d) => void (d.ui.newSession = null))

export const askDeleteSession = (id: string) =>
  act('ui/confirmDelete', (d) => {
    d.ui.confirmDelete = id
    d.ui.paneMenu = null
  })
export const cancelDeleteSession = () => act('ui/confirmDeleteCancel', (d) => void (d.ui.confirmDelete = null))

export function closeOverlays() {
  act('ui/closeOverlays', (d) => {
    d.ui.confirmDelete = null
    d.ui.wsMenu = false
    d.ui.inspector = false
    d.ui.paneMenu = null
    d.ui.settingsMenu = null
    d.ui.newSession = null
    d.ui.renaming = false
  })
}

// UI commands: named, so the action log reads like what the user did.
import type { EnvInfo, InitInfo, Limits, Suggestion, Theme } from '../../types'
import { act } from '../act'
import type { NewSessionDraft, PersistStatus, WsFilter } from '../store'

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
export function setLimits(limits: Limits, observedAt = Date.now(), live = true) {
  act(live ? 'usage/limits' : 'usage/limitsRestored', (d) => {
    d.ui.limits = limits
    d.ui.limitsAt = observedAt
    d.ui.limitsLive = live
  })
}
export const setPersistStatus = (p: PersistStatus) => act(`persist/${p.state}`, (d) => void (d.ui.persist = p))

export function toggleWorkspaceMenu(hover: string | null) {
  act('ui/workspaceMenu', (d) => {
    d.ui.wsMenu = !d.ui.wsMenu
    d.ui.wsHover = hover
    d.ui.inspector = false
    d.ui.paneMenu = null
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
  })
}
export const toggleInspector = (open: boolean) => setInspector(!open)
export const setRenaming = (on: boolean) => act('ui/renaming', (d) => void (d.ui.renaming = on))

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
    d.ui.newSession = null
    d.ui.renaming = false
  })
}

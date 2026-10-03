// The single root store. State is plain, serializable data only — no
// methods. Reads go through selectors (state/selectors.ts); every write goes
// through `act()` (state/act.ts) via the named commands in state/commands/.
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import type { AppId, Edge, MetricKey, PomoState, ReminderState } from '../lib/apps'
import { freshPomo, freshReminder } from '../lib/apps'
import { DEFAULT_K } from '../lib/warmth'
import type { EnvInfo, InitInfo, Kind, Layout, Limits, Runtime, SessionMeta, Suggestion, Theme, Workspace } from '../types'

export type WsFilter = 'all' | 'working' | 'waiting'

export interface NewSessionDraft {
  kind: Kind
  workspaceId: string
  name: string
  dir: string
}

/**
 * A background update (lib/update.ts). `ready` means a newer version is
 * downloaded and waiting: installing closes the app, so the restart is the
 * user's call, not ours.
 */
export type UpdateState =
  | { state: 'none' }
  | { state: 'downloading'; version: string; percent: number | null }
  | { state: 'ready'; version: string }
  | { state: 'installing'; version: string }

export type PersistStatus =
  | { state: 'ok' }
  | { state: 'error'; message: string }
  /** Files were written by a newer build: never overwrite them. */
  | { state: 'readonly'; message: string }

export interface WorkspaceState {
  workspaces: Workspace[]
  sessions: Record<string, SessionMeta>
  activeId: string | null
}

export interface LayoutState {
  byWorkspace: Record<string, Layout>
}

export interface RuntimeState {
  bySession: Record<string, Runtime>
}

export type SettingsMenu = 'all' | 'quick'

/** Mini apps: where the dock sits, which apps are on, and what each knows.
 *  Saved, apart from the panel that happens to be open. */
export interface AppsState {
  edge: Edge
  /** How far along that edge, 0–1. */
  along: number
  /** Tucked flush and shrunk to the Apps icon after 3s, or always shown. */
  autoMinimise: boolean
  on: Record<AppId, boolean>
  pinned: Record<AppId, boolean>
  /** Minutes between nudges, per reminder, as its settings set it. */
  every: Record<'water' | 'stand', number>
  snoozeMin: number
  /** Glasses counted, and the day they belong to, so the count resets. */
  glasses: number
  glassesOn: string
  /** Permission is asked once, the first time an app is switched on. */
  asked: boolean
  reminders: Record<'water' | 'stand', ReminderState>
  /** Pomodoro: how long each phase runs, and where it is now. */
  pomo: PomoState
  pomoSet: { focusMin: number; breakMin: number }
  /** A stat the user picked, which stops the gauge cycling. */
  statPinned: MetricKey | null
}

export interface UiState {
  booted: boolean
  init: InitInfo | null
  env: EnvInfo | null
  envError: string | null
  theme: Theme
  /** Warm colours for late sessions, and the temperature chosen for them. */
  warm: boolean
  warmth: number
  /** The settings popover: every setting ('all'), or just the newest
   *  feature's, opened from its title-bar button ('quick'). */
  settingsMenu: SettingsMenu | null
  /** The pane files are being dragged over (they paste there on drop). */
  fileDrop: string | null
  fontSize: number
  fullscreen: boolean
  suggestions: Suggestion[]
  wsMenu: boolean
  wsHover: string | null
  wsFilter: WsFilter
  inspector: boolean
  renaming: boolean
  paneMenu: string | null
  newSession: NewSessionDraft | null
  toast: string | null
  persist: PersistStatus
  /** A newer version downloaded in the background, waiting for a restart. */
  update: UpdateState
  /** Claude plan usage (5h / 7d), from the status-line feed. */
  limits: Limits | null
  /** When `limits` was observed (ms), and whether it came live this launch. */
  limitsAt: number | null
  limitsLive: boolean
  /** Paths dropped or pasted into each pane, newest last. Never saved:
   *  it is a record of what was typed, not something the app owns. */
  attachments: Record<string, string[]>
  apps: AppsState
  /** Which app's dock popover or panel is open. Never saved. */
  appPopover: AppId | null
  appPanel: AppId | 'catalog' | null
  /** Whether the system has allowed notifications, as last checked. */
  notifyAllowed: boolean
  /** Session awaiting typed "delete" confirmation. */
  confirmDelete: string | null
}

export interface AppState {
  workspace: WorkspaceState
  layout: LayoutState
  runtime: RuntimeState
  ui: UiState
}

export const initialState = (): AppState => ({
  workspace: { workspaces: [], sessions: {}, activeId: null },
  layout: { byWorkspace: {} },
  runtime: { bySession: {} },
  ui: {
    booted: false,
    init: null,
    env: null,
    envError: null,
    theme: 'dark',
    warm: false,
    warmth: DEFAULT_K,
    settingsMenu: null,
    fileDrop: null,
    fontSize: 12,
    fullscreen: false,
    suggestions: [],
    wsMenu: false,
    wsHover: null,
    wsFilter: 'all',
    inspector: false,
    renaming: false,
    paneMenu: null,
    newSession: null,
    toast: null,
    persist: { state: 'ok' },
    update: { state: 'none' },
    limits: null,
    limitsAt: null,
    limitsLive: false,
    apps: {
      edge: 'right',
      along: 0.5,
      autoMinimise: false,
      on: { water: false, stand: false, pomo: false, sys: false },
      pinned: { water: true, stand: true, pomo: true, sys: true },
      every: { water: 40, stand: 50 },
      snoozeMin: 10,
      glasses: 0,
      glassesOn: '',
      asked: false,
      reminders: { water: freshReminder(0), stand: freshReminder(0) },
      pomo: freshPomo(),
      pomoSet: { focusMin: 25, breakMin: 5 },
      statPinned: null,
    },
    appPopover: null,
    appPanel: null,
    notifyAllowed: false,
    attachments: {},
    confirmDelete: null,
  },
})

export const useApp = create<AppState>()(subscribeWithSelector(() => initialState()))

/** Current committed state (frozen). For commands and non-React code. */
export const getState = () => useApp.getState()

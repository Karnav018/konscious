// The single root store. State is plain, serializable data only — no
// methods. Reads go through selectors (state/selectors.ts); every write goes
// through `act()` (state/act.ts) via the named commands in state/commands/.
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

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

export interface UiState {
  booted: boolean
  init: InitInfo | null
  env: EnvInfo | null
  envError: string | null
  theme: Theme
  /** Warm colours for late sessions, and the temperature chosen for them. */
  warm: boolean
  warmth: number
  warmMenu: boolean
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
    warmMenu: false,
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
    confirmDelete: null,
  },
})

export const useApp = create<AppState>()(subscribeWithSelector(() => initialState()))

/** Current committed state (frozen). For commands and non-React code. */
export const getState = () => useApp.getState()

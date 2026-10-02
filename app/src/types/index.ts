export type Kind = 'claude' | 'shell'

/** Statuses Rust reports. */
export type RustStatus = 'starting' | 'working' | 'waiting' | 'idle' | 'completed' | 'failed'

/** UI status adds `stopped`: known to the workspace but not running this launch. */
export type Status = RustStatus | 'stopped'

export interface Workspace {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

/** Persisted per session — lightweight metadata only (PRD §27). */
export interface SessionMeta {
  id: string
  workspaceId: string
  name: string
  kind: Kind
  cwd: string
  claudeSessionId: string | null
  /** Running when the app quit (or last observed); auto-resumed on launch. */
  wasRunning: boolean
  /** Per-pane text size in px; null = automatic (fits the pane). */
  fontSize: number | null
  createdAt: number
  lastActiveAt: number
}

export type LayoutMode = 'grid' | 'focus'

export interface Layout {
  mode: LayoutMode
  /** Sessions shown in the grid, in display order (max 6). */
  open: string[]
  /** Most recently used first; drives least-recently-used eviction. */
  recent: string[]
  selected: string | null
}

export interface SessionInfo {
  id: string
  kind: Kind
  runId: number
  status: RustStatus
  running: boolean
  pid: number | null
  exitCode: number | null
  exitSignal: string | null
  hooksActive: boolean
  claudeSessionId: string | null
  cwd: string
  startedAt: number | null
  resumeFailed: boolean
  /** PTY size: the width output was produced at. */
  cols: number
  rows: number
}

export interface Attached extends SessionInfo {
  /** Bytes of history replayed on the new channel before live output. */
  replayBytes: number
}

export interface GitInfo {
  branch: string
  commit: string
}

/** From Claude's status-line feed (input-only tokens, Claude's formula). */
export interface ContextUsage {
  id: string
  pct: number | null
  used: number | null
  size: number | null
  model: string | null
}

export interface LimitWindow {
  pct: number
  /** Unix epoch seconds. */
  resetsAt: number | null
}

export interface Limits {
  fiveHour: LimitWindow | null
  sevenDay: LimitWindow | null
}

/** Runtime-only state; never persisted. */
export interface Runtime {
  status: Status
  runId: number
  running: boolean
  pid: number | null
  exitCode: number | null
  hooksActive: boolean
  startedAt: number | null
  lastActivityAt: number | null
  unread: boolean
  resumeFailed: boolean
  git: GitInfo | null
  context: ContextUsage | null
}

export interface EnvInfo {
  shell: string
  home: string
  claudePath: string | null
  claudeVersion: string | null
  source: string
}

export interface InitInfo {
  lockOk: boolean
  baseDir: string
  /** The data folder belongs to the previous version, which still runs. */
  previousVersion: boolean
  home: string
  version: string
}

export interface Snapshot {
  config: Record<string, unknown> | null
  workspaces: Record<string, unknown> | null
  layouts: Record<string, Record<string, unknown>>
  corrupt: string[]
  /** Recovered from a rolling backup after the main file was unreadable. */
  restored: string[]
}

export interface Suggestion {
  path: string
  name: string
  root: string
}

export type Theme = 'dark' | 'light'

/** What ⌘V pastes into a pane (clipboard_read). */
export interface Clipboard {
  /** Files copied in Finder, as absolute paths. */
  paths: string[]
  text: string | null
  /** A picture is on the clipboard (Claude Code reads it itself). */
  image: boolean
}

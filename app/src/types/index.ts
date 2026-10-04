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

/** Resident memory for a session's whole process tree (Claude's subagents and
 *  MCP servers included), measured by the engine. */
export interface SessionMemory {
  id: string
  bytes: number
  processes: number
}

/** This machine, for the dock's gauge. `tmp` is °C, or null when the
 *  platform will not report a component temperature. */
export interface Stats {
  cpu: number
  ram: number
  ssd: number
  tmp: number | null
  cores: number
  ramTotal: number
  ramUsed: number
  ssdTotal: number
  ssdUsed: number
}

/** A session as it travels in a bundle. */
export interface BundleSession {
  id: string
  name: string
  kind: Kind
  /** Its folder, as an offset from the workspace root. */
  relative: string
  /** It ran outside the workspace root, so import places it at the root. */
  outside: boolean
  claudeSessionId: string | null
  hasTranscript: boolean
}

/** What a bundle says about itself, read before anything is written. */
export interface BundleManifest {
  version: number
  app: string
  platform: string
  exportedAt: string
  workspaceName: string
  sourceRoot: string
  sessions: BundleSession[]
  layout: Layout
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
  /** Per-workspace notes files (notes/<id>.json). Absent from older builds. */
  notes?: Record<string, Record<string, unknown>>
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

/* ── notes ───────────────────────────────────────────────────────── */

/** One line of a workspace's Today list. */
export interface NoteTask {
  id: string
  text: string
  done: boolean
  /** The session it was sent to (links it; an @name in the text also does). */
  sessionId: string | null
}

export interface Notes {
  tasks: NoteTask[]
  scratch: string
}

/** Where saved notes go: kept in Konscious, a Markdown file in the project's
 *  notes/ folder, or a Markdown file in a folder the user picked. */
export type NotesDest = 'app' | 'repo' | 'other'

export interface NotesSavePref {
  dest: NotesDest
  /** File name without .md (unused for 'app'). */
  name: string
  /** The picked folder, for 'other'. */
  dir: string | null
}

/** Everything Konscious keeps about one workspace's notes (notes/<id>.json). */
export interface WorkspaceNotes {
  saved: Notes
  /** Edits not saved yet; kept across restarts. null: nothing unsaved. */
  draft: Notes | null
  /** "Always save here" for this workspace. */
  pref: NotesSavePref | null
  /** The last save: the file it went to (null: kept in Konscious). */
  lastSaved: { file: string | null; at: number } | null
}


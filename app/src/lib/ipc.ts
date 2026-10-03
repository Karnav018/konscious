// The only module that talks to Tauri. Everything else calls these wrappers.
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'

import { dropPoint } from './dropPoint'
import type {
  Attached,
  Clipboard,
  ContextUsage,
  Limits,
  EnvInfo,
  GitInfo,
  InitInfo,
  Kind,
  SessionInfo,
  SessionMemory,
  Snapshot,
  Suggestion,
} from '../types'

export type FileDrop =
  | { type: 'enter' | 'drop'; paths: string[]; x: number; y: number }
  | { type: 'over'; x: number; y: number }
  | { type: 'leave' }

export interface SessionSpec {
  id: string
  kind: Kind
  name: string
  cwd: string
  claudeSessionId: string | null
  /** Resume into a copy (`--fork-session`); one-shot. */
  fork?: boolean
}

export interface IpcError {
  kind: string
  message: string
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as IpcError).message)
  return String(e)
}

export { Channel }

export const ipc = {
  appInit: () => invoke<InitInfo>('app_init'),
  appEnv: () => invoke<EnvInfo>('app_env'),

  stateLoad: () => invoke<Snapshot>('state_load'),
  stateSave: (target: string, data: unknown) => invoke<void>('state_save', { target, data }),
  stateDeleteLayout: (id: string) => invoke<void>('state_delete_layout', { id }),

  sessionStart: (spec: SessionSpec, cols: number, rows: number, onOutput: Channel<ArrayBuffer>) =>
    invoke<SessionInfo>('session_start', { spec, cols, rows, onOutput }),
  sessionAttach: (id: string, onOutput: Channel<ArrayBuffer>) =>
    invoke<Attached>('session_attach', { id, onOutput }),
  sessionList: () => invoke<SessionInfo[]>('session_list'),
  sessionMemory: () => invoke<SessionMemory[]>('session_memory'),
  fileThumbnail: (path: string) => invoke<string | null>('file_thumbnail', { path }),
  sessionStop: (id: string) => invoke<void>('session_stop', { id }),
  sessionKill: (id: string) => invoke<void>('session_kill', { id }),
  sessionRestart: (id: string, cols: number, rows: number) =>
    invoke<SessionInfo>('session_restart', { id, cols, rows }),
  sessionNewConversation: (id: string, cols: number, rows: number) =>
    invoke<SessionInfo>('session_new_conversation', { id, cols, rows }),
  sessionRemove: (id: string) => invoke<void>('session_remove', { id }),

  usageSnapshot: () => invoke<{ sessions: ContextUsage[]; limits: Limits | null }>('usage_snapshot'),

  terminalWrite: (id: string, data: string) => invoke<void>('terminal_write', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    invoke<void>('terminal_resize', { id, cols, rows }),
  terminalAck: (id: string, bytes: number) => invoke<void>('terminal_ack', { id, bytes }),

  gitInfo: (cwd: string) => invoke<GitInfo | null>('git_info', { cwd }),
  fsSubdirs: (path: string) => invoke<string[]>('fs_subdirs', { path }),
  fsSuggestFolders: () => invoke<Suggestion[]>('fs_suggest_folders'),
  fsIsDir: (path: string) => invoke<boolean>('fs_is_dir', { path }),
  /** The system clipboard as a pane pastes it (copied files → their paths). */
  clipboardRead: () => invoke<Clipboard>('clipboard_read'),
  /** Files dragged over / dropped on the window. Tauri takes file drops away
   *  from the page, so this is the only way to see them. `x`/`y` are CSS px. */
  onFileDrop: (cb: (e: FileDrop) => void): Promise<UnlistenFn> =>
    getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type === 'leave') return cb({ type: 'leave' })
      const at = dropPoint(p.position.x, p.position.y, window.devicePixelRatio, false)
      cb(p.type === 'over' ? { type: 'over', ...at } : { type: p.type, paths: p.paths, ...at })
    }),

  pickFolder: async (defaultPath?: string): Promise<string | null> => {
    const picked = await openDialog({ directory: true, multiple: false, defaultPath })
    return typeof picked === 'string' ? picked : null
  },
  revealInFinder: (path: string) => revealItemInDir(path),
  /** Opens a file in whatever the system uses for it — Preview, a PDF
   *  reader — so a dropped file can be checked without leaving the app. */
  openFile: (path: string) => openPath(path),
  openUrl: (url: string) => openUrl(url),

  onStatus: (cb: (info: SessionInfo) => void): Promise<UnlistenFn> =>
    listen<SessionInfo>('session://status', (e) => cb(e.payload)),
  onClaudeId: (cb: (p: { id: string; claudeSessionId: string }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; claudeSessionId: string }>('session://claude-id', (e) => cb(e.payload)),

  onUsage: (cb: (u: ContextUsage) => void): Promise<UnlistenFn> =>
    listen<ContextUsage>('session://usage', (e) => cb(e.payload)),
  onLimits: (cb: (l: Limits) => void): Promise<UnlistenFn> => listen<Limits>('app://limits', (e) => cb(e.payload)),

  showWindow: async () => {
    const w = getCurrentWindow()
    await w.show()
    await w.setFocus()
  },
  isFullscreen: () => getCurrentWindow().isFullscreen(),
  onWindowResized: (cb: () => void) => getCurrentWindow().onResized(cb),
}

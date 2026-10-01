// Launch sequence:
//   init → load + decode (migrate, validate, heal) → hydrate → theme → fonts
//   → show window → subscribe to Rust events → resolve env → re-attach live
//   sessions → auto-resume everything that was running at quit (staggered).
import { errorMessage, ipc } from '../lib/ipc'
import { onStartRequest, terminals } from '../lib/terminals'
import { layoutOf } from '../state/commands/layout'
import { setContext } from '../state/commands/runtime'
import { flash, setBooted, setEnv, setEnvError, setFullscreen, setInit, setLimits, setSuggestions } from '../state/commands/ui'
import { forksNeeded } from '../lib/restore'
import { decode, hydrate, startPersistence } from '../state/persistence'
import { getState } from '../state/store'
import { onInfo, reattachSession, refreshGit, setClaudeSessionId, setTheme, startSession } from './actions'

/** Background (not visible) sessions resume one by one, this far apart. */
const STAGGER_MS = 300
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// On globalThis so neither StrictMode's double effect nor an HMR re-run of
// this module boots twice (which would re-attach and duplicate output).
const g = globalThis as unknown as { __cwBooted?: boolean }

export async function bootstrap() {
  if (g.__cwBooted) return
  g.__cwBooted = true

  const init = await ipc.appInit()
  setInit(init)
  if (!init.lockOk) {
    setBooted()
    await ipc.showWindow()
    return
  }

  const snap = await ipc.stateLoad()
  const dec = decode(snap)
  hydrate(dec)
  setTheme(dec.theme)
  startPersistence(dec)

  await Promise.race([
    Promise.all([document.fonts.load('12.5px "JetBrains Mono"'), document.fonts.load('13px "IBM Plex Sans"')]),
    sleep(1500),
  ])
  terminals.setAppearance({ theme: dec.theme, fontSize: dec.fontSize })

  await ipc.onStatus(onInfo)
  await ipc.onClaudeId(({ id, claudeSessionId }) => setClaudeSessionId(id, claudeSessionId))
  await ipc.onUsage(setContext)
  await ipc.onLimits(setLimits)
  ipc.onWindowResized(async () => setFullscreen(await ipc.isFullscreen()))

  setBooted()
  await ipc.showWindow()
  if (snap.restored.length) flash(`Recovered ${snap.restored.length} settings file${snap.restored.length === 1 ? '' : 's'} from backup`)
  else if (snap.corrupt.length) flash('A settings file was unreadable and was set aside')
  else if (dec.readonly) flash('Your data is from a newer version — changes will not be saved')
  else if (dec.skipped) flash(`${dec.skipped} invalid saved entr${dec.skipped === 1 ? 'y was' : 'ies were'} skipped`)
  void ipc.fsSuggestFolders().then(setSuggestions)

  try {
    setEnv(await ipc.appEnv())
  } catch (e) {
    setEnvError(errorMessage(e))
  }

  // Sessions Rust still runs (webview reload / HMR): re-attach, don't respawn.
  const live = await ipc.sessionList().catch(() => [])
  const liveIds = new Set(live.map((l) => l.id))
  for (const info of live) await reattachSession(info)
  const usage = await ipc.usageSnapshot().catch(() => null)
  usage?.sessions.forEach(setContext)
  if (usage?.limits) setLimits(usage.limits)

  // Auto-resume: the active workspace's visible panes first, then the rest.
  const { workspace, layout } = getState()
  const pending = Object.values(workspace.sessions).filter((s) => s.wasRunning && !liveIds.has(s.id))
  const rank = (id: string, wsId: string) => {
    const i = layoutOf(layout.byWorkspace, wsId).open.indexOf(id)
    return (wsId === workspace.activeId ? 0 : 100) + (i < 0 ? 50 : i)
  }
  pending.sort((a, b) => rank(a.id, a.workspaceId) - rank(b.id, b.workspaceId))
  const forks = forksNeeded(pending)
  for (const s of Object.values(workspace.sessions)) void refreshGit(s.id)

  // Visible panes first, all at once: those are the ones you're about to use.
  const visible = new Set(layoutOf(layout.byWorkspace, workspace.activeId).open)
  const queue = pending.filter((s) => !visible.has(s.id)).map((s) => s.id)
  const launch = (id: string) => void startSession(id, { fork: forks.has(id) })
  // Clicking or typing into a still-queued pane starts it immediately.
  onStartRequest((id) => {
    const i = queue.indexOf(id)
    if (i >= 0) {
      queue.splice(i, 1)
      launch(id)
    }
  })
  pending.filter((s) => visible.has(s.id)).forEach((s) => launch(s.id))
  while (queue.length) {
    await sleep(STAGGER_MS)
    const next = queue.shift()
    if (next) launch(next)
  }

  // Keep branch names fresh for panes on screen.
  setInterval(() => {
    const st = getState()
    for (const id of layoutOf(st.layout.byWorkspace, st.workspace.activeId).open) void refreshGit(id)
  }, 20_000)
}

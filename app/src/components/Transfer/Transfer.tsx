// Moving a workspace between machines: the export sheet and the import sheet.
//
// Two things here are deliberate rather than decorative. Export is gated on an
// acknowledgement, because a bundle carries every conversation in full —
// pasted keys, file contents, command output. And import shows, per session,
// exactly which folder its transcript will land in, because Claude's folder
// naming is lossy and two sessions can end up sharing one.
import { useEffect, useMemo, useState } from 'react'

import { ipc } from '../../lib/ipc'
import { IS_WINDOWS, OS_NAME, SHOW_IN_FILES } from '../../lib/platform'
import { bundleName, placements, size } from '../../lib/transfer'
import { layoutOf } from '../../state/commands/layout'
import { closeTransfer, flash } from '../../state/commands/ui'
import { addSession, addWorkspace, newSessionId } from '../../state/commands/workspace'
import { useUi } from '../../state/selectors'
import { getState } from '../../state/store'
import type { BundleManifest } from '../../types'


const sheet = 'flex flex-col bg-raised border border-line2 rounded-r overflow-hidden'
const head = 'px-[22px] pt-5 flex flex-col gap-1 flex-none'
const body = 'px-[22px] py-4 flex flex-col gap-3.5 overflow-auto min-h-0'
const foot = 'flex justify-end gap-2 px-[22px] py-3 border-t border-line flex-none'
const ghost =
  'h-8 px-3.5 flex items-center rounded-rs border border-line2 cursor-pointer text-muted hover:text-text text-[12.5px]'
const solid = 'h-8 px-3.5 flex items-center rounded-rs bg-accent text-accent-ink cursor-pointer text-[12.5px] font-medium'
const mono = 'font-mono text-[11.5px] text-faint'
const grid = '140px minmax(0,1fr) minmax(0,1.3fr) 110px'

function Scrim({ children }: { children: React.ReactNode }) {
  return (
    <div
      onMouseDown={closeTransfer}
      className="absolute inset-0 z-[40] grid place-items-center p-6"
      style={{ background: 'var(--overlay)' }}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="contents">
        {children}
      </div>
    </div>
  )
}

/** The note that this leans on Claude's own format. Both sheets carry it. */
function FormatNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 text-[12.5px] text-faint leading-[1.55]">
      <span className="flex-none w-4 h-4 mt-[1px] rounded-pill border border-faint grid place-items-center text-[10px] font-bold">
        i
      </span>
      <span>{children}</span>
    </div>
  )
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: `1.5px solid ${on ? 'var(--accent)' : 'var(--faint)'}`,
        background: on ? 'var(--accent)' : 'transparent',
        color: 'var(--accentInk)',
      }}
      className="flex-none grid place-items-center text-[11px] font-bold"
    >
      {on ? '✓' : ''}
    </span>
  )
}

function Done({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        style={{ width: 22, height: 22, background: 'var(--addBg)', color: 'var(--ok)' }}
        className="rounded-pill grid place-items-center text-[12px]"
      >
        ✓
      </span>
      <span className="text-[17px] font-semibold">{title}</span>
    </div>
  )
}

function ExportSheet({ workspaceId }: { workspaceId: string }) {
  const ws = getState().workspace.workspaces.find((w) => w.id === workspaceId)
  const sessions = useMemo(
    () =>
      Object.values(getState().workspace.sessions)
        .filter((m) => m.workspaceId === workspaceId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [workspaceId],
  )
  const [sizes, setSizes] = useState<Record<string, number> | null>(null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ path: string; bytes: number; transcripts: number; missing: number } | null>(null)

  // What it will cost, worked out before anything is written.
  useEffect(() => {
    void ipc
      .bundlePreview(
        sessions.map((m) => ({ id: m.id, name: m.name, kind: m.kind, cwd: m.cwd, claudeSessionId: m.claudeSessionId })),
      )
      .then((rows) => setSizes(Object.fromEntries(rows.map((r) => [r.id, r.bytes]))))
      .catch(() => setSizes({}))
  }, [sessions])

  if (!ws) return null
  const total = sizes ? Object.values(sizes).reduce((a, b) => a + b, 0) : 0
  const relative = (cwd: string) => cwd.replace(ws.path, '').replace(/^[\\/]+/, '') || '.'

  async function write() {
    if (!ack || busy || !ws) return
    const dest = await ipc.pickSaveBundle(bundleName(ws.name)).catch(() => null)
    if (!dest) return
    setBusy(true)
    try {
      const out = await ipc.bundleExport({
        dest,
        workspaceName: ws.name,
        root: ws.path,
        layout: layoutOf(getState().layout.byWorkspace, workspaceId),
        sessions: sessions.map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          cwd: m.cwd,
          claudeSessionId: m.claudeSessionId,
        })),
        appVersion: getState().ui.init?.version ?? '',
      })
      setDone({ path: dest, ...out })
    } catch (e) {
      flash(`Export failed: ${String((e as { message?: string })?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Scrim>
        <div className={sheet} style={{ width: 580, boxShadow: 'var(--shadow)' }}>
          <div className="px-[22px] pt-7 pb-5 flex flex-col gap-2.5">
            <Done title="Exported" />
            <div className="font-mono text-[12px] text-muted px-3 py-2.5 rounded-rs bg-pane border border-line break-all">
              {done.path} · {size(done.bytes)}
            </div>
            <span className="text-[12.5px] text-faint leading-[1.55]">
              Contains full conversation history. Delete it once it’s imported.
            </span>
          </div>
          <div className={foot}>
            <div className={ghost} onClick={() => void ipc.revealInFinder(done.path).catch(() => {})}>
              {SHOW_IN_FILES}
            </div>
            <div className={solid} onClick={closeTransfer}>
              Done
            </div>
          </div>
        </div>
      </Scrim>
    )
  }

  return (
    <Scrim>
      <div
        className={sheet}
        style={{ width: 'min(580px, 100%)', maxHeight: '100%', boxShadow: 'var(--shadow)' }}
      >
        <div className={head}>
          <span className="text-[17px] font-semibold">Export {ws.name}</span>
          <span className="text-[12.5px] text-muted">
            One .kon file with this workspace, its layout and every session’s conversation.
          </span>
        </div>

        <div className={body}>
          <div className="border border-line rounded-rs bg-pane flex-none">
            <div className="flex justify-between gap-3 px-3 py-2.5 border-b border-line">
              <span className="text-[12.5px] text-muted flex-none">Manifest</span>
              <span className={`${mono} truncate`}>
                Konscious {getState().ui.init?.version} · {OS_NAME}
              </span>
            </div>
            <div className="flex justify-between gap-3 px-3 py-2.5 border-b border-line">
              <span className="text-[12.5px] text-muted flex-none">Workspace &amp; layout</span>
              <span className={`${mono} truncate`} title={ws.path}>
                paths relative to {ws.path}
              </span>
            </div>
            {sessions.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex-1 min-w-0 text-[12.5px] truncate">
                  {m.name} <span className="font-mono text-[11px] text-faint">./{relative(m.cwd)}</span>
                </span>
                <span className={mono} style={{ color: sizes?.[m.id] ? 'var(--muted)' : 'var(--faint)' }}>
                  {sizes ? size(sizes[m.id] ?? 0) : '…'}
                </span>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2.5 border-t border-line font-semibold text-[12.5px]">
              <span>Total</span>
              <span className="font-mono text-[12px]">{sizes ? size(total) : '…'}</span>
            </div>
          </div>

          <div
            className="rounded-rs px-3.5 py-3 flex flex-col gap-2.5 flex-none"
            style={{ border: '1px solid color-mix(in srgb, var(--err) 45%, transparent)', background: 'var(--delBg)' }}
          >
            <span className="text-[12.5px] font-semibold">This file contains every conversation, in full</span>
            <span className="text-[12.5px] text-muted leading-[1.55]">
              Transcripts hold everything said in these sessions — pasted keys and tokens, file contents, command
              output. Anyone with the file can read all of it. Keep it as private as the code.
            </span>
            <div onClick={() => setAck(!ack)} className="flex items-center gap-2.5 cursor-pointer select-none">
              <Tick on={ack} />
              <span className="text-[12.5px]">I understand the export includes full conversation history</span>
            </div>
          </div>

          <FormatNote>
            Transcripts are stored in Claude Code’s own format, not Konscious’s. This works with today’s Claude Code
            and could stop working after an update. Open your sessions after importing to check they resumed. Don’t
            treat this as a backup.
          </FormatNote>
        </div>

        <div className={foot}>
          <div className={ghost} onClick={closeTransfer}>
            Cancel
          </div>
          <div
            onClick={() => void write()}
            className="h-8 px-3.5 flex items-center rounded-rs text-[12.5px] font-medium"
            style={{
              background: ack ? 'var(--accent)' : 'var(--line)',
              color: ack ? 'var(--accentInk)' : 'var(--faint)',
              cursor: ack && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Exporting…' : sizes ? `Export ${size(total)}…` : 'Export…'}
          </div>
        </div>
      </div>
    </Scrim>
  )
}

function ImportSheet({ path }: { path: string }) {
  const [manifest, setManifest] = useState<BundleManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void ipc
      .bundleInspect(path)
      .then(async (m) => {
        setManifest(m)
        // The folder the bundle came from, when this machine has it — that is
        // the common case of moving between two checkouts of the same repo.
        // Never a guess like ~/<name>: a root that does not exist produces
        // sessions that cannot start.
        const here = await ipc.fsIsDir(m.sourceRoot).catch(() => false)
        setRoot(here ? m.sourceRoot : '')
      })
      .catch((e) => setError(String((e as { message?: string })?.message ?? e)))
  }, [path])

  const rows = useMemo(() => (manifest && root ? placements(manifest.sessions, root, IS_WINDOWS) : []), [manifest, root])
  const collisions = rows.filter((r) => r.collides).length

  // A session is a shell in a directory, so a folder that is not there means a
  // session that cannot start. The engine refuses it; better to say so here.
  const [exists, setExists] = useState<Record<string, boolean>>({})
  const [rootHere, setRootHere] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    if (!root) {
      setRootHere(null)
      setExists({})
      return
    }
    void ipc
      .fsIsDir(root)
      .then((ok) => live && setRootHere(ok))
      .catch(() => live && setRootHere(false))
    void Promise.all(rows.map((r) => ipc.fsIsDir(r.cwd).catch(() => false))).then((found) => {
      if (live) setExists(Object.fromEntries(rows.map((r, i) => [r.id, found[i]])))
    })
    return () => {
      live = false
    }
  }, [root, rows])
  const missing = rows.filter((r) => exists[r.id] === false).length

  async function run() {
    if (!manifest || !root || busy || !rootHere) return
    setBusy(true)
    try {
      const out = await ipc.bundleImport(path, root)
      const ws = addWorkspace(root)
      for (const session of manifest.sessions) {
        const now = Date.now()
        addSession({
          id: newSessionId(),
          workspaceId: ws.id,
          name: session.name,
          kind: session.kind,
          cwd: rows.find((r) => r.id === session.id)?.cwd ?? root,
          claudeSessionId: session.kind === 'shell' ? null : session.claudeSessionId,
          wasRunning: false,
          fontSize: null,
          createdAt: now,
          lastActiveAt: now,
        })
      }
      setCopied(out.transcripts)
    } catch (e) {
      flash(`Import failed: ${String((e as { message?: string })?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <Scrim>
        <div className={sheet} style={{ width: 'min(460px, 100%)', boxShadow: 'var(--shadow)' }}>
          <div className="px-[22px] pt-6 pb-4 flex flex-col gap-2">
            <span className="text-[15px] font-semibold">That file can’t be imported</span>
            <span className="text-[12.5px] text-muted leading-[1.5]">{error}</span>
          </div>
          <div className={foot}>
            <div className={solid} onClick={closeTransfer}>
              Close
            </div>
          </div>
        </div>
      </Scrim>
    )
  }
  if (!manifest) return null

  if (copied !== null) {
    const ticked = Object.values(checked).filter(Boolean).length
    return (
      <Scrim>
        <div className={sheet} style={{ width: 'min(620px, 100%)', maxHeight: '100%', boxShadow: 'var(--shadow)' }}>
          <div className="px-[22px] pt-7 pb-4 flex flex-col gap-3.5 min-h-0">
            <Done title={`${manifest.workspaceName} imported`} />
            <span className="text-[12.5px] text-muted leading-[1.55]">
              Open each session once to confirm it picked up its conversation.
            </span>
            <div className="border border-line rounded-rs bg-pane overflow-auto min-h-0">
              {manifest.sessions.map((session) => {
                const row = rows.find((r) => r.id === session.id)
                const on = !!checked[session.id]
                const note =
                  session.kind === 'shell'
                    ? 'New shell, nothing to resume'
                    : row?.collides
                      ? 'Shared folder — check this one'
                      : on
                        ? 'Conversation is there'
                        : 'Not checked yet'
                return (
                  <div
                    key={session.id}
                    onClick={() => setChecked({ ...checked, [session.id]: !on })}
                    className="flex items-center gap-2.5 px-3 py-2.5 border-b border-line last:border-b-0 cursor-pointer"
                  >
                    <Tick on={on} />
                    <span className="flex-1 text-[12.5px] font-medium truncate">{session.name}</span>
                    <span
                      className="text-[11.5px] whitespace-nowrap"
                      style={{ color: row?.collides && !on ? 'var(--warn)' : on ? 'var(--ok)' : 'var(--faint)' }}
                    >
                      {note}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex justify-between items-center gap-2 px-[22px] py-3 border-t border-line flex-none">
            <span className="text-[12px] text-faint">
              {ticked} of {manifest.sessions.length} checked · {copied} conversations copied
            </span>
            <div className={solid} onClick={closeTransfer}>
              Done
            </div>
          </div>
        </div>
      </Scrim>
    )
  }

  const cell = 'font-mono text-[11px] truncate'
  return (
    <Scrim>
      <div className={sheet} style={{ width: 'min(820px, 100%)', maxHeight: '100%', boxShadow: 'var(--shadow)' }}>
        <div className={head}>
          <span className="text-[17px] font-semibold">Import workspace</span>
          <span className="text-[12.5px] text-muted flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] text-text">{path.split(/[\\/]/).pop()}</span>
            <span className="text-faint">
              · {manifest.workspaceName} · {manifest.sessions.length} sessions · exported from {manifest.platform}
            </span>
          </span>
        </div>

        <div className={body}>
          <div className="flex flex-col gap-2 flex-none">
            <span className="text-[12.5px] font-semibold">
              Where is the {manifest.workspaceName} code on this machine?
            </span>
            <div className="flex gap-2">
              <input
                id="import-root"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                spellCheck={false}
                className="flex-1 min-w-0 h-[34px] px-3 rounded-rs bg-win border border-line2 font-mono text-[12.5px] outline-none focus:border-accent"
              />
              <div
                className={ghost}
                style={{ height: 34 }}
                onClick={() => void ipc.pickFolder(root || getState().ui.init?.home).then((p) => p && setRoot(p))}
              >
                Choose…
              </div>
            </div>
            <span className="text-[12px] text-faint leading-[1.5]">
              Each session’s folder is placed under this root. Transcripts go where Claude Code on this machine will
              look for them.
            </span>
          </div>

          <div className="border border-line rounded-rs bg-pane overflow-hidden flex-none">
            <div
              className="grid gap-3 px-3 py-2 border-b border-line text-[11.5px] text-faint font-semibold"
              style={{ gridTemplateColumns: grid }}
            >
              <span>Session</span>
              <span>Folder here</span>
              <span>Transcript → ~/.claude/projects/</span>
              <span />
            </div>
            {rows.map((r) => (
              <div
                key={r.id}
                className="grid gap-3 items-center px-3 py-2 border-b border-line last:border-b-0"
                style={{
                  gridTemplateColumns: grid,
                  background:
                    exists[r.id] === false
                      ? 'color-mix(in srgb, var(--err) 7%, transparent)'
                      : r.collides
                        ? 'color-mix(in srgb, var(--warn) 6%, transparent)'
                        : 'transparent',
                }}
              >
                <span className="text-[12.5px] font-medium truncate">{r.name}</span>
                <span className={`${cell} text-muted`} title={r.cwd} dir="rtl">
                  <bdi>{r.cwd}</bdi>
                </span>
                <span
                  className={cell}
                  title={r.slug ?? ''}
                  dir="rtl"
                  style={{ color: r.collides ? 'var(--warn)' : r.slug ? 'var(--muted)' : 'var(--faint)' }}
                >
                  <bdi>{r.slug ? `${r.slug}/` : '—'}</bdi>
                </span>
                <span
                  className="text-[11.5px] whitespace-nowrap"
                  style={{
                    color:
                      exists[r.id] === false
                        ? 'var(--err)'
                        : !r.slug
                          ? 'var(--faint)'
                          : r.collides
                            ? 'var(--warn)'
                            : 'var(--ok)',
                  }}
                >
                  {exists[r.id] === false
                    ? 'Folder missing'
                    : !r.slug
                      ? 'No transcript'
                      : r.collides
                        ? 'Shared folder'
                        : 'Ready'}
                </span>
              </div>
            ))}
          </div>

          {rootHere === false && (
            <div
              className="rounded-rs px-3.5 py-3 flex flex-col gap-1.5 flex-none"
              style={{
                border: '1px solid color-mix(in srgb, var(--err) 45%, transparent)',
                background: 'var(--delBg)',
              }}
            >
              <span className="text-[12.5px] font-semibold">That folder isn’t on this machine</span>
              <span className="text-[12.5px] text-muted leading-[1.55]">
                A bundle carries conversations and layout, not code. Clone or check out the project first, then point
                this at it — a session is a shell in a directory, so it can’t start in one that isn’t there.
              </span>
            </div>
          )}

          {rootHere === true && missing > 0 && (
            <div
              className="rounded-rs px-3.5 py-3 flex flex-col gap-1.5 flex-none"
              style={{
                border: '1px solid color-mix(in srgb, var(--warn) 45%, transparent)',
                background: 'color-mix(in srgb, var(--warn) 8%, transparent)',
              }}
            >
              <span className="text-[12.5px] font-semibold">
                {missing === 1 ? '1 session’s folder doesn’t exist yet' : `${missing} sessions’ folders don’t exist yet`}
              </span>
              <span className="text-[12.5px] text-muted leading-[1.55]">
                They import, and their conversations come with them, but they won’t start until those folders are
                there. Usually that means the branch or subproject hasn’t been checked out here.
              </span>
            </div>
          )}

          {collisions > 0 && (
            <div
              className="rounded-rs px-3.5 py-3 flex flex-col gap-1.5 flex-none"
              style={{
                border: '1px solid color-mix(in srgb, var(--warn) 45%, transparent)',
                background: 'color-mix(in srgb, var(--warn) 8%, transparent)',
              }}
            >
              <span className="text-[12.5px] font-semibold">
                {collisions === 1
                  ? '1 session shares a transcript folder with another project'
                  : `${collisions} sessions share a transcript folder with another project`}
              </span>
              <span className="text-[12.5px] text-muted leading-[1.55]">
                Claude Code names transcript folders by turning every non-letter, non-digit in the path into a dash,
                so <span className="font-mono text-[11.5px] text-text">spec-rl</span> and{' '}
                <span className="font-mono text-[11.5px] text-text">spec/rl</span> end up in the same place. The
                transcript will sit beside another project’s. It still imports; check the session afterwards.
              </span>
            </div>
          )}

          <FormatNote>
            Uses Claude Code’s transcript format, which can change in any release. After importing, open each session
            and check its conversation is there.
          </FormatNote>
        </div>

        <div className={foot}>
          <div className={ghost} onClick={closeTransfer}>
            Cancel
          </div>
          <div
            onClick={() => void run()}
            className="h-8 px-3.5 flex items-center rounded-rs text-[12.5px] font-medium"
            style={{
              background: rootHere ? 'var(--accent)' : 'var(--line)',
              color: rootHere ? 'var(--accentInk)' : 'var(--faint)',
              cursor: rootHere && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy
              ? 'Importing…'
              : !root
                ? 'Choose a folder'
                : rootHere === false
                  ? 'Folder not found'
                  : `Import ${manifest.sessions.length} sessions`}
          </div>
        </div>
      </div>
    </Scrim>
  )
}

export function Transfer() {
  const transfer = useUi((u) => u.transfer)
  if (!transfer) return null
  return transfer.kind === 'export' ? (
    <ExportSheet workspaceId={transfer.workspaceId} />
  ) : (
    <ImportSheet path={transfer.path} />
  )
}

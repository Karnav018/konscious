import type { ReactNode } from 'react'

import { Key } from './Key'
import { Crop, type Region } from './Shot'

interface Shot {
  region: Region
  label: string
  scale?: number
}

interface Row {
  title: string
  body: ReactNode
  shots: Shot[]
}

// Regions are in the screenshot's own pixels (public/app-window.png).
const rows: Row[] = [
  {
    title: 'Know which session needs you',
    body: (
      <>
        Every pane says whether its session is <Status kind="working">working</Status>,{' '}
        <Status kind="waiting">waiting for you</Status> or <Status kind="idle">idle</Status>. The status comes from
        Claude Code’s own hooks, so a session stuck on a permission prompt shows it the moment it stops.
      </>
    ),
    shots: [{ region: { x: 1724, y: 110, w: 836, h: 680 }, label: 'A session waiting for review, its status shown in the pane header.' }],
  },
  {
    title: 'Jump straight to it',
    body: (
      <>
        The title bar counts the sessions that are waiting, and <Key>⌘J</Key> takes you to the next one. Switch
        between a grid of up to six panes and Focus on one, without stopping anything. On Windows the shortcuts use{' '}
        <Key>Ctrl+Shift</Key>.
      </>
    ),
    shots: [
      {
        region: { x: 150, y: 8, w: 960, h: 85 },
        label: 'Title bar with the workspace, Grid and Focus, the new-terminal button and “1 waiting”.',
        scale: 0.62,
      },
    ],
  },
  {
    title: 'A shell next to every session',
    body: (
      <>
        <Key>⌘T</Key> opens a terminal in the same folder as the session you’re in. It sits in the grid like any
        other pane, so the tests you run and the agent writing the code stay side by side.
      </>
    ),
    shots: [{ region: { x: 870, y: 918, w: 840, h: 600 }, label: 'A terminal pane showing git status and running containers.' }],
  },
  {
    title: 'Usage and context at a glance',
    body: (
      <>
        Two rings in the title bar show how much of your 5-hour and 7-day Claude usage is gone. Each pane shows its
        model and how full its context window is.
      </>
    ),
    shots: [
      { region: { x: 1715, y: 8, w: 410, h: 85 }, label: 'Usage rings: 42% of the 5-hour limit, 68% of the 7-day limit.', scale: 0.75 },
      {
        region: { x: 20, y: 118, w: 826, h: 56 },
        label: 'A pane header: the Backend session on Opus 4.5, 42% of its context used, working.',
        scale: 0.62,
      },
    ],
  },
]

const facts = [
  {
    title: 'Picks up where you left off',
    body: 'Quit any time. When you open the app again, every session that was running resumes its conversation in the same layout.',
  },
  {
    title: 'Your setup stays yours',
    body: 'Sessions run the Claude Code you already have, with your settings, hooks and logins. Konscious never edits them.',
  },
]

export function Features() {
  return (
    <section id="features" aria-label="Features" className="mx-auto max-w-6xl scroll-mt-16 px-4 pt-28 pb-8 sm:px-6">
      {rows.map((r) => (
        <div
          key={r.title}
          className="grid items-center gap-8 py-12 md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] md:gap-16 md:py-16"
        >
          <div className="min-w-0">
            <h2 className="font-head text-[1.6rem] leading-tight font-semibold tracking-[-0.02em] [text-wrap:balance]">{r.title}</h2>
            <p className="mt-4 leading-relaxed text-muted">{r.body}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-4 md:items-end">
            {r.shots.map((s) => (
              <Crop key={s.label} region={s.region} label={s.label} scale={s.scale} />
            ))}
          </div>
        </div>
      ))}
      <div className="grid gap-x-16 gap-y-10 py-12 md:grid-cols-2 md:py-16">
        {facts.map((f) => (
          <div key={f.title} className="min-w-0">
            <h2 className="font-head text-[1.6rem] leading-tight font-semibold tracking-[-0.02em] [text-wrap:balance]">{f.title}</h2>
            <p className="mt-4 max-w-[34rem] leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** A status word in the colour the app uses for it. */
function Status({ kind, children }: { kind: 'working' | 'waiting' | 'idle'; children: ReactNode }) {
  const color = { working: 'text-working', waiting: 'text-waiting', idle: 'text-idle' }[kind]
  return <span className={`font-medium ${color}`}>{children}</span>
}

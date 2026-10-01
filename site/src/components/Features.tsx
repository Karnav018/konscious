const features = [
  {
    title: 'Six live panes',
    body: 'Run Claude Code sessions and shells side by side in one grid, or focus on one with ⌘↵.',
  },
  {
    title: 'Status at a glance',
    body: 'Every pane shows whether its session is working, waiting for you, or idle.',
  },
  {
    title: 'Picks up where you left off',
    body: 'Quit any time. Every session that was running resumes when you open the app again.',
  },
  {
    title: 'Your setup, untouched',
    body: 'Sessions run your own Claude CLI. Your Claude settings and hooks are never changed.',
  },
]

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <h2 className="font-head text-3xl font-semibold tracking-tight">Built for many sessions at once</h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-r border border-line bg-surface p-6">
            <h3 className="font-head text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

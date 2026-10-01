import { site } from '../site'

export function Download() {
  const options = [site.downloads.mac, site.downloads.windows]
  return (
    <section id="download" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 text-center sm:px-6">
      <h2 className="font-head text-3xl font-semibold tracking-tight">Get {site.name}</h2>
      <p className="mt-3 text-muted">
        Version {site.version}. Needs the <span className="font-mono text-sm">claude</span> CLI installed.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        {options.map((o) => (
          <a
            key={o.label}
            href={o.href}
            className="flex min-w-64 flex-col items-center gap-1 rounded-r border border-line bg-surface px-6 py-5 hover:border-accent"
          >
            <span className="font-medium">{o.label}</span>
            <span className="text-sm text-faint">{o.note}</span>
          </a>
        ))}
      </div>
    </section>
  )
}

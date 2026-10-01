import { site } from '../site'

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28">
      <h1 className="mx-auto max-w-3xl font-head text-4xl font-bold tracking-tight sm:text-6xl">{site.tagline}</h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">{site.summary}</p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <a
          href={site.downloads.mac.href}
          className="rounded-pill bg-accent px-6 py-3 font-medium text-accent-ink hover:opacity-90"
        >
          {site.downloads.mac.label}
        </a>
        <a href="#features" className="rounded-pill border border-line px-6 py-3 font-medium hover:bg-accent-soft">
          See what it does
        </a>
      </div>
      {/* Product screenshot goes here once the design is in. */}
      <div className="mx-auto mt-16 grid aspect-[16/10] max-w-5xl place-items-center rounded-r border border-line bg-surface font-mono text-sm text-faint">
        app screenshot
      </div>
    </section>
  )
}

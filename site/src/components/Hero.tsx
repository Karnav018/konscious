import { site, visitorOs } from '../site'
import { Window } from './Shot'

export function Hero() {
  const [primary, other] =
    visitorOs === 'windows' ? [site.downloads.windows, site.downloads.mac] : [site.downloads.mac, site.downloads.windows]
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 sm:pt-24">
        <h1 className="max-w-[20ch] font-head [text-wrap:balance] text-[clamp(2.75rem,6.4vw,5rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
          {site.tagline}
        </h1>
        <p className="mt-7 max-w-[36rem] text-lg leading-relaxed text-muted sm:text-xl">{site.summary}</p>
        <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
          <a
            href={primary.href}
            className="rounded-pill bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink hover:opacity-90"
          >
            {primary.label}
          </a>
          <a href={other.href} className="text-[17px] text-muted underline-offset-4 hover:text-text hover:underline">
            {other.label}
          </a>
        </div>
        <p className="mt-4 text-sm text-faint">
          Version {site.version}, free. Runs your own Claude Code.
        </p>
      </div>
      <figure className="mx-auto mt-16 max-w-[1240px] px-4 sm:mt-20 sm:px-6">
        <Window className="[filter:drop-shadow(0_28px_48px_var(--shadow))]" />
      </figure>
    </section>
  )
}

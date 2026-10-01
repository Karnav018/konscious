import { onPhone, site, visitorOs } from '../site'
import { DownloadLink } from './DownloadLink'
import { Wordmark } from './Wordmark'

const button = 'rounded-pill bg-accent px-4 py-2 font-medium text-accent-ink hover:opacity-90'

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="/" aria-label={`${site.name} home`} className="rounded-rs">
          <Wordmark />
        </a>
        <nav className="ml-auto flex items-center gap-6 text-[15px] text-muted">
          {site.nav.map((n) => (
            <a key={n.href} href={n.href} className="hidden hover:text-text sm:inline">
              {n.label}
            </a>
          ))}
          {onPhone ? (
            <a href="#download" className={button}>
              Download
            </a>
          ) : (
            <DownloadLink file={site.downloads[visitorOs]} className={button}>
              Download
            </DownloadLink>
          )}
        </nav>
      </div>
    </header>
  )
}

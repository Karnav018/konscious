import { site } from '../site'
import { Wordmark } from './Wordmark'

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-8 text-sm text-faint sm:px-6">
        <Wordmark size={17} />
        <span>Version {site.version}</span>
        <a href={site.repo} className="ml-auto hover:text-text">
          Source on GitHub
        </a>
      </div>
    </footer>
  )
}

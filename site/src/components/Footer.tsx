import { site } from '../site'
import { Wordmark } from './Wordmark'

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-8 text-sm text-faint sm:px-6">
        <Wordmark size={16} />
        <span>{site.tagline}</span>
        <span className="ml-auto">© {new Date().getFullYear()} {site.name}</span>
      </div>
    </footer>
  )
}

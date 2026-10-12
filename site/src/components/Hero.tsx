import { useState } from 'react'

import { osOrder, site } from '../site'
import { useDownloads, type DownloadOption } from '../useDownloads'
import { DownloadLink } from './DownloadLink'
import { LinuxFormatPicker } from './LinuxFormatPicker'
import { Window } from './Shot'

export function Hero() {
  const downloads = useDownloads()
  // The visitor's platform leads; the next one is a quiet link (the rest are below).
  const [primary, other] = [downloads[osOrder[0]], downloads[osOrder[1]]]
  const [started, setStarted] = useState<DownloadOption | null>(null)
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 sm:pt-24">
        <h1 className="max-w-[20ch] font-head text-[clamp(2.75rem,6.4vw,5rem)] font-semibold leading-[1.02] tracking-[-0.035em] [text-wrap:balance]">
          {site.tagline}
        </h1>
        <p className="mt-7 max-w-[36rem] text-lg leading-relaxed text-muted sm:text-xl">{site.summary}</p>
        <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <DownloadLink
              file={primary}
              onStart={() => setStarted(primary)}
              className="rounded-pill bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink hover:opacity-90"
            >
              {primary.label}
            </DownloadLink>
            {/* A Linux visitor picks the package right here (AppImage or .deb). */}
            {primary.os === 'linux' && <LinuxFormatPicker />}
          </div>
          <DownloadLink
            file={other}
            onStart={() => setStarted(other)}
            className="text-[17px] text-muted underline-offset-4 hover:text-text hover:underline"
          >
            {other.label}
          </DownloadLink>
        </div>
        <p className="mt-4 text-sm text-faint" aria-live="polite">
          {started ? (
            <>
              Downloading {started.name}.{' '}
              <a href="#download" className="text-muted underline underline-offset-4 hover:text-text">
                How to open it the first time
              </a>
            </>
          ) : (
            <>{downloads.version ? `Version ${downloads.version}, free.` : 'Free.'} Runs your own Claude Code.</>
          )}
        </p>
      </div>
      <figure className="mx-auto mt-16 max-w-[1240px] px-4 sm:mt-20 sm:px-6">
        <Window className="[filter:drop-shadow(0_28px_48px_var(--shadow))]" />
      </figure>
    </section>
  )
}

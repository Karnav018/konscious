import type { ReactNode } from 'react'

import type { DownloadOption } from '../useDownloads'

/**
 * A link to the installer on the newest GitHub release. GitHub serves release
 * files as attachments, so the browser saves the file instead of navigating
 * away; `download` is ignored cross-origin and would only be misleading here.
 */
export function DownloadLink({
  file,
  className,
  onStart,
  children,
}: {
  file: DownloadOption
  className?: string
  onStart?: () => void
  children: ReactNode
}) {
  return (
    <a href={file.url} onClick={file.name ? onStart : undefined} className={className}>
      {children}
    </a>
  )
}

import type { ReactNode } from 'react'

import { downloadUrl, type Download } from '../site'

/**
 * A link to the installer on the GitHub release. GitHub serves release assets
 * as attachments, so the browser saves the file instead of navigating away;
 * `download` is ignored cross-origin and would only be misleading here.
 */
export function DownloadLink({
  file,
  className,
  onStart,
  children,
}: {
  file: Download
  className?: string
  onStart?: () => void
  children: ReactNode
}) {
  return (
    <a href={downloadUrl(file)} onClick={onStart} className={className}>
      {children}
    </a>
  )
}

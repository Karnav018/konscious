import type { ReactNode } from 'react'

import { downloadUrl, type Download } from '../site'

/**
 * A link that downloads the installer (same-origin file + `download`, so the
 * browser saves it under its real name instead of navigating away).
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
    <a href={downloadUrl(file)} download={file.name} onClick={onStart} className={className}>
      {children}
    </a>
  )
}

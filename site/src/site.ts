// Product facts shared by every page. Keep copy here, not inside components,
// so a rename or a new release is a one-file change.
const version = '0.1.0'
const repo = 'https://github.com/Karnav018/konscious'
// Installers are committed to the repo under release/. The site serves them
// itself at /download/<name> (vite.config.ts copies them in at build time):
// same origin, so the browser downloads instead of navigating away.
const installer = (path: string) => ({ release: path, name: path.split('/').pop() as string })

export const site = {
  name: 'Konscious',
  tagline: 'Every Claude session, one calm place.',
  summary:
    'Run up to six Claude Code sessions and shells side by side. Each one shows whether it’s working, waiting for you, or done, so you only look where you’re needed.',
  version,
  repo,
  downloads: {
    mac: {
      os: 'macOS',
      label: 'Download for macOS',
      detail: 'Apple silicon and Intel, macOS 13 or later',
      size: '7.9 MB',
      ...installer(`mac/Konscious-${version}-universal.dmg`),
    },
    windows: {
      os: 'Windows',
      label: 'Download for Windows',
      detail: '64-bit, Windows 10 or 11',
      size: '3.2 MB',
      ...installer(`win/Konscious_${version}_x64-setup.exe`),
    },
  },
  // Claude Code's own installers (docs.claude.com/claude-code).
  claudeInstall: {
    mac: 'curl -fsSL https://claude.ai/install.sh | bash',
    windows: 'irm https://claude.ai/install.ps1 | iex',
  },
  nav: [
    { label: 'Features', href: '#features' },
    { label: 'Download', href: '#download' },
    { label: 'GitHub', href: repo },
  ],
} as const

export type Download = (typeof site.downloads)[keyof typeof site.downloads]

/** Where the site serves an installer. */
export const downloadUrl = (d: Download) => `/download/${d.name}`

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

/** The visitor's platform decides which download leads. */
export const visitorOs: 'mac' | 'windows' = /Windows/i.test(ua) ? 'windows' : 'mac'

/** Phones and tablets can't run the app: show them the section, not a file. */
export const onPhone = /iPhone|iPad|Android/i.test(ua)

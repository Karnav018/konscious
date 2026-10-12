// Product facts shared by every page. Keep copy here, not inside components,
// so a rename is a one-file change.
//
// No version and no file names here: the download buttons follow the newest
// GitHub release on their own (src/release.ts, src/useDownloads.ts), so a
// release that CI publishes is on the site without touching it.
import { type Os, repo } from './release'

export const site = {
  name: 'Konscious',
  tagline: 'Every Claude session, one calm place.',
  summary:
    'Run up to six Claude Code sessions and shells side by side. Each one shows whether it’s working, waiting for you, or done, so you only look where you’re needed.',
  repo,
  downloads: {
    mac: {
      os: 'macOS',
      label: 'Download for macOS',
      detail: 'Apple silicon and Intel, macOS 13 or later',
    },
    windows: {
      os: 'Windows',
      label: 'Download for Windows',
      detail: '64-bit, Windows 10 or 11',
    },
    linux: {
      os: 'Linux',
      label: 'Download for Linux',
      detail: 'AppImage, 64-bit, Ubuntu 22.04+, Debian 12+, Fedora 36+',
    },
  },
  // Claude Code's own installers (docs.claude.com/claude-code).
  claudeInstall: {
    mac: 'curl -fsSL https://claude.ai/install.sh | bash',
    windows: 'irm https://claude.ai/install.ps1 | iex',
    linux: 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  nav: [
    { label: 'Features', href: '#features' },
    { label: 'Download', href: '#download' },
    { label: 'GitHub', href: repo },
  ],
} as const

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

/** The visitor's platform decides which download leads. */
export const visitorOs: Os = /Windows/i.test(ua) ? 'windows' : /Linux/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'mac'

/** Every platform, the visitor's first. */
export const osOrder: Os[] = [visitorOs, ...(['mac', 'windows', 'linux'] as const).filter((os) => os !== visitorOs)]

/** Phones and tablets can't run the app: show them the section, not a file. */
export const onPhone = /iPhone|iPad|Android/i.test(ua)

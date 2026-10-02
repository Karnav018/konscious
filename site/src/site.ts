// Product facts shared by every page. Keep copy here, not inside components,
// so a rename or a new release is a one-file change.
const version = '0.2.2'
const repo = 'https://github.com/Karnav018/konscious'
// Installers live on the GitHub release for this version: CI builds them,
// signs them for the in-app updater and publishes them (see
// .github/workflows/release.yml). The site only links to them, so shipping a
// new version is a tag — not a site rebuild with the binaries inside it.
const installer = (name: string) => ({ name, url: `${repo}/releases/download/v${version}/${name}` })

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
      size: '10.2 MB',
      ...installer(`Konscious-${version}-universal.dmg`),
    },
    windows: {
      os: 'Windows',
      label: 'Download for Windows',
      detail: '64-bit, Windows 10 or 11',
      size: '4.1 MB',
      ...installer(`Konscious_${version}_x64-setup.exe`),
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

/** Where an installer is downloaded from. */
export const downloadUrl = (d: Download) => d.url

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

/** The visitor's platform decides which download leads. */
export const visitorOs: 'mac' | 'windows' = /Windows/i.test(ua) ? 'windows' : 'mac'

/** Phones and tablets can't run the app: show them the section, not a file. */
export const onPhone = /iPhone|iPad|Android/i.test(ua)

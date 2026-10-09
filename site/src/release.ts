// The newest published Konscious release on GitHub — the same one installed
// apps update themselves from. Plain data, no React: vite.config.ts reads it at
// build time and the page reads it again in the browser (useDownloads.ts).

export const repo = 'https://github.com/Karnav018/konscious'
export const latestApi = 'https://api.github.com/repos/Karnav018/konscious/releases/latest'
/** Always works: GitHub's page for the newest published release. */
export const latestPage = `${repo}/releases/latest`

export type Os = 'mac' | 'windows' | 'linux'

export interface Installer {
  name: string
  url: string
  bytes: number
}

export interface Release {
  version: string
  /** The release's page on GitHub: notes and every file. */
  page: string
  installers: Partial<Record<Os, Installer>>
  /** Every Linux package, by format. Absent in what older pages cached. */
  linux?: Partial<Record<LinuxFormat, Installer>>
}

export type LinuxFormat = 'appimage' | 'deb'

/** The Linux packages each release ships, as the format picker lists them. */
export const LINUX_FORMATS: { id: LinuxFormat; label: string; detail: string; name: RegExp }[] = [
  {
    id: 'appimage',
    label: 'AppImage',
    detail: 'Any distro from 2022 on: Ubuntu 22.04, Debian 12, Fedora 36, Arch and newer',
    name: /_amd64\.AppImage$/,
  },
  { id: 'deb', label: '.deb', detail: 'Ubuntu 22.04, Debian 12 and newer, and distros built on them', name: /_amd64\.deb$/ },
]

// How .github/workflows/release.yml names the installers. The `$` keeps the
// updater's signatures (…setup.exe.sig) and archives (….app.tar.gz) out.
const installerName: Record<Os, RegExp> = {
  mac: /-universal\.dmg$/,
  windows: /_x64-setup\.exe$/,
  // The AppImage runs on any distro; the .deb is on the release page.
  linux: /_amd64\.AppImage$/,
}

/**
 * Reads GitHub's `releases/latest` answer. Null unless it is a release with at
 * least one installer, so callers keep what they had rather than show an empty
 * download section.
 */
export function parseRelease(json: unknown): Release | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (typeof r.tag_name !== 'string' || !Array.isArray(r.assets)) return null

  const installers: Release['installers'] = {}
  const linux: NonNullable<Release['linux']> = {}
  for (const asset of r.assets as unknown[]) {
    if (!asset || typeof asset !== 'object') continue
    const { name, browser_download_url: url, size } = asset as Record<string, unknown>
    if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') continue
    for (const os of Object.keys(installerName) as Os[]) {
      if (installerName[os].test(name)) installers[os] = { name, url, bytes: size }
    }
    for (const f of LINUX_FORMATS) {
      if (f.name.test(name)) linux[f.id] = { name, url, bytes: size }
    }
  }
  if (!installers.mac && !installers.windows && !installers.linux) return null

  return {
    version: r.tag_name.replace(/^v/, ''),
    page: typeof r.html_url === 'string' ? r.html_url : latestPage,
    installers,
    linux,
  }
}

/** 10705201 → "10.2 MB" */
export const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

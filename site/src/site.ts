// Product facts shared by every page. Keep copy here, not inside components,
// so a rename or a new release is a one-file change.
export const site = {
  name: 'Konscious',
  tagline: 'Every Claude session, one calm place.',
  summary:
    'A desktop workspace for running many Claude Code sessions and shells side by side — live status for each one, and every session resumed when you reopen the app.',
  version: '0.1.0',
  // TODO: point at the hosted release files once there is a download host.
  downloads: {
    mac: { label: 'Download for macOS', note: 'Universal · macOS 13+', href: '#download' },
    windows: { label: 'Download for Windows', note: 'x64 installer', href: '#download' },
  },
  nav: [
    { label: 'Features', href: '#features' },
    { label: 'Download', href: '#download' },
  ],
} as const

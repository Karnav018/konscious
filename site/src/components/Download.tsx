import { site, visitorOs, type Download as File } from '../site'

const steps = {
  mac: [
    'Open the DMG and drag Konscious to Applications.',
    'Open Konscious. The first time, macOS stops it because the app isn’t notarized yet.',
    'Go to System Settings › Privacy & Security and click Open Anyway.',
  ],
  windows: [
    'Run the installer. It installs for your account only, no admin needed.',
    'If Windows says it protected your PC, click More info, then Run anyway.',
    'Open Konscious from the Start menu.',
  ],
}

export function Download() {
  const order = visitorOs === 'windows' ? (['windows', 'mac'] as const) : (['mac', 'windows'] as const)
  return (
    <section id="download" className="mx-auto max-w-6xl scroll-mt-16 px-4 pt-20 pb-28 sm:px-6">
      <h2 className="font-head text-[clamp(2rem,4vw,2.75rem)] leading-tight font-semibold tracking-[-0.03em]">
        Download Konscious
      </h2>
      <p className="mt-4 max-w-[38rem] text-lg leading-relaxed text-muted">
        Version {site.version}. Konscious runs the Claude Code you have installed, so install it and sign in first.
      </p>
      <div className="mt-12 grid gap-14 md:grid-cols-2 md:gap-16">
        {order.map((os) => (
          <Platform key={os} file={site.downloads[os]} steps={steps[os]} claude={site.claudeInstall[os]} />
        ))}
      </div>
      <p className="mt-16 text-muted">
        The source is on{' '}
        <a href={site.repo} className="text-text underline underline-offset-4 hover:text-accent">
          GitHub
        </a>
        .
      </p>
    </section>
  )
}

function Platform({ file, steps, claude }: { file: File; steps: readonly string[]; claude: string }) {
  return (
    <div className="min-w-0">
      <a
        href={file.href}
        className="inline-flex items-baseline gap-3 rounded-pill bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink hover:opacity-90"
      >
        {file.label}
        <span className="text-sm font-normal opacity-75">{file.size}</span>
      </a>
      <p className="mt-3 text-sm text-faint">{file.detail}</p>
      <h3 className="mt-9 font-semibold">First launch</h3>
      <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed text-muted marker:text-faint">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <h3 className="mt-8 font-semibold">Claude Code, if you don’t have it</h3>
      <pre className="mt-3 overflow-x-auto rounded-rs border border-line bg-surface px-4 py-3 font-mono text-[13.5px] text-text">
        <code>{claude}</code>
      </pre>
    </div>
  )
}

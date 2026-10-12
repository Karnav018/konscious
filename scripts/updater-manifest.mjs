// Builds the updater manifest the installed apps poll.
//
//   node scripts/updater-manifest.mjs <assets-dir> <version> > latest.json
//
// Every installed copy of Konscious fetches
// https://github.com/<repo>/releases/latest/download/latest.json hourly,
// compares `version` with its own and, if it is newer, downloads the artifact
// for its platform and checks it against the `signature` here with the public
// key baked into the app (src-tauri/tauri.conf.json). A missing or wrong
// signature means no update, so a half-built release must fail loudly here
// rather than ship a manifest with holes in it.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const [dir, version] = process.argv.slice(2)
if (!dir || !version) {
  console.error('usage: updater-manifest.mjs <assets-dir> <version>')
  process.exit(1)
}

const repo = process.env.GITHUB_REPOSITORY ?? 'Karnav018/konscious'
const base = `https://github.com/${repo}/releases/download/v${version}`

/** One artifact per platform key the updater asks for. */
const artifacts = {
  // The Mac build is universal: one bundle answers for both architectures.
  'darwin-aarch64': `Konscious_${version}_universal.app.tar.gz`,
  'darwin-x86_64': `Konscious_${version}_universal.app.tar.gz`,
  'windows-x86_64': `Konscious_${version}_x64-setup.exe`,
  // Linux updates in the format it was installed from: an AppImage replaces
  // itself, a .deb goes through dpkg (the updater asks for the password).
  'linux-x86_64-appimage': `Konscious_${version}_amd64.AppImage`,
  'linux-x86_64-deb': `Konscious_${version}_amd64.deb`,
  // Any other Linux install (no package type known) takes the AppImage.
  'linux-x86_64': `Konscious_${version}_amd64.AppImage`,
}

const platforms = {}
for (const [platform, file] of Object.entries(artifacts)) {
  const sig = `${dir}/${file}.sig`
  let signature
  try {
    signature = readFileSync(sig, 'utf8').trim()
  } catch {
    console.error(`✗ no signature for ${platform}: ${sig} is missing.`)
    console.error('  The build for that platform did not finish, or TAURI_SIGNING_PRIVATE_KEY was not set.')
    process.exit(1)
  }
  if (!signature) {
    console.error(`✗ empty signature for ${platform}: ${basename(sig)}`)
    process.exit(1)
  }
  platforms[platform] = { signature, url: `${base}/${file}` }
}

process.stdout.write(
  JSON.stringify(
    {
      version,
      notes: `Konscious ${version} — https://github.com/${repo}/releases/tag/v${version}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  ) + '\n',
)

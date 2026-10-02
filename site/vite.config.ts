import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { latestApi, parseRelease, type Release } from './src/release'

/**
 * Every page the site ships. A page is an HTML file in this folder plus its
 * entry in src/pages/<name>/main.tsx. The dev server serves any HTML file it
 * finds, but `vite build` only emits pages registered here.
 *
 * To add a page (e.g. /changelog):
 *   1. copy index.html to changelog.html and point its <script> at
 *      /src/pages/changelog/main.tsx
 *   2. create src/pages/changelog/main.tsx (`mount(<Changelog />)`)
 *   3. register it below: `changelog: 'changelog.html'`
 */
const pages: Record<string, string> = {
  landing: 'index.html',
}

const root = (file: string) => fileURLToPath(new URL(file, import.meta.url))

/**
 * The newest GitHub release when the site is built. It is the page's starting
 * point: the page then asks GitHub itself (src/useDownloads.ts), and only falls
 * back to this if that request fails. If this fails too, the buttons open the
 * release page on GitHub, which always lists the newest files.
 */
async function latestAtBuild(): Promise<Release | null> {
  try {
    const res = await fetch(latestApi, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const release = parseRelease(await res.json())
    if (!release) throw new Error('it has no installers')
    console.log(`latest release: ${release.version}`)
    return release
  } catch (e) {
    console.warn(`couldn't read the latest release (${e instanceof Error ? e.message : e}); the page will ask GitHub itself`)
    return null
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  define: { __LATEST_RELEASE__: JSON.stringify(await latestAtBuild()) },
  // 1420 belongs to the desktop app's dev server. Bind IPv4 explicitly: Node
  // resolves "localhost" to ::1 only, and some browsers then can't connect.
  server: { host: '127.0.0.1', port: 1430 },
  preview: { host: '127.0.0.1', port: 1431 },
  build: {
    rollupOptions: {
      input: Object.fromEntries(Object.entries(pages).map(([name, file]) => [name, root(file)])),
    },
  },
}))

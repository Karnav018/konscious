import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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

// The download buttons link straight to the installers on the GitHub release
// for this version (src/site.ts), so the site ships no binaries of its own.

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 1420 belongs to the desktop app's dev server. Bind IPv4 explicitly: Node
  // resolves "localhost" to ::1 only, and some browsers then can't connect.
  server: { host: '127.0.0.1', port: 1430 },
  preview: { host: '127.0.0.1', port: 1431 },
  build: {
    rollupOptions: {
      input: Object.fromEntries(Object.entries(pages).map(([name, file]) => [name, root(file)])),
    },
  },
})

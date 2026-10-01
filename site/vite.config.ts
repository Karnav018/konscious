import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { site } from './src/site'

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
 * Serves the installers the page links to at /download/<name>, read straight
 * from ../release (they're never copied into site/). The build fails if one
 * is missing, so the site can't ship a dead download button.
 */
function installers(): Plugin {
  const files = Object.values(site.downloads).map((d) => ({ name: d.name, path: root(`../release/${d.release}`) }))
  return {
    name: 'konscious-installers',
    configureServer(server) {
      server.middlewares.use('/download', (req, res, next) => {
        const file = files.find((f) => req.url === `/${f.name}`)
        if (!file || !existsSync(file.path)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`)
        res.setHeader('Content-Length', statSync(file.path).size)
        createReadStream(file.path).pipe(res)
      })
    },
    generateBundle() {
      for (const f of files) {
        if (!existsSync(f.path)) this.error(`installer missing: ${f.path} — build it first (scripts/build-mac.sh / build-windows.sh)`)
        this.emitFile({ type: 'asset', fileName: `download/${f.name}`, source: readFileSync(f.path) })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), installers()],
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

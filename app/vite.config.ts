import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

import { refuseBadNode } from './scripts/check-node.mjs'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(() => {
  // Only for tests. Node 23 hangs vitest; it is not known to break a build or
  // the dev server, and refusing those on a hunch would be overreach. VITEST
  // is set by the time vitest loads this config and is absent for a build —
  // checked, rather than assumed. This is the half the pretest hook misses:
  // a direct `npx vitest run`, which is how this gets run while debugging.
  if (process.env.VITEST) refuseBadNode()

  return {
    plugins: [react(), tailwindcss()],

    // Tauri: keep Rust errors visible and use the fixed dev port.
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    build: { chunkSizeWarningLimit: 1500 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }
})

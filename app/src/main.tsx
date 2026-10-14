import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
// The interface font is Poppins in every theme but Paper and Risograph,
// which are IBM Plex Mono throughout; the rest are Terminal font choices.
// Bundled, since the app works offline; a face is only read from disk once
// something uses it.
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/700.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/700.css'
import '@fontsource/source-code-pro/400.css'
import '@fontsource/source-code-pro/700.css'
import '@fontsource/inconsolata/400.css'
import '@fontsource/inconsolata/700.css'
import '@fontsource/ubuntu-mono/400.css'
import '@fontsource/ubuntu-mono/700.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import './styles/globals.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import { diagnostics } from './state/act'
import { flash } from './state/commands/ui'

// Last line of defence: log and tell the user, never leave the UI wedged.
let lastReport = 0
const report = (what: unknown) => {
  console.error(what)
  const now = Date.now()
  if (now - lastReport < 5000) return
  lastReport = now
  const msg = what instanceof Error ? what.message : String((what as { message?: string })?.message ?? what)
  flash(`Something went wrong: ${msg.slice(0, 120)}`)
}
window.addEventListener('error', (e) => report(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => report(e.reason))

// Support hook: `__cwDiagnostics()` in the webview console prints recent
// actions, state counts and any invariant violations (never terminal output).
;(globalThis as unknown as { __cwDiagnostics: typeof diagnostics }).__cwDiagnostics = diagnostics

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

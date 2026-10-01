// Shared entry for every page: fonts, global styles, one React root.
// A page's main.tsx is just `mount(<Page />)`.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '../styles/global.css'

import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

export function mount(page: ReactNode) {
  createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode>{page}</StrictMode>)
}

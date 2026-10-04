// Opening a bundle: from the ⌘O footer, or from the system when a .kon is
// double-clicked. Both land in the same import sheet.
import { ipc } from '../lib/ipc'
import { openImport } from '../state/commands/ui'

/** The ⌘O footer's "Import…": pick a .kon, then show what it holds. */
export async function pickAndImport() {
  const path = await ipc.pickBundle().catch(() => null)
  if (path) openImport(path)
}

/** Double-clicking a .kon, or "Open with Konscious". A file chosen before the
 *  interface was listening is held by the engine and collected here. */
export function startBundleOpens() {
  void ipc.bundlePending().then((path) => path && openImport(path)).catch(() => {})
  return ipc.onBundleOpened(openImport)
}

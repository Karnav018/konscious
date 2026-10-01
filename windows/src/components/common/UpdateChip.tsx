import { installUpdate, updateDetail, updateLabel } from '../../lib/update'
import { useUi } from '../../state/selectors'
import { DownloadIcon } from './Icon'

/**
 * Title-bar chip for a background update: quiet grey while it downloads, then
 * the one accent button that restarts into the new version. Nothing at all
 * when there is no update, which is almost always.
 */
export function UpdateChip() {
  const update = useUi((u) => u.update)
  const label = updateLabel(update)
  if (!label) return null
  const ready = update.state === 'ready'
  return (
    <div
      onClick={ready ? () => void installUpdate() : undefined}
      title={updateDetail(update)}
      aria-live="polite"
      className={`h-[26px] flex items-center gap-1.5 px-[10px] rounded-pill border text-[12px] font-medium whitespace-nowrap flex-none ${
        ready ? 'border-accent text-accent bg-accent-soft cursor-pointer hover:bg-hover' : 'border-line text-muted'
      }`}
    >
      <DownloadIcon size={12} />
      {label}
    </div>
  )
}

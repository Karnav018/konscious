import { useUi } from '../../state/selectors'

export function Toast() {
  const toast = useUi((u) => u.toast)
  if (!toast) return null
  return (
    <div className="absolute left-1/2 bottom-10 -translate-x-1/2 px-3.5 py-2 rounded-rs bg-text text-win text-[12.5px] z-30 shadow-pop max-w-[80%] text-center">
      {toast}
    </div>
  )
}

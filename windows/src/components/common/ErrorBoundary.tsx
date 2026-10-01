// A render error must never blank the window. Sessions live in Rust, so
// reloading the interface is always safe: every terminal re-attaches and
// replays its recent output.
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Compact fallback for a single pane instead of the full-screen card. */
  compact?: boolean
  label?: string
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label ?? 'ui'}]`, error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const reload = () => window.location.reload()
    if (this.props.compact) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 bg-pane border border-line rounded-r text-center min-w-0 min-h-0">
          <span className="text-[12.5px] text-muted">This pane hit an error. The session is still running.</span>
          <div className="flex gap-2">
            <div onClick={() => this.setState({ error: null })} className="h-7 px-3 flex items-center rounded-rs border border-line2 cursor-pointer text-[12px]">
              Retry
            </div>
            <div onClick={reload} className="h-7 px-3 flex items-center rounded-rs bg-accent text-accent-ink cursor-pointer text-[12px] font-medium">
              Reload interface
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center max-w-[440px]">
          <div className="font-head text-[20px] font-semibold">The interface hit an error</div>
          <div className="text-muted leading-[1.5]">
            Your sessions are still running. Reloading the interface reconnects every pane.
          </div>
          <div className="font-mono text-[11.5px] text-faint max-w-full whitespace-nowrap overflow-hidden text-ellipsis">
            {error.message}
          </div>
          <div onClick={reload} className="h-8 px-3.5 flex items-center rounded-rs bg-accent text-accent-ink cursor-pointer font-medium">
            Reload interface
          </div>
        </div>
      </div>
    )
  }
}

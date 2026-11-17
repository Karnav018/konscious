// A Claude session asking before it opens, stops or restarts a session, or
// changes how the app looks (app/agentKit.ts). Nothing happens until the
// person says so. The dialog doesn't take the keyboard: it can appear while
// someone is typing into a pane, and a stray Enter must not answer for them.
// Escape and a click outside mean no.
import { answerAgentAsk } from '../../app/agent'
import { useUi } from '../../state/selectors'
import { SessionAvatar } from '../common/SessionAvatar'
import { SettingsIcon } from '../common/Icon'

export function AgentAskDialog() {
  const ask = useUi((u) => u.agentAsk)
  if (!ask) return null

  return (
    <div
      onMouseDown={() => answerAgentAsk(false)}
      className="absolute inset-0 bg-overlay flex justify-center items-center z-30"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-ask-title"
      aria-describedby="agent-ask-body"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[460px] max-w-[calc(100%-40px)] bg-raised border border-line2 rounded-r shadow-pop flex flex-col gap-3.5 p-[18px]"
      >
        <div className="flex items-center gap-2.5">
          {ask.avatar ? (
            <SessionAvatar name={ask.avatar} size={32} />
          ) : (
            <div className="w-8 h-8 rounded-rs grid place-items-center flex-none bg-sel text-accent">
              <SettingsIcon size={16} />
            </div>
          )}
          <span id="agent-ask-title" className="font-head text-[16px] font-semibold min-w-0 leading-[1.3]">
            {ask.from} {ask.asks}
          </span>
        </div>
        <dl id="agent-ask-body" className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 m-0 text-[12.5px]">
          {ask.rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-muted">{r.label}</dt>
              <dd
                className={`m-0 min-w-0 ${r.mono ? 'font-mono text-[12px] break-all' : 'font-medium'} ${
                  r.long ? 'max-h-[132px] overflow-y-auto whitespace-pre-wrap leading-[1.5] font-normal bg-pane border border-line rounded-rs px-2.5 py-2' : ''
                }`}
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="text-[12px] text-muted leading-[1.5]">{ask.note}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => answerAgentAsk(false)}
            className="h-8 px-3.5 flex items-center rounded-rs border border-line2 bg-transparent cursor-pointer text-[12.5px] text-text hover:bg-hover"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => answerAgentAsk(true)}
            className="h-8 px-3.5 flex items-center rounded-rs border-0 cursor-pointer text-[12.5px] font-medium bg-accent text-accent-ink"
          >
            {ask.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

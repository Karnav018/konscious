// First-run screen (design lines 75–107), wired to the real CLI check,
// folder picker and folder suggestions.
import { kbd } from '../../lib/platform'
import { addWorkspace, openNewSession, pickWorkspaceFolder } from '../../app/actions'
import { tildify } from '../../lib/format'
import { useUi } from '../../state/selectors'
import { CheckIcon, CloseIcon } from '../common/Icon'
import { Wordmark } from '../common/Wordmark'

function Step(props: { mark: React.ReactNode; title: string; sub: React.ReactNode; action?: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${props.last ? '' : 'border-b border-line'}`}>
      {props.mark}
      <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
        <span className="font-medium">{props.title}</span>
        {props.sub}
      </div>
      {props.action}
    </div>
  )
}

const numbered = (n: number) => (
  <div className="w-[22px] h-[22px] rounded-[11px] border border-line2 text-muted grid place-items-center flex-none text-[11px] font-mono">
    {n}
  </div>
)

export function FirstRun() {
  const env = useUi((u) => u.env)
  const envError = useUi((u) => u.envError)
  const home = useUi((u) => u.init?.home)
  const suggestions = useUi((u) => u.suggestions)

  const cli = env?.claudePath
    ? {
        mark: (
          <div className="w-[22px] h-[22px] rounded-[11px] bg-ok text-pane grid place-items-center flex-none">
            <CheckIcon />
          </div>
        ),
        title: 'Claude CLI found',
        sub: (
          <span className="font-mono text-[11.5px] text-muted">
            {tildify(env.claudePath, home)}
            {env.claudeVersion ? ` · v${env.claudeVersion}` : ''}
          </span>
        ),
      }
    : env || envError
      ? {
          mark: (
            <div className="w-[22px] h-[22px] rounded-[11px] bg-err text-pane grid place-items-center flex-none">
              <CloseIcon size={12} />
            </div>
          ),
          title: 'Claude CLI not found',
          sub: (
            <span className="text-[12px] text-muted">
              {envError ?? 'Install Claude Code, or set "claudePath" in ~/.kova/config.json. Terminal panes still work.'}
            </span>
          ),
        }
      : {
          mark: numbered(1),
          title: 'Looking for Claude CLI…',
          sub: <span className="text-[12px] text-muted">Reading your login shell environment.</span>,
        }

  const root = suggestions[0]?.root
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-[560px] flex flex-col gap-[22px]">
        <div className="flex flex-col gap-[10px]">
          <Wordmark size={40} />
          <div className="font-head text-[30px] font-semibold tracking-[-0.02em] leading-[1.1]">Every Claude session, one calm place.</div>
          <div className="text-muted text-[14px] leading-[1.55]">
            Run, organize, switch and restore all your Claude CLI sessions from one place. Every pane is the real{' '}
            <span className="font-mono text-[13px] text-text">claude</span> — Claude keeps its conversations, Git keeps your
            history.
          </div>
        </div>

        <div className="flex flex-col border border-line rounded-r bg-pane">
          <Step {...cli} />
          <Step
            mark={numbered(2)}
            title="Create a workspace"
            sub={<span className="text-[12px] text-muted">A workspace is a project folder. Sessions and layout live inside it.</span>}
            action={
              <div
                onClick={() => void pickWorkspaceFolder()}
                className="h-[30px] px-3 flex items-center rounded-rs border border-line2 bg-raised cursor-pointer text-[12.5px] font-medium hover:border-accent"
              >
                Choose folder…
              </div>
            }
          />
          <Step
            last
            mark={numbered(3)}
            title="Start a Claude session"
            sub={<span className="text-[12px] text-muted">Name it, pick a directory, and it launches in its own pane.</span>}
            action={
              <div
                onClick={() => void openNewSession()}
                className="h-[30px] px-3 flex items-center gap-2 rounded-rs bg-accent text-accent-ink cursor-pointer text-[12.5px] font-medium"
              >
                New session <span className="font-mono text-[11px] opacity-75">{kbd('N')}</span>
              </div>
            }
          />
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="font-head text-[11.5px] text-faint font-semibold">Found in {root}</div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((f) => (
                <div
                  key={f.path}
                  onClick={() => addWorkspace(f.path)}
                  title={f.path}
                  className="h-[30px] px-3 flex items-center gap-2 rounded-rs border border-dashed border-line2 cursor-pointer font-mono text-[12px] text-muted hover:border-accent hover:text-text"
                >
                  + {f.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

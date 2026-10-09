// Connectors: MCP servers offered to the Claude sessions Konscious launches.
//
// Konscious is not the MCP client — each session is. Switching one on writes
// a small JSON file and points that session's own `claude` at it with
// --mcp-config, which merges with whatever servers the user already has. So:
// their ~/.claude.json is never touched, no .mcp.json is written into their
// repos, and no token ever reaches Konscious, because signing in happens
// inside Claude with /mcp.
//
// Everything here is pure. src-tauri/src/mcp.rs writes the file and validates
// again on its own side; these two must agree, which is why the rules are
// spelled out in both rather than trusted across the boundary.

export interface Connector {
  /** The key Claude shows in a tool name: mcp__<id>__<tool>. */
  id: string
  name: string
  url: string
  /** One line for the catalog row. */
  desc: string
  /** Anything the user should know before switching it on. */
  caveat?: string
}

/**
 * The connectors Konscious ships.
 *
 * Zomato only, for now, and deliberately. Swiggy runs official MCP servers
 * too — /food, /im and /dineout under mcp.swiggy.com — but their manifest
 * says in as many words that "third-party app development is not permitted
 * at this time", and their OAuth redirect whitelist names claude.ai, ChatGPT,
 * VSCode and Postman while omitting Claude Code. Shipping switches for a
 * service that has not permitted it, and that would probably refuse the
 * sign-in anyway, is not something to do on the user's behalf. Anyone who
 * wants it can add it below as a custom server, where it is plainly their
 * choice rather than our endorsement.
 */
export const CONNECTORS: readonly Connector[] = [
  {
    id: 'zomato',
    name: 'Zomato',
    url: 'https://mcp-server.zomato.com/mcp',
    desc: 'Search restaurants and track an order from a session.',
  },
]

/** What a server may be called: the id becomes part of every tool name
 *  Claude shows, so it is short and lowercase or it is unreadable. */
export const NAME_RE = /^[a-z0-9_-]{1,32}$/

export const validName = (name: string): boolean => NAME_RE.test(name)

/** https only. A connector is a service you are about to sign in to, and an
 *  OAuth round trip over plain http is not something to offer. */
export function validUrl(url: string): boolean {
  if (!url.startsWith('https://') || url.length > 2048) return false
  const rest = url.slice('https://'.length)
  if (!rest || rest.startsWith('/')) return false
  // eslint-disable-next-line no-control-regex
  return !/[\s\u0000-\u001f]/.test(url)
}

export interface Custom {
  name: string
  url: string
}

export interface ConnectorState {
  /** Which shipped connectors are on. */
  builtin: Record<string, boolean>
  /** Servers the user added themselves. */
  custom: Custom[]
}

export const freshConnectors = (): ConnectorState => ({ builtin: {}, custom: [] })

/** How many a user may add. A cap because every one of these is a server
 *  every session is told about, and a hundred would be a slow startup and an
 *  unreadable tool list. */
export const CUSTOM_CAP = 12

/** Whether a custom entry can be added: valid, and not already taken — by
 *  another custom entry or by one of ours. */
export function canAdd(state: ConnectorState, entry: Custom): boolean {
  if (!validName(entry.name) || !validUrl(entry.url)) return false
  if (state.custom.length >= CUSTOM_CAP) return false
  if (state.custom.some((c) => c.name === entry.name)) return false
  return !CONNECTORS.some((c) => c.id === entry.name)
}

/** What gets written for a session: the shipped ones that are on, then the
 *  user's own. Shipped first, so a custom entry can never quietly shadow
 *  one of ours — the writer keeps the first of a duplicated name. */
export function enabled(state: ConnectorState): { name: string; url: string }[] {
  const mine = CONNECTORS.filter((c) => state.builtin[c.id]).map((c) => ({ name: c.id, url: c.url }))
  const theirs = state.custom.filter((c) => validName(c.name) && validUrl(c.url))
  const taken = new Set(mine.map((c) => c.name))
  return [...mine, ...theirs.filter((c) => !taken.has(c.name))]
}

/** Whether any connector is on, which is what decides if --mcp-config is
 *  passed at all. */
export const anyOn = (state: ConnectorState): boolean => enabled(state).length > 0

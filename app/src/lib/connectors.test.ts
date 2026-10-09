/// <reference types="node" />
import { describe, expect, it } from 'vitest'

import {
  anyOn,
  canAdd,
  CONNECTORS,
  type ConnectorState,
  CUSTOM_CAP,
  enabled,
  freshConnectors,
  validName,
  validUrl,
} from './connectors'

const state = (over: Partial<ConnectorState> = {}): ConnectorState => ({ ...freshConnectors(), ...over })

describe('what ships', () => {
  it('offers Zomato, whose server is official and unrestricted', () => {
    expect(CONNECTORS.map((c) => c.id)).toEqual(['zomato'])
    expect(CONNECTORS[0].url).toBe('https://mcp-server.zomato.com/mcp')
  })

  it('ships no Swiggy switch', () => {
    // Their manifest says third-party app development is not permitted at
    // this time, and their OAuth whitelist omits Claude Code. Anyone who
    // wants it adds it as a custom server, where it is their call.
    expect(CONNECTORS.some((c) => /swiggy/i.test(c.id) || /swiggy/i.test(c.url))).toBe(false)
  })

  it('gives every connector a usable id and an https url', () => {
    for (const c of CONNECTORS) {
      expect(validName(c.id), c.id).toBe(true)
      expect(validUrl(c.url), c.url).toBe(true)
    }
  })

  it('is off until switched on', () => {
    expect(enabled(freshConnectors())).toEqual([])
    expect(anyOn(freshConnectors())).toBe(false)
  })
})

describe('what a server may be called', () => {
  it('takes what reads well in a tool name', () => {
    for (const ok of ['zomato', 'my_server', 'a-b', 'x9', 'a'.repeat(32)]) expect(validName(ok), ok).toBe(true)
  })

  it('refuses what would not', () => {
    for (const bad of ['', 'Zomato', 'with space', 'dots.here', 'a/b', 'a'.repeat(33), 'pizza🍕']) {
      expect(validName(bad), bad).toBe(false)
    }
  })
})

describe('what a server url may be', () => {
  it('insists on https', () => {
    expect(validUrl('https://mcp.example.com/mcp')).toBe(true)
    expect(validUrl('http://mcp.example.com/mcp')).toBe(false)
    expect(validUrl('mcp.example.com')).toBe(false)
    expect(validUrl('')).toBe(false)
    expect(validUrl('https://')).toBe(false)
    expect(validUrl('https:///nohost')).toBe(false)
  })

  it('refuses anything that would not survive the trip', () => {
    expect(validUrl('https://x.test/a b')).toBe(false)
    expect(validUrl('https://x.test/\nHost: evil')).toBe(false)
    expect(validUrl(`https://x.test/${'a'.repeat(3000)}`)).toBe(false)
  })
})

describe('adding one of your own', () => {
  it('accepts a valid pair', () => {
    expect(canAdd(freshConnectors(), { name: 'blinkit', url: 'https://example.test/mcp' })).toBe(true)
  })

  it('refuses an invalid name or url', () => {
    expect(canAdd(freshConnectors(), { name: 'Bad Name', url: 'https://x.test' })).toBe(false)
    expect(canAdd(freshConnectors(), { name: 'ok', url: 'http://x.test' })).toBe(false)
  })

  it('refuses a name already taken', () => {
    const s = state({ custom: [{ name: 'mine', url: 'https://a.test' }] })
    expect(canAdd(s, { name: 'mine', url: 'https://b.test' })).toBe(false)
    // including one of ours, which a custom entry must not shadow
    expect(canAdd(freshConnectors(), { name: 'zomato', url: 'https://evil.test' })).toBe(false)
  })

  it('stops at the cap', () => {
    const many = Array.from({ length: CUSTOM_CAP }, (_, i) => ({ name: `s${i}`, url: 'https://a.test' }))
    expect(canAdd(state({ custom: many }), { name: 'one-more', url: 'https://a.test' })).toBe(false)
  })
})

describe('what gets written for a session', () => {
  it('writes only what is switched on', () => {
    expect(enabled(state({ builtin: { zomato: true } }))).toEqual([
      { name: 'zomato', url: 'https://mcp-server.zomato.com/mcp' },
    ])
    expect(enabled(state({ builtin: { zomato: false } }))).toEqual([])
  })

  it('includes the user’s own servers', () => {
    const got = enabled(state({ builtin: { zomato: true }, custom: [{ name: 'mine', url: 'https://a.test' }] }))
    expect(got.map((c) => c.name)).toEqual(['zomato', 'mine'])
  })

  it('never lets a custom entry shadow one of ours', () => {
    // canAdd refuses this, but a hand-edited config could still carry it.
    const got = enabled(state({ builtin: { zomato: true }, custom: [{ name: 'zomato', url: 'https://evil.test' }] }))
    expect(got).toHaveLength(1)
    expect(got[0].url).toBe('https://mcp-server.zomato.com/mcp')
  })

  it('drops a saved entry that is no longer valid', () => {
    const got = enabled(state({ custom: [{ name: 'ok', url: 'http://insecure.test' }] }))
    expect(got).toEqual([])
  })

  it('knows whether the flag is needed at all', () => {
    expect(anyOn(state({ builtin: { zomato: true } }))).toBe(true)
    expect(anyOn(state({ custom: [{ name: 'mine', url: 'https://a.test' }] }))).toBe(true)
    expect(anyOn(state({ custom: [{ name: 'bad', url: 'http://x.test' }] }))).toBe(false)
  })
})

describe('a change reaches new sessions only', () => {
  it('is read at start rather than watched', async () => {
    // The guarantee is structural, not a runtime check: app/actions.ts reads
    // the enabled list when it builds the spec, and Rust writes the file
    // once per run. Nothing watches the store, so a running session cannot
    // be reached into — which is the behaviour the catalog copy promises.
    const actions = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../app/actions.ts', import.meta.url), 'utf8'),
    )
    expect(actions).toContain('connectors: m.kind === ')
    // A shell has no MCP client to tell.
    expect(actions).toMatch(/kind === 'claude' \? enabled\(/)
  })
})

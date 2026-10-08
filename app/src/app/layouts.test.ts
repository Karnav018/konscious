import { beforeEach, describe, expect, it } from 'vitest'

import { arrangementKey, layTree, setWeights } from '../lib/layouts'
import { layoutOf, openPane, setLayoutTree, toggleFocus } from '../state/commands/layout'
import { setNotesOpen } from '../state/commands/notes'
import { addSession, addWorkspace, setActiveWorkspace } from '../state/commands/workspace'
import { decode, hydrate, serialize } from '../state/persistence'
import { getState, initialState, useApp } from '../state/store'
import type { Kind, SessionMeta } from '../types'
import { cycleGridLayout, evenOutPanes, gridPanes, pickGridLayout } from './layouts'

const session = (id: string, workspaceId: string, kind: Kind): SessionMeta => ({
  id, workspaceId, kind, name: id, cwd: '/p', claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
})
const layout = () => layoutOf(getState().layout.byWorkspace, getState().workspace.activeId)

/** A workspace with these panes open in the grid. */
function stage(...kinds: Kind[]) {
  const ws = addWorkspace('/p/hawk')
  setActiveWorkspace(ws.id)
  kinds.forEach((k, i) => {
    addSession(session(`s${i}`, ws.id, k))
    openPane(`s${i}`)
  })
  return ws.id
}

const two = layTree('balanced', [0, 1].map((i) => ({ i, terminal: false })))

beforeEach(() => useApp.setState(initialState(), true))

describe('picking a layout', () => {
  it('starts on balanced rows, and a pick sticks to the workspace', () => {
    stage('claude', 'claude', 'claude')
    expect(layout().grid).toBe('balanced')
    pickGridLayout('lead')
    expect(layout().grid).toBe('lead')
  })

  it('a layout these panes cannot use is refused, with the reason', () => {
    stage('claude', 'claude')
    pickGridLayout('strip')
    expect(layout().grid).toBe('balanced')
    expect(getState().ui.toast).toBe('Needs a terminal in the grid')
  })

  it('from Focus or Notes, picking shows the grid', () => {
    const ws = stage('claude', 'shell')
    toggleFocus(ws, 's0')
    setNotesOpen(true)
    pickGridLayout('columns')
    expect(layout().mode).toBe('grid')
    expect(getState().ui.notesOpen).toBe(false)
  })

  it('takes care of the suggestion for this mix, and the keys flash the picture', () => {
    stage('claude', 'shell', 'claude')
    const hud = getState().ui.layoutHud
    pickGridLayout('columns', { hud: true })
    expect(getState().ui.layoutNudge.seen['3:1']).toBe(true)
    expect(getState().ui.layoutHud).toBe(hud + 1)
  })
})

describe('cycling', () => {
  it('⌘L goes round the layouts these panes can use', () => {
    stage('claude', 'claude', 'claude')
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      cycleGridLayout(1)
      seen.push(layout().grid)
    }
    // Strip needs a terminal: skipped.
    expect(seen).toEqual(['lead', 'columns', 'free', 'balanced', 'lead'])
    cycleGridLayout(-1)
    expect(layout().grid).toBe('balanced')
  })

  it('one pane: nothing to cycle', () => {
    stage('claude')
    cycleGridLayout(1)
    expect(layout().grid).toBe('balanced')
    expect(getState().ui.toast).toBe('Layouts apply from 2 panes')
  })
})

describe('pane sizes', () => {
  it('are kept per arrangement; Even out forgets them', () => {
    const ws = stage('claude', 'claude')
    const key = arrangementKey('balanced', gridPanes().kinds)
    setLayoutTree(ws, key, setWeights(two, 'r', [0.7, 0.3]))
    expect(Object.keys(layout().trees)).toEqual([key])
    evenOutPanes()
    expect(layout().trees).toEqual({})
    expect(getState().ui.toast).toBe('Sizes evened out')
  })

  it('layout and sizes survive a restart; an older layout file gets the defaults', () => {
    const ws = stage('claude', 'shell')
    pickGridLayout('lead')
    const dragged = setWeights(two, 'r', [0.6, 0.4])
    setLayoutTree(ws, 'lead:2', dragged)
    const files = serialize()
    useApp.setState(initialState(), true)
    hydrate(decode({ ...files, corrupt: [], restored: [] }))
    expect(layout()).toMatchObject({ grid: 'lead', trees: { 'lead:2': dragged } })

    const { grid: _g, trees: _t, ...older } = files.layouts[ws] as Record<string, unknown>
    const dec = decode({ ...files, layouts: { [ws]: older }, corrupt: [], restored: [] })
    expect(dec.layouts[ws]).toMatchObject({ grid: 'balanced', trees: {} })
  })

  it('bad arrangements on disk are dropped, not the layout', () => {
    const ws = stage('claude', 'claude')
    const files = serialize()
    const bad = { ...(files.layouts[ws] as object), grid: 'spiral', trees: { 'balanced:2': { dir: 'row', kids: [{ leaf: 0 }], w: [-1] } } }
    const dec = decode({ ...files, layouts: { [ws]: bad }, corrupt: [], restored: [] })
    expect(dec.layouts[ws]).toMatchObject({ grid: 'balanced', trees: {}, open: ['s0', 's1'] })
  })
})

// @vitest-environment happy-dom
import { act as rtlAct, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { layoutOf, openPane } from '../../state/commands/layout'
import { addSession, addWorkspace, setActiveWorkspace } from '../../state/commands/workspace'
import { getState, initialState, useApp } from '../../state/store'
import type { Kind, SessionMeta } from '../../types'
import { LayoutTile } from './LayoutTile'

const session = (id: string, workspaceId: string, kind: Kind): SessionMeta => ({
  id, workspaceId, kind, name: id, cwd: '/p', claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
})
let wsId = ''
const open = (id: string, kind: Kind) =>
  rtlAct(() => {
    addSession(session(id, wsId, kind))
    openPane(id)
  })
const grid = () => layoutOf(getState().layout.byWorkspace, wsId).grid
const option = (name: string) => screen.getByRole('menuitemradio', { name: new RegExp(name) })

beforeEach(() => {
  useApp.setState(initialState(), true)
  wsId = addWorkspace('/p/hawk').id
  setActiveWorkspace(wsId)
})
afterEach(cleanup)

describe('the layout tile', () => {
  it('opens the Grid layout menu with all five layouts', () => {
    open('a', 'claude')
    open('b', 'claude')
    render(<LayoutTile edge="right" size={30} />)
    fireEvent.click(screen.getByLabelText('Grid layout'))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
    expect(screen.getByText('2 panes')).toBeTruthy()
    expect(option('Balanced rows').getAttribute('aria-checked')).toBe('true')
  })

  it('a layout that cannot be used says why and does nothing', () => {
    open('a', 'claude')
    open('b', 'claude')
    render(<LayoutTile edge="right" size={30} />)
    fireEvent.click(screen.getByLabelText('Grid layout'))
    expect(option('Terminal strip').getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Needs a terminal in the grid')).toBeTruthy()
    fireEvent.click(option('Terminal strip'))
    expect(grid()).toBe('balanced')
    fireEvent.click(option('Lead \\+ stack'))
    expect(grid()).toBe('lead')
    expect(getState().ui.layoutMenu).toBe(false)
  })

  it('suggests a better fit once, when the mix of panes changes', () => {
    open('a', 'claude')
    open('b', 'claude')
    render(<LayoutTile edge="right" size={30} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    open('t1', 'shell')
    // 3 panes with a terminal: Column stacks fits better.
    expect(screen.getByRole('dialog').textContent).toContain('3 panes now — try Column stacks')
    fireEvent.click(screen.getByText('Use it'))
    expect(grid()).toBe('columns')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Keep" waves the suggestion off for that mix', () => {
    open('a', 'claude')
    open('b', 'claude')
    render(<LayoutTile edge="right" size={30} />)
    open('t1', 'shell')
    fireEvent.click(screen.getByText('Keep Rows'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(grid()).toBe('balanced')
    expect(getState().ui.layoutNudge.seen['3:1']).toBe(true)
  })
})

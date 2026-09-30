// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { requestDeleteSession } from '../../app/actions'
import { askDeleteSession } from '../../state/commands/ui'
import { addSession, addWorkspace } from '../../state/commands/workspace'
import { getState, initialState, useApp } from '../../state/store'
import { DeleteSessionDialog } from './DeleteSessionDialog'

describe('DeleteSessionDialog', () => {
  beforeEach(() => {
    useApp.setState(initialState(), true)
    const ws = addWorkspace('/p/knowra')
    addSession({
      id: 's-flutter', workspaceId: ws.id, name: 'Flutter App', kind: 'claude', cwd: '/p/knowra',
      claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
    })
    askDeleteSession('s-flutter')
  })
  afterEach(cleanup)

  const button = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Delete session'))!

  it('stays disabled until "delete" is typed', () => {
    const { container, getByLabelText } = render(<DeleteSessionDialog />)
    expect(container.textContent).toContain('Delete “Flutter App”?')
    expect(button(container).disabled).toBe(true)
    const input = getByLabelText('Type delete to confirm')
    fireEvent.change(input, { target: { value: 'delet' } })
    fireEvent.click(button(container))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(getState().workspace.sessions['s-flutter']).toBeDefined()
    fireEvent.change(input, { target: { value: 'delete' } })
    expect(button(container).disabled).toBe(false)
  })

  it('deletes the session once confirmed, and the dialog closes', () => {
    const { container, getByLabelText } = render(<DeleteSessionDialog />)
    fireEvent.change(getByLabelText('Type delete to confirm'), { target: { value: 'DELETE' } })
    fireEvent.click(button(container))
    expect(getState().workspace.sessions['s-flutter']).toBeUndefined()
    expect(getState().ui.confirmDelete).toBeNull()
  })
})

describe('requestDeleteSession', () => {
  beforeEach(() => {
    useApp.setState(initialState(), true)
    const ws = addWorkspace('/p/knowra')
    for (const [id, kind] of [['s-claude', 'claude'], ['s-term', 'shell']] as const) {
      addSession({
        id, workspaceId: ws.id, name: id, kind, cwd: '/p/knowra',
        claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
      })
    }
  })

  it('asks for typed confirmation for Claude sessions only', () => {
    requestDeleteSession('s-claude')
    expect(getState().ui.confirmDelete).toBe('s-claude')
    expect(getState().workspace.sessions['s-claude']).toBeDefined()
  })

  it('deletes terminals immediately, without the dialog', () => {
    requestDeleteSession('s-term')
    expect(getState().workspace.sessions['s-term']).toBeUndefined()
    expect(getState().ui.confirmDelete).toBeNull()
  })
})

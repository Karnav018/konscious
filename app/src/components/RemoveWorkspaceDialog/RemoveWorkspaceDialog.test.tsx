// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real actions pull in the terminal engine (xterm); the dialog only needs
// to hand the removal over.
vi.mock('../../app/actions', () => ({ removeWorkspace: vi.fn() }))

import { removeWorkspace } from '../../app/actions'
import { askRemoveWorkspace } from '../../state/commands/ui'
import { addSession, addWorkspace } from '../../state/commands/workspace'
import { initialState, useApp } from '../../state/store'
import type { SessionMeta } from '../../types'
import { RemoveWorkspaceDialog } from './RemoveWorkspaceDialog'

const session = (id: string, workspaceId: string, kind: SessionMeta['kind']): SessionMeta => ({
  id, workspaceId, kind, name: id, cwd: '/p', claudeSessionId: null, wasRunning: false, fontSize: null, createdAt: 1, lastActiveAt: 1,
})

const removeButton = () => screen.getByRole('button', { name: 'Remove from Konscious' }) as HTMLButtonElement

describe('removing a workspace asks first', () => {
  beforeEach(() => {
    useApp.setState(initialState(), true)
    vi.mocked(removeWorkspace).mockClear()
  })
  afterEach(cleanup)

  it('says the folder stays on disk', () => {
    const ws = addWorkspace('/p/empty')
    askRemoveWorkspace(ws.id)
    render(<RemoveWorkspaceDialog />)
    expect(screen.getByRole('dialog').textContent).toContain('stays on disk')
    expect(screen.getByRole('dialog').textContent).toContain('It has no sessions.')
  })

  it('removes a workspace without Claude sessions in one click', () => {
    const ws = addWorkspace('/p/shells')
    addSession(session('t1', ws.id, 'shell'))
    askRemoveWorkspace(ws.id)
    render(<RemoveWorkspaceDialog />)
    expect(screen.queryByLabelText('Type remove to confirm')).toBeNull()
    fireEvent.click(removeButton())
    expect(removeWorkspace).toHaveBeenCalledWith(ws.id)
  })

  it('wants "remove" typed when Claude sessions would go with it', () => {
    const ws = addWorkspace('/p/hawk')
    addSession(session('c1', ws.id, 'claude'))
    addSession(session('t1', ws.id, 'shell'))
    askRemoveWorkspace(ws.id)
    render(<RemoveWorkspaceDialog />)
    expect(screen.getByRole('dialog').textContent).toContain('/resume')
    expect(removeButton().disabled).toBe(true)
    fireEvent.click(removeButton())
    expect(removeWorkspace).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Type remove to confirm'), { target: { value: 'Remove ' } })
    expect(removeButton().disabled).toBe(false)
    fireEvent.click(removeButton())
    expect(removeWorkspace).toHaveBeenCalledWith(ws.id)
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AttachedFiles } from './AttachedFiles'
import { ipc } from '../../lib/ipc'
import { attachFiles } from '../../state/commands/ui'
import { addSession, addWorkspace } from '../../state/commands/workspace'
import { initialState, useApp } from '../../state/store'
import type { SessionMeta } from '../../types'

/** A real session, because attachments for one that does not exist are an
 *  invariant violation and get repaired away — as they should be. */
function seed(id: string) {
  const ws = addWorkspace('/p/demo')
  const meta: SessionMeta = {
    id,
    workspaceId: ws.id,
    name: id,
    kind: 'claude',
    cwd: '/p/demo',
    claudeSessionId: '00000000-0000-4000-8000-000000000000',
    wasRunning: false,
    fontSize: null,
    createdAt: 1,
    lastActiveAt: 1,
  }
  addSession(meta)
}

describe('the attachment strip', () => {
  beforeEach(() => {
    useApp.setState(initialState(), true)
    seed('s1')
    vi.spyOn(ipc, 'fileThumbnail').mockResolvedValue('data:image/png;base64,AAAA')
    vi.spyOn(ipc, 'openFile').mockResolvedValue(undefined as never)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows nothing until something is dropped', () => {
    const r = render(<AttachedFiles id="s1" />)
    expect(r.container.firstChild).toBeNull()
  })

  it('shows a chip per dropped file, newest last', () => {
    attachFiles('s1', ['/a/shot.png', '/a/notes.pdf'])
    const r = render(<AttachedFiles id="s1" />)
    expect(r.getByText('shot.png')).toBeTruthy()
    expect(r.getByText('notes.pdf')).toBeTruthy()
  })

  it('asks the engine for a thumbnail of an image, and draws it', async () => {
    attachFiles('s1', ['/a/shot.png'])
    const r = render(<AttachedFiles id="s1" />)
    await waitFor(() => expect(r.container.querySelector('img')).not.toBeNull())
    expect(ipc.fileThumbnail).toHaveBeenCalledWith('/a/shot.png')
    expect(r.container.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('never asks for a thumbnail of something that is not an image', () => {
    attachFiles('s1', ['/a/notes.pdf'])
    render(<AttachedFiles id="s1" />)
    expect(ipc.fileThumbnail).not.toHaveBeenCalled()
  })

  it('opens a file in the system viewer when its chip is clicked', () => {
    attachFiles('s1', ['/a/shot.png'])
    const r = render(<AttachedFiles id="s1" />)
    fireEvent.click(r.getByText('shot.png'))
    expect(ipc.openFile).toHaveBeenCalledWith('/a/shot.png')
  })

  it('keeps each pane’s files to itself', () => {
    attachFiles('s1', ['/a/shot.png'])
    const r = render(<AttachedFiles id="s2" />)
    expect(r.container.firstChild).toBeNull()
  })
})

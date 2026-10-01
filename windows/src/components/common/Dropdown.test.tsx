// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dropdown } from './Dropdown'

const options = [
  { value: 'knowra', label: 'knowra', detail: '~/Products/knowra' },
  { value: 'unigym', label: 'unigym', detail: '~/Desktop/Projects/unigym' },
  { value: 'impelzone-gunsafety', label: 'impelzone-gunsafety', detail: '~/Products/impelzone-gunsafety' },
]

describe('Dropdown', () => {
  afterEach(cleanup)

  it('shows the full current label and lists every option with its path', () => {
    const { getByRole, getAllByRole } = render(<Dropdown options={options} value="impelzone-gunsafety" onChange={() => {}} />)
    const box = getByRole('combobox')
    expect(box.textContent).toContain('impelzone-gunsafety')
    fireEvent.click(box)
    const items = getAllByRole('option')
    expect(items).toHaveLength(3)
    expect(items[1].textContent).toContain('~/Desktop/Projects/unigym')
  })

  it('chooses by click and by keyboard', () => {
    const onChange = vi.fn()
    const { getByRole, getAllByRole, queryByRole } = render(<Dropdown options={options} value="knowra" onChange={onChange} />)
    fireEvent.click(getByRole('combobox'))
    fireEvent.click(getAllByRole('option')[1])
    expect(onChange).toHaveBeenLastCalledWith('unigym')
    expect(queryByRole('listbox')).toBeNull()

    const box = getByRole('combobox')
    fireEvent.keyDown(box, { key: 'ArrowDown' }) // open
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('impelzone-gunsafety')
  })

  it('Escape closes only the list', () => {
    const { getByRole, queryByRole } = render(<Dropdown options={options} value="knowra" onChange={() => {}} />)
    fireEvent.click(getByRole('combobox'))
    fireEvent.keyDown(getByRole('combobox'), { key: 'Escape' })
    expect(queryByRole('listbox')).toBeNull()
  })
})

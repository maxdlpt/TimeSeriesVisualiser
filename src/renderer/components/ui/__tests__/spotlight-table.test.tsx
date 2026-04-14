// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpotlightTable } from '../spotlight-table'

interface Row {
  id: number
  name: string
  role: string
}

const ROWS: Row[] = [
  { id: 1, name: 'Astra', role: 'Engineer' },
  { id: 2, name: 'Bravo', role: 'Designer' },
  { id: 3, name: 'Charlie', role: 'Marketing' },
]

const COLUMNS = [
  { key: 'name' as const, label: 'Name' },
  { key: 'role' as const, label: 'Role' },
]

describe('SpotlightTable', () => {
  it('renders all rows and the column headers', () => {
    render(<SpotlightTable rows={ROWS} columns={COLUMNS} />)
    expect(screen.getByText('Name')).toBeDefined()
    expect(screen.getByText('Role')).toBeDefined()
    expect(screen.getByText('Astra')).toBeDefined()
    expect(screen.getByText('Bravo')).toBeDefined()
    expect(screen.getByText('Charlie')).toBeDefined()
  })

  it('invokes onRowClick with the clicked row', async () => {
    const onRowClick = vi.fn()
    const user = userEvent.setup()
    render(
      <SpotlightTable
        rows={ROWS}
        columns={COLUMNS}
        onRowClick={onRowClick}
        rowKey={(r) => r.id}
      />
    )
    await user.click(screen.getByText('Bravo'))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1])
  })

  it('dims non-matching rows when a search query is active', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <SpotlightTable
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
      />
    )
    const input = container.querySelector('input') as HTMLInputElement
    await user.type(input, 'astra')
    const rows = container.querySelectorAll('tbody tr')
    // Astra is at index 0 (hit), Bravo and Charlie should be dimmed.
    expect(rows[0].className).toContain('opacity-100')
    expect(rows[1].className).toContain('opacity-20')
    expect(rows[2].className).toContain('opacity-20')
  })
})

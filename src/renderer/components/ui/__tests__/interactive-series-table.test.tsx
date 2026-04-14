// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InteractiveSeriesTable } from '../interactive-series-table'

interface Group {
  title: string
}
interface Row {
  name: string
}

const GROUPS = [
  {
    id: 'a',
    group: { title: 'Equities' },
    rows: [{ name: 'AAPL' }, { name: 'MSFT' }],
  },
  {
    id: 'b',
    group: { title: 'Rates' },
    rows: [{ name: 'US10Y' }],
  },
]

describe('InteractiveSeriesTable', () => {
  it('renders group headers and hides rows by default', () => {
    render(
      <InteractiveSeriesTable<Group, Row>
        groups={GROUPS}
        groupHeader={(g) => <span>{g.title}</span>}
        rowRender={(r) => <span>{r.name}</span>}
      />
    )
    expect(screen.getByText('Equities')).toBeDefined()
    expect(screen.getByText('Rates')).toBeDefined()
    expect(screen.queryByText('AAPL')).toBeNull()
    expect(screen.queryByText('US10Y')).toBeNull()
  })

  it('reveals rows when the group header is clicked and collapses on second click', async () => {
    const user = userEvent.setup()
    render(
      <InteractiveSeriesTable<Group, Row>
        groups={GROUPS}
        groupHeader={(g) => <span>{g.title}</span>}
        rowRender={(r) => <span>{r.name}</span>}
      />
    )
    const header = screen.getByRole('button', { name: /equities/i })
    await user.click(header)
    expect(screen.getByText('AAPL')).toBeDefined()
    expect(screen.getByText('MSFT')).toBeDefined()
    expect(header.getAttribute('aria-expanded')).toBe('true')

    await user.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })

  it('respects defaultExpanded by showing rows immediately', () => {
    render(
      <InteractiveSeriesTable<Group, Row>
        groups={GROUPS}
        groupHeader={(g) => <span>{g.title}</span>}
        rowRender={(r) => <span>{r.name}</span>}
        defaultExpanded
      />
    )
    expect(screen.getByText('AAPL')).toBeDefined()
    expect(screen.getByText('US10Y')).toBeDefined()
  })
})

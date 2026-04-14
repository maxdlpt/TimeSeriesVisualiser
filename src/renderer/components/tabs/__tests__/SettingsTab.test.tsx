// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsTab } from '../SettingsTab'
import { useAppStore } from '../../../store/app'
import { useDBStore } from '../../../store/db'

beforeEach(() => {
  useAppStore.setState({ theme: 'system', colorPalette: 'default' })
  useDBStore.setState({ externalDBs: [] })
  // jsdom doesn't implement matchMedia — the 'system' theme branch in
  // applyTheme reads it, so stub it as "light mode" for determinism.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

describe('SettingsTab', () => {
  it('renders the three sections (theme, palette, external DBs)', () => {
    render(<SettingsTab />)
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /theme/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /colou?r palette/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /external databases/i })).toBeInTheDocument()
  })

  it('clicking a theme button updates useAppStore.theme', async () => {
    const user = userEvent.setup()
    render(<SettingsTab />)

    await user.click(screen.getByRole('button', { name: /^dark$/i }))
    expect(useAppStore.getState().theme).toBe('dark')

    await user.click(screen.getByRole('button', { name: /^light$/i }))
    expect(useAppStore.getState().theme).toBe('light')
  })

  it('clicking a palette swatch updates useAppStore.colorPalette', async () => {
    const user = userEvent.setup()
    render(<SettingsTab />)

    await user.click(screen.getByRole('button', { name: /palette-pastel/i }))
    expect(useAppStore.getState().colorPalette).toBe('pastel')
  })

  it('renders the empty-state message when no external DBs are configured', () => {
    render(<SettingsTab />)
    expect(screen.getByText(/no external databases configured/i)).toBeInTheDocument()
  })

  it('lists external DBs from the db store', () => {
    useDBStore.setState({
      externalDBs: [
        { id: 'a', name: 'Macro', path: 'C:/data/macro.db', reachable: true },
        { id: 'b', name: 'Prices', path: '/tmp/prices.db', reachable: false },
      ],
    })
    render(<SettingsTab />)
    expect(screen.getByText('Macro')).toBeInTheDocument()
    expect(screen.getByText('C:/data/macro.db')).toBeInTheDocument()
    expect(screen.getByText('Prices')).toBeInTheDocument()
  })

  it('renders the "Browse for DB file" button with disabled TODO state', () => {
    render(<SettingsTab />)
    const addButton = screen.getByRole('button', { name: /browse for db file/i })
    // Skeleton pass: button is rendered but disabled until Task 4 wires up the IPC.
    expect(addButton).toBeDisabled()
  })
})

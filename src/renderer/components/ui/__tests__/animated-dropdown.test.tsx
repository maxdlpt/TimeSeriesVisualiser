// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnimatedDropdown from '../animated-dropdown'

const ITEMS = [
  { label: 'Monthly', value: 'monthly' as const },
  { label: 'Quarterly', value: 'quarterly' as const },
  { label: 'Yearly', value: 'yearly' as const },
]

describe('AnimatedDropdown', () => {
  it('renders the trigger with the default text when no value is selected', () => {
    render(
      <AnimatedDropdown items={ITEMS} onSelect={vi.fn()} text="Frequency" />
    )
    expect(screen.getByRole('button', { name: /frequency/i })).toBeDefined()
  })

  it('opens the listbox on click and calls onSelect with the item value', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <AnimatedDropdown items={ITEMS} onSelect={onSelect} text="Frequency" />
    )

    await user.click(screen.getByRole('button', { name: /frequency/i }))
    expect(screen.getByRole('listbox')).toBeDefined()

    await user.click(screen.getByRole('option', { name: 'Quarterly' }))
    expect(onSelect).toHaveBeenCalledWith('quarterly')
  })

  it('shows the selected label when value is provided', () => {
    render(
      <AnimatedDropdown
        items={ITEMS}
        value="yearly"
        onSelect={vi.fn()}
        text="Frequency"
      />
    )
    expect(screen.getByRole('button', { name: /yearly/i })).toBeDefined()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DataSeries } from '../../../../shared/types'
import { useGraphStore } from '../../../store/graph'
import { useAppStore } from '../../../store/app'

// Mock the upload primitives so the tab tests focus on compositional behaviour,
// not parse-on-input (already covered in FileDropZone.test.tsx / the primitives).
vi.mock('../../upload/FileDropZone', () => ({
  FileDropZone: ({ onSeries }: { onSeries: (s: DataSeries[]) => void }) => (
    <div data-testid="file-drop-zone">
      <button
        type="button"
        data-testid="file-emit"
        onClick={() =>
          onSeries([
            makeSeries('upload-1', 'Alpha'),
            makeSeries('upload-2', 'Beta'),
          ])
        }
      >
        emit-file
      </button>
    </div>
  ),
}))

vi.mock('../../upload/PasteTable', () => ({
  PasteTable: ({ onSeries }: { onSeries: (s: DataSeries[]) => void }) => (
    <div data-testid="paste-table">
      <button
        type="button"
        data-testid="paste-emit"
        onClick={() => onSeries([makeSeries('paste-1', 'Pasted')])}
      >
        emit-paste
      </button>
    </div>
  ),
}))

// Mock UploadTablePage — renders a "Done" button that passes series through
vi.mock('../../upload/UploadTablePage', () => ({
  UploadTablePage: ({ series, onDone, onCancel }: {
    series: DataSeries[]
    onDone: (s: DataSeries[]) => void
    onCancel: () => void
  }) => (
    <div data-testid="upload-table-page">
      <span>{series.length} series in table</span>
      <button type="button" data-testid="table-done" onClick={() => onDone(series)}>Done</button>
      <button type="button" data-testid="table-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

// Mock UploadCardPage — renders series names + Add/Cancel buttons
vi.mock('../../upload/UploadCardPage', () => ({
  UploadCardPage: ({ series, onCancel }: {
    series: DataSeries[]
    onDispatch: (a: unknown[]) => Promise<boolean>
    onDiscard: (id: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="upload-card-page">
      {series.map((s: DataSeries) => (
        <span key={s.id}>{s.name}</span>
      ))}
      <button type="button" data-testid="cards-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

// Import AFTER vi.mock() so hoisted mocks take effect.
import { UploadTab } from '../UploadTab'

function makeSeries(id: string, name: string): DataSeries {
  const pt = [{ date: new Date('2020-01-01'), value: 100 }]
  return {
    id,
    name,
    code: name.toUpperCase(),
    description: '',
    source: 'memory',
    points: pt,
    originalPoints: pt.map((p) => ({ ...p })),
  }
}

beforeEach(() => {
  useGraphStore.setState({ activeSeries: [], zoomDomain: null, rightPanel: null })
  useAppStore.setState({ activeTab: 'upload', theme: 'system', colorPalette: 'default' })
})

describe('UploadTab', () => {
  it('renders heading and the File/Paste mode selector', () => {
    render(<UploadTab />)
    expect(screen.getByRole('heading', { name: /upload series/i })).toBeInTheDocument()
    expect(screen.getByText(/^file$/i)).toBeInTheDocument()
    expect(screen.getByText(/^paste$/i)).toBeInTheDocument()
  })

  it('defaults to File mode and renders FileDropZone', () => {
    render(<UploadTab />)
    expect(screen.getByTestId('file-drop-zone')).toBeInTheDocument()
    expect(screen.queryByTestId('paste-table')).not.toBeInTheDocument()
  })

  it('switches to Paste mode and renders PasteTable', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByText(/^paste$/i))
    expect(screen.getByTestId('paste-table')).toBeInTheDocument()
    expect(screen.queryByTestId('file-drop-zone')).not.toBeInTheDocument()
  })

  it('transitions to table phase after file emit', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    // Should now show the table page
    expect(screen.getByTestId('upload-table-page')).toBeInTheDocument()
    expect(screen.getByText('2 series in table')).toBeInTheDocument()
    // Input primitives should be gone
    expect(screen.queryByTestId('file-drop-zone')).not.toBeInTheDocument()
  })

  it('transitions to cards phase after table Done', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    await user.click(screen.getByTestId('table-done'))
    // Should now show the card page with series names
    expect(screen.getByTestId('upload-card-page')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('cancel from table returns to input mode', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    expect(screen.getByTestId('upload-table-page')).toBeInTheDocument()

    await user.click(screen.getByTestId('table-cancel'))
    expect(screen.getByTestId('file-drop-zone')).toBeInTheDocument()
    expect(screen.queryByTestId('upload-table-page')).not.toBeInTheDocument()
  })

  it('cancel from cards returns to input mode', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    await user.click(screen.getByTestId('table-done'))
    expect(screen.getByTestId('upload-card-page')).toBeInTheDocument()

    await user.click(screen.getByTestId('cards-cancel'))
    expect(screen.getByTestId('file-drop-zone')).toBeInTheDocument()
    expect(screen.queryByTestId('upload-card-page')).not.toBeInTheDocument()
  })

  it('assigns colors from palette starting at activeSeries.length offset', async () => {
    // Seed one existing series so the palette offset is non-zero.
    const existing = makeSeries('existing-1', 'Existing')
    useGraphStore.setState({ activeSeries: [{ ...existing, color: '#3b82f6' }] })

    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    // Reaches the table phase — series have been colored at offset 1
    expect(screen.getByTestId('upload-table-page')).toBeInTheDocument()
  })
})

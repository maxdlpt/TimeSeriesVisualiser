import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSVText } from '../../lib/parse'
import { ipc } from '../../lib/ipc'
import type { DataSeries } from '../../../shared/types'

interface Props {
  onSeries: (series: DataSeries[]) => void
}

type Grid = string[][]

function gridToCSV(grid: Grid): string {
  return grid.map((row) => row.map((cell) => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`
    }
    return cell
  }).join(',')).join('\n')
}

/** Forward parsed series immediately — no intermediate grid UI. */
function forwardGrid(grid: Grid, onSeries: (s: DataSeries[]) => void): boolean {
  const csv = gridToCSV(grid)
  const series = parseCSVText(csv)
  if (series.length > 0 && series[0].points.length > 0) {
    onSeries(series)
    return true
  }
  return false
}

/**
 * Read spreadsheet data from the OS clipboard via the main process.
 * Retries up to 3 times with increasing delays (the clipboard may be
 * locked by the browser during paste event processing).
 */
async function readClipboardWithRetry(): Promise<Grid | null> {
  const delays = [0, 100, 300]
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    try {
      const grid = await ipc.clipboard.readSpreadsheet()
      if (grid && grid.length > 0) return grid
    } catch { /* IPC error — retry */ }
  }
  return null
}

export function PasteTable({ onSeries }: Props) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  useEffect(() => {
    zoneRef.current?.focus()
  }, [])

  // Both Ctrl+V and button use the same IPC path — the main process reads
  // unsanitized HTML from the OS clipboard (preserving Excel's x:num attributes
  // for full precision), which the web clipboard API strips out.
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    e.preventDefault()
    setParseError(null)

    const grid = await readClipboardWithRetry()

    if (!grid) {
      setParseError('Could not read clipboard. Try the "Paste from clipboard" button below.')
      return
    }

    if (!forwardGrid(grid, onSeries)) {
      setParseError('No valid series found. Ensure the first column contains dates and other columns contain numbers.')
    }
  }, [onSeries])

  const handleClipboardButton = useCallback(async () => {
    setParseError(null)
    try {
      const grid = await ipc.clipboard.readSpreadsheet()

      if (grid && grid.length > 0) {
        if (forwardGrid(grid, onSeries)) return
        setParseError('No valid series found. Ensure the first column contains dates and other columns contain numbers.')
        return
      }

      setParseError('Clipboard is empty. Copy data first, then click this button.')
    } catch {
      setParseError('Clipboard access denied. Use Ctrl+V to paste instead.')
    }
  }, [onSeries])

  return (
    <div
      ref={zoneRef}
      tabIndex={0}
      onPaste={handlePaste}
      className={[
        'flex flex-col items-center justify-center min-h-48 rounded-lg gap-3',
        'border-2 border-dashed border-border',
        'text-muted-foreground text-sm cursor-text',
        'focus:outline-none focus:border-primary transition-colors',
      ].join(' ')}
    >
      <p className="font-medium">Paste your data here (Ctrl+V)</p>
      <p className="text-xs">First row = headers (date, series1, series2…). First column = dates.</p>
      <button
        type="button"
        onClick={handleClipboardButton}
        className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
      >
        Paste from clipboard
      </button>
      {parseError && (
        <p className="text-xs text-amber-500">{parseError}</p>
      )}
    </div>
  )
}

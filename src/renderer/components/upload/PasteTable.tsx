import { useState, useEffect, useCallback } from 'react'
import { parseCSVText } from '../../lib/parse'
import type { DataSeries } from '../../../shared/types'

interface Props {
  onSeries: (series: DataSeries[]) => void
}

type Grid = string[][]

function parseToGrid(text: string): Grid {
  const rows = text.split(/\r?\n/).map((row) => row.split('\t'))
  // Pad shorter rows to the maximum row length so the table is rectangular
  const maxCols = Math.max(...rows.map((r) => r.length))
  return rows.map((r) => {
    const padded = [...r]
    while (padded.length < maxCols) padded.push('')
    return padded
  })
}

function gridToCSV(grid: Grid): string {
  return grid.map((row) => row.join(',')).join('\n')
}

export function PasteTable({ onSeries }: Props) {
  const [grid, setGrid] = useState<Grid | null>(null)

  // Re-parse whenever grid changes
  useEffect(() => {
    if (!grid) return
    const csv = gridToCSV(grid)
    const series = parseCSVText(csv)
    if (series.length > 0 && series[0].points.length > 0) {
      onSeries(series)
    }
  }, [grid, onSeries])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text.trim()) return
    e.preventDefault()
    setGrid(parseToGrid(text.trim()))
  }, [])

  const updateCell = useCallback((rowIdx: number, colIdx: number, value: string) => {
    setGrid((prev) => {
      if (!prev) return prev
      const next = prev.map((r) => [...r])
      next[rowIdx][colIdx] = value
      return next
    })
  }, [])

  if (!grid) {
    return (
      <div
        tabIndex={0}
        onPaste={handlePaste}
        className={[
          'flex flex-col items-center justify-center min-h-48 rounded-lg',
          'border-2 border-dashed border-gray-300 dark:border-gray-700',
          'text-gray-400 dark:text-gray-500 text-sm cursor-text',
          'focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors',
        ].join(' ')}
      >
        <p className="font-medium">Click here, then paste your data</p>
        <p className="text-xs mt-1">First row = headers (date, series1, series2…). First column = dates.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onPaste={handlePaste}
        className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800"
      >
        <table className="min-w-full text-sm border-collapse">
          <tbody>
            {grid.map((row, ri) => (
              <tr
                key={ri}
                className={ri === 0 ? 'bg-gray-50 dark:bg-gray-900' : ''}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border border-gray-200 dark:border-gray-700 p-0"
                  >
                    <input
                      value={cell}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      className={[
                        'w-full min-w-[80px] px-2 py-1 bg-transparent',
                        'focus:outline-none focus:bg-blue-50 dark:focus:bg-blue-900/20',
                        ri === 0 ? 'font-semibold' : 'font-mono',
                      ].join(' ')}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setGrid(null)}
        className="self-start text-xs text-gray-400 hover:text-red-500 transition-colors"
      >
        Clear table
      </button>
    </div>
  )
}

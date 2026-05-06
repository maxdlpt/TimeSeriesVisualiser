import { useState, useCallback, useRef, useMemo } from 'react'
import { Check, Plus } from 'lucide-react'
import { parseCSVText, parseClipboardHtml, parseExcelBuffer } from '../../lib/parse'
import { ipc } from '../../lib/ipc'
import type { DataSeries } from '../../../shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

type Grid = string[][]

interface Props {
  series: DataSeries[]
  onDone: (series: DataSeries[]) => void
  onCancel: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert parsed DataSeries[] into an editable grid (dates × series). */
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_LOOKUP: Record<string, number> = {}
SHORT_MONTHS.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i })

function fmtDateDisplay(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = SHORT_MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day} ${mon} ${year}`
}

/** Parse "dd mmm yyyy" back to a sortable YYYY-MM-DD key. */
function displayDateToKey(s: string): string {
  const parts = s.trim().split(/\s+/)
  if (parts.length !== 3) return s
  const day = parts[0].padStart(2, '0')
  const mi = MONTH_LOOKUP[parts[1].toLowerCase()]
  if (mi === undefined) return s
  const month = String(mi + 1).padStart(2, '0')
  return `${parts[2]}-${month}-${day}`
}

/**
 * Format a value cell for display: "2.12345%" → " 2.12 %"
 * Negatives use accounting-style parentheses: "-1.50%" → "(1.50)%"
 * Positive values are padded so the decimal point aligns with negatives.
 */
function displayPct(raw: string): string {
  if (raw.endsWith('%')) {
    const n = parseFloat(raw.slice(0, -1))
    if (!isNaN(n)) {
      if (n < 0) return `(${Math.abs(n).toFixed(2)})%`
      // Pad with a leading space to match the '(' width on negatives,
      // and a trailing space to match the ')'.
      return `\u2007${n.toFixed(2)}\u2007%`
    }
  }
  return raw
}

function seriesToGrid(series: DataSeries[]): Grid {
  // Union all dates, sorted ascending
  const dateSet = new Map<string, Date>()
  for (const s of series) {
    for (const p of s.points) {
      const key = p.date.toISOString().slice(0, 10)
      if (!dateSet.has(key)) dateSet.set(key, p.date)
    }
  }
  const sortedDates = [...dateSet.entries()].sort(
    (a, b) => a[1].getTime() - b[1].getTime(),
  )

  // Build lookup: seriesId → { dateKey → value }
  const lookups = series.map((s) => {
    const map = new Map<string, number>()
    for (const p of s.points) map.set(p.date.toISOString().slice(0, 10), p.value)
    return map
  })

  // Header row
  const header = ['date', ...series.map((s) => s.name)]

  // Data rows — display-formatted dates and percentage values
  const rows = sortedDates.map(([dateKey, dateObj]) => [
    fmtDateDisplay(dateObj),
    ...lookups.map((lk) => {
      const v = lk.get(dateKey)
      return v != null ? `${v}%` : ''
    }),
  ])

  return [header, ...rows]
}

/** Pad every row to `cols` width. */
function padGrid(grid: Grid, cols: number): Grid {
  return grid.map((row) => {
    if (row.length >= cols) return row
    return [...row, ...Array(cols - row.length).fill('')]
  })
}

function gridToCSV(grid: Grid): string {
  return grid
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
            return `"${cell.replace(/"/g, '""')}"`
          return cell
        })
        .join(','),
    )
    .join('\n')
}

/**
 * Run a raw pasted grid through the same parseCSVText pipeline used by
 * PasteTable / FileDropZone — handles date disambiguation, value conversion
 * (cleanNumericRich, ×100 for bare decimals), and data-type detection.
 * Returns null if parsing finds no valid series.
 */
function parsePastedGrid(raw: Grid): DataSeries[] | null {
  const csv = gridToCSV(raw)
  const series = parseCSVText(csv)
  if (series.length > 0 && series[0].points.length > 0) return series
  return null
}

/** Strip all trailing empty columns from a grid. */
function stripTrailingEmpty(grid: Grid): Grid {
  if (grid.length === 0) return grid
  // Find the last column that has any non-empty content
  let lastDataCol = 0
  for (let ci = grid[0].length - 1; ci >= 1; ci--) {
    if (grid.some((row) => (row[ci] ?? '').trim() !== '')) {
      lastDataCol = ci
      break
    }
  }
  return grid.map((r) => r.slice(0, lastDataCol + 1))
}

/**
 * Merge new columns (from seriesToGrid output) into the existing grid,
 * aligned by date.  Tries exact YYYY-MM-DD match first, then YYYY-MM.
 * Unmatched dates are appended and the grid is re-sorted.
 * Returns the grid with exactly 1 trailing empty column.
 */
function mergeDateAligned(
  grid: Grid,
  newGrid: Grid, // seriesToGrid output: [header, ...dataRows], col 0 = date
): Grid {
  // Strip trailing empty columns so insertAt is always right after real data
  const clean = stripTrailingEmpty(grid)
  const insertAt = clean[0].length // append at the end of data columns

  const newHeaders = newGrid[0].slice(1) // skip "date"
  const colCount = newHeaders.length
  const emptyVals: string[] = Array(colCount).fill('')

  // Index existing grid dates using sortable YYYY-MM-DD keys
  const exactIndex = new Map<string, number>()
  const monthIndex = new Map<string, number>()
  for (let r = 1; r < clean.length; r++) {
    const dk = displayDateToKey(clean[r][0])
    if (!exactIndex.has(dk)) exactIndex.set(dk, r)
    const mk = dk.slice(0, 7)
    if (!monthIndex.has(mk)) monthIndex.set(mk, r)
  }

  // Map each new row to a grid row
  const gridRowToValues = new Map<number, string[]>()
  const unmappedNewRows: number[] = []

  for (let nr = 1; nr < newGrid.length; nr++) {
    const dk = displayDateToKey(newGrid[nr][0])
    const vals = newGrid[nr].slice(1)

    let gridRow = exactIndex.get(dk)
    if (gridRow === undefined) gridRow = monthIndex.get(dk.slice(0, 7))

    if (gridRow !== undefined && !gridRowToValues.has(gridRow)) {
      gridRowToValues.set(gridRow, vals)
    } else {
      unmappedNewRows.push(nr)
    }
  }

  // Build result — append new columns at the end of each row
  const next = clean.map((r) => [...r])
  next[0].push(...newHeaders)
  for (let r = 1; r < next.length; r++) {
    next[r].push(...(gridRowToValues.get(r) ?? emptyVals))
  }

  // Append unmapped rows (dates not in existing grid)
  if (unmappedNewRows.length > 0) {
    for (const nr of unmappedNewRows) {
      const row: string[] = Array(insertAt).fill('')
      row[0] = newGrid[nr][0]
      row.push(...newGrid[nr].slice(1))
      while (row.length < next[0].length) row.push('')
      next.push(row)
    }
    const header = next.shift()!
    next.sort((a, b) => displayDateToKey(a[0]).localeCompare(displayDateToKey(b[0])))
    next.unshift(header)
  }

  // Add exactly 1 trailing empty column
  const maxCols = Math.max(...next.map((r) => r.length))
  return padGrid(next, maxCols + 1)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UploadTablePage({ series, onDone, onCancel }: Props) {
  // Build grid from series + 1 empty column for pasting
  const [grid, setGrid] = useState<Grid>(() => {
    const base = seriesToGrid(series)
    return padGrid(base, base[0].length + 1)
  })

  const tableRef = useRef<HTMLTableElement>(null)
  const addMoreRef = useRef<HTMLInputElement>(null)
  const [focusedCell, setFocusedCell] = useState<string | null>(null)

  const updateCell = useCallback((ri: number, ci: number, value: string) => {
    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      next[ri][ci] = value
      return next
    })
  }, [])

  // Paste handler: if pasting into the empty column area, expand the grid
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // Intercept paste if the grid has any empty column (the "paste here" slot)
      const hasEmptyCol = grid[0].some((_, ci) =>
        ci > 0 && grid.every((row) => (row[ci] ?? '').trim() === ''))
      if (!hasEmptyCol) return

      e.preventDefault()
      e.stopPropagation()

      // Extract what we can from the web clipboard API (synchronous, before event expires)
      let htmlGrid: Grid | null = null
      const html = e.clipboardData.getData('text/html')
      if (html) {
        const parsed = parseClipboardHtml(html)
        if (parsed && parsed.length > 0) htmlGrid = parsed
      }
      let textGrid: Grid | null = null
      const text = e.clipboardData.getData('text/plain')
      if (text.trim()) {
        textGrid = text.trim().split(/\r?\n/).map((row) => row.split('\t'))
      }

      // Also try main-process clipboard (reads binary Excel formats — full untruncated data)
      let ipcGrid: Grid | null = null
      try { ipcGrid = await ipc.clipboard.readSpreadsheet() } catch { /* IPC unavailable */ }

      // Pick the grid with the most rows
      const candidates = [ipcGrid, htmlGrid, textGrid].filter(
        (g): g is Grid => g != null && g.length > 0,
      )
      if (candidates.length === 0) return
      const pastedGrid = candidates.reduce((best, g) => g.length > best.length ? g : best)

      // Run pasted data through the SAME parseCSVText pipeline that PasteTable uses.
      // This handles date disambiguation, value conversion, and data-type detection.
      const parsed = parsePastedGrid(pastedGrid)

      if (parsed && parsed.length > 0) {
        // parseCSVText succeeded — date-aligned merge via seriesToGrid
        const newGrid = seriesToGrid(parsed)
        setGrid((prev) => mergeDateAligned(prev, newGrid))
        return
      }

      // parseCSVText failed (e.g., single column of values, no date column).
      // Fall back to row-index insertion.
      const dataRowCount = grid.length - 1
      const pastedHasHeader = pastedGrid.length === dataRowCount + 1
      const pastedIsValuesOnly =
        pastedGrid.length === dataRowCount ||
        pastedGrid.length === dataRowCount + 1

      setGrid((prev) => {
        const clean = stripTrailingEmpty(prev)
        const next = clean.map((r) => [...r])
        const insertAt = next[0].length // append at end

        if (pastedIsValuesOnly) {
          const pastedCols = pastedGrid![0].length
          for (let r = 0; r < next.length; r++) {
            const pastedRow = pastedHasHeader
              ? pastedGrid![r]
              : r === 0
                ? Array(pastedCols).fill('')
                : pastedGrid![r - 1]
            if (pastedRow) next[r].push(...pastedRow)
          }
        } else {
          const pastedCols = Math.max(...pastedGrid!.map((r) => r.length))
          for (let r = 0; r < Math.max(next.length, pastedGrid!.length); r++) {
            if (r >= next.length) {
              const newRow = Array(insertAt).fill('')
              newRow.push(...(pastedGrid![r] ?? []))
              while (newRow.length < insertAt + pastedCols) newRow.push('')
              next.push(newRow)
            } else {
              next[r].push(...(pastedGrid![r] ?? Array(pastedCols).fill('')))
            }
          }
        }

        // Ensure exactly 1 trailing empty column
        const maxCols = Math.max(...next.map((r) => r.length))
        return padGrid(next, maxCols + 1)
      })
    },
    [grid],
  )

  // "Add more" file handler — date-aligned merge
  const handleAddMoreFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (addMoreRef.current) addMoreRef.current.value = ''
      try {
        const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
        let newSeries: DataSeries[]
        if (ext === '.csv' || ext === '.tsv' || file.type === 'text/csv') {
          newSeries = parseCSVText(await file.text())
        } else {
          newSeries = parseExcelBuffer(await file.arrayBuffer())
        }
        if (newSeries.length === 0) return

        const newGrid = seriesToGrid(newSeries)
        setGrid((prev) => mergeDateAligned(prev, newGrid))
      } catch {
        /* ignore */
      }
    },
    [],
  )

  // "Done" — re-parse the grid into series
  const handleDone = useCallback(() => {
    // Strip trailing empty columns before parsing
    const trimmed = grid.map((row) => {
      let end = row.length
      while (end > 1 && row[end - 1].trim() === '') end--
      return row.slice(0, end)
    })
    const csv = gridToCSV(trimmed)
    const parsed = parseCSVText(csv)
    if (parsed.length > 0) onDone(parsed)
  }, [grid, onDone])

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
      let nextRow = ri
      let nextCol = ci
      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          nextCol = ci - 1
          if (nextCol < 0) {
            nextCol = grid[0].length - 1
            nextRow = ri - 1
          }
        } else {
          nextCol = ci + 1
          if (nextCol >= grid[0].length) {
            nextCol = 0
            nextRow = ri + 1
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        nextRow = e.shiftKey ? ri - 1 : ri + 1
      } else {
        return
      }
      if (nextRow < 0 || nextRow >= grid.length) return
      const cell = tableRef.current?.querySelector<HTMLInputElement>(
        `tr:nth-child(${nextRow + 1}) td:nth-child(${nextCol + 1}) input`,
      )
      cell?.focus()
      cell?.select()
    },
    [grid],
  )

  // Determine which columns are "empty" (no header and no data)
  const isEmptyCol = (ci: number) => {
    if (ci === 0) return false
    return grid.every((row) => (row[ci] ?? '').trim() === '')
  }

  const dataColCount = grid[0].slice(1).filter((_, i) => !isEmptyCol(i + 1)).length

  // Compute uniform series column width: fit the widest displayed value OR header.
  // All non-empty series columns share the same width.
  const seriesColWidth = useMemo(() => {
    const CHAR_PX = 7.2 // monospace char width at text-sm (tabular-nums)
    const PAD = 24       // px horizontal padding
    let widestChars = 0

    for (let ci = 1; ci < grid[0].length; ci++) {
      if (grid.every((row) => (row[ci] ?? '').trim() === '')) continue
      // Check header length
      widestChars = Math.max(widestChars, (grid[0][ci] ?? '').length)
      // Check all displayed values (formatted with displayPct)
      for (let ri = 1; ri < grid.length; ri++) {
        const displayed = displayPct(grid[ri][ci] ?? '')
        widestChars = Math.max(widestChars, displayed.length)
      }
    }

    return Math.max(80, widestChars * CHAR_PX + PAD)
  }, [grid])

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {grid.length - 1} rows · {dataColCount} series
          </span>
          <button
            type="button"
            onClick={() => addMoreRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add file
          </button>
          <input
            ref={addMoreRef}
            type="file"
            accept=".csv,.xlsx,.xls,.tsv"
            className="hidden"
            onChange={handleAddMoreFile}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
      </div>

      {/* Scrollable table */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto rounded-lg border-2 border-border w-fit max-w-full">
        <table
          ref={tableRef}
          className="text-sm border-collapse"
        >
          <colgroup>
            <col style={{ width: 120, minWidth: 120 }} />
            {grid[0].slice(1).map((_, i) => {
              const ci = i + 1
              const empty = grid.every((row) => (row[ci] ?? '').trim() === '')
              const w = empty ? 120 : seriesColWidth
              return <col key={i} style={{ width: w, minWidth: w }} />
            })}
          </colgroup>
          <tbody>
            {grid.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-muted sticky top-0 z-10 shadow-[0_1px_0_0_var(--border)]' : ''}>
                {row.map((cell, ci) => {
                  const empty = isEmptyCol(ci)
                  const isHeader = ri === 0
                  const isDateCol = ci === 0
                  const isFocused = focusedCell === `${ri}:${ci}`

                  // Display value logic
                  let displayVal = cell
                  if (isHeader && isDateCol) {
                    displayVal = 'Date'
                  } else if (isHeader) {
                    displayVal = cell
                  } else if (isFocused) {
                    displayVal = cell
                  } else if (!isDateCol) {
                    displayVal = displayPct(cell)
                  }

                  return (
                    <td
                      key={ci}
                      className={[
                        'border border-border p-0',
                        isHeader ? 'bg-muted' : '',
                        isDateCol && !isHeader ? 'bg-muted/30' : '',
                        empty && !isHeader ? 'bg-primary/[0.02] border-dashed' : '',
                      ].join(' ')}
                    >
                      <input
                        value={displayVal}
                        onChange={(e) => {
                          // Don't allow editing the forced "Date" header
                          if (isHeader && isDateCol) return
                          updateCell(ri, ci, e.target.value)
                        }}
                        onPaste={handlePaste}
                        onFocus={() => setFocusedCell(`${ri}:${ci}`)}
                        onBlur={() => setFocusedCell(null)}
                        onKeyDown={(e) => handleCellKeyDown(e, ri, ci)}
                        readOnly={isHeader && isDateCol}
                        placeholder={
                          empty && isHeader
                            ? 'Paste here…'
                            : undefined
                        }
                        className={[
                          'w-full px-2 py-1 text-center',
                          isHeader ? 'bg-muted' : 'bg-transparent',
                          'focus:outline-none focus:bg-primary/5',
                          isHeader
                            ? [
                                'font-semibold',
                                !isDateCol && !empty ? 'truncate text-left' : '',
                              ].join(' ')
                            : isDateCol
                              ? 'font-mono tabular-nums text-muted-foreground'
                              : 'font-mono tabular-nums',
                          empty ? 'placeholder:text-muted-foreground/40 placeholder:italic' : '',
                        ].join(' ')}
                        title={isHeader && !isDateCol ? cell : undefined}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground shrink-0">
        Paste additional series into the empty column on the right. Dates are matched automatically. Tab/Enter to navigate cells.
      </p>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from 'react'
import { Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ipc } from '../../lib/ipc'
import type { DBRecord, DataSeries } from '../../../shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`
}

function parseValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

interface EditableCellProps {
  value: string
  dirty: boolean
  onChange: (v: string) => void
}

function EditableCell({ value, dirty, onChange }: EditableCellProps) {
  return (
    <td className="border-r border-border last:border-r-0 p-0">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full h-full px-3 py-2.5 text-sm tabular-nums text-center bg-transparent outline-none',
          'focus:bg-blue-50 dark:focus:bg-blue-950/30',
          'transition-colors duration-100',
          dirty && 'text-blue-600 dark:text-blue-400',
          !value && 'text-muted-foreground/30',
        )}
        placeholder="—"
      />
    </td>
  )
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export interface DataTableProps {
  records: DBRecord[]
  dbPath: string | null
  dbId: string | null
  filter: string | 'all'
}

type Edits = Record<string, Record<string, string>> // seriesId → isoDate → raw input

export function DataTable({ records, dbPath, dbId, filter }: DataTableProps) {
  const [allSeries, setAllSeries]   = useState<DataSeries[]>([])
  const [loading, setLoading]       = useState(false)
  const [edits, setEdits]           = useState<Edits>({})
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)

  // Which series to show based on filter
  const visibleRecords = useMemo(
    () => filter === 'all' ? records : records.filter((r) => r.id === filter),
    [records, filter],
  )

  // Fetch full series (with points) whenever visible set changes
  useEffect(() => {
    if (visibleRecords.length === 0) { setAllSeries([]); return }
    let cancelled = false
    setLoading(true)
    setEdits({})
    setSaveError(null)

    Promise.all(
      visibleRecords.map((r) =>
        dbPath
          ? ipc.external.getSeries(dbPath, r.id, dbId ?? r.id)
          : ipc.memory.getSeries(r.id),
      ),
    )
      .then((results) => {
        if (!cancelled) setAllSeries(results.filter((s): s is DataSeries => s !== null))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [visibleRecords, dbPath, dbId])

  // Pivot: sorted union of all dates × all series
  const { dates, pivot } = useMemo(() => {
    const dateSet = new Set<string>()
    for (const s of allSeries) {
      for (const p of s.points) dateSet.add(p.date.toISOString().slice(0, 10))
    }
    const dates = Array.from(dateSet).sort()

    const pivot: Record<string, Record<string, number | null>> = {}
    for (const d of dates) {
      pivot[d] = {}
      for (const s of allSeries) pivot[d][s.id] = null
    }
    for (const s of allSeries) {
      for (const p of s.points) {
        pivot[p.date.toISOString().slice(0, 10)][s.id] = p.value
      }
    }
    return { dates, pivot }
  }, [allSeries])

  // Measure the widest series name using canvas (no DOM re-flow needed)
  const colWidth = useMemo(() => {
    if (allSeries.length === 0) return 100
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return 120
    // Match the rendered font: text-sm (14px) font-medium (500)
    ctx.font = '500 14px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    const maxTextPx = Math.max(...allSeries.map((s) => ctx.measureText(s.name).width))
    return Math.ceil(maxTextPx) + 32 // 32px = px-3 padding on both sides + buffer
  }, [allSeries])

  const isDirty = Object.values(edits).some((row) => Object.keys(row).length > 0)

  function getCellDisplay(seriesId: string, date: string): string {
    if (edits[seriesId]?.[date] !== undefined) return edits[seriesId][date]
    const v = pivot[date]?.[seriesId]
    return v !== null && v !== undefined ? String(v) : ''
  }

  function handleCellChange(seriesId: string, date: string, value: string) {
    setEdits((prev) => ({
      ...prev,
      [seriesId]: { ...(prev[seriesId] ?? {}), [date]: value },
    }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      for (const s of allSeries) {
        const seriesEdits = edits[s.id]
        if (!seriesEdits || Object.keys(seriesEdits).length === 0) continue

        // Reconstruct point map from originals, apply edits
        const pointMap = new Map<string, number>()
        for (const p of s.points) pointMap.set(p.date.toISOString().slice(0, 10), p.value)

        for (const [date, raw] of Object.entries(seriesEdits)) {
          const n = parseValue(raw)
          if (n === null) pointMap.delete(date)
          else pointMap.set(date, n)
        }

        const updatedPoints = Array.from(pointMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({ date: new Date(date), value }))

        const updated: DataSeries = { ...s, points: updatedPoints, originalPoints: updatedPoints.map((p) => ({ ...p })) }

        if (dbPath) await ipc.external.saveSeries(dbPath, updated)
        else        await ipc.memory.saveSeries(updated)
      }

      // Flush edits into allSeries so the table reflects saved state
      setAllSeries((prev) =>
        prev.map((s) => {
          const seriesEdits = edits[s.id]
          if (!seriesEdits || Object.keys(seriesEdits).length === 0) return s
          const pointMap = new Map<string, number>()
          for (const p of s.points) pointMap.set(p.date.toISOString().slice(0, 10), p.value)
          for (const [date, raw] of Object.entries(seriesEdits)) {
            const n = parseValue(raw)
            if (n === null) pointMap.delete(date)
            else pointMap.set(date, n)
          }
          const pts = Array.from(pointMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ date: new Date(date), value }))
          return { ...s, points: pts, originalPoints: pts.map((p) => ({ ...p })) }
        }),
      )
      setEdits({})
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground italic">
        No series in this database.
      </div>
    )
  }

  if (allSeries.length === 0 || dates.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground italic">
        No data points.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Save bar */}
      <div className="flex items-center justify-between min-h-[32px]">
        {saveError && (
          <span className="text-xs text-destructive">{saveError}</span>
        )}
        {isDirty && !saveError && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
        <div className="ml-auto">
          {isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                'bg-blue-600 hover:bg-blue-700 text-white transition-colors',
                saving && 'opacity-60 cursor-not-allowed',
              )}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="w-fit rounded-lg border border-border bg-card shadow-sm overflow-hidden flex-1 min-h-0">
        <div className="overflow-x-auto overflow-y-auto h-full">
          <table className="text-sm border-collapse">
            <thead className="sticky top-0 z-20 bg-card">
              <tr className="border-b border-border bg-muted/40">
                <th className="sticky left-0 z-30 bg-card px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap border-r border-border">
                  Date
                </th>
                {allSeries.map((s) => (
                  <th
                    key={s.id}
                    className="px-3 py-2.5 text-center font-medium text-muted-foreground whitespace-nowrap border-r border-border last:border-r-0"
                    style={{ minWidth: colWidth, width: colWidth }}
                  >
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => (
                <tr
                  key={date}
                  className={cn(
                    'border-b border-border last:border-none',
                    i % 2 === 0 ? 'bg-card' : 'bg-muted/20',
                    'hover:bg-muted/40 transition-colors',
                  )}
                >
                  <td className="sticky left-0 z-10 px-3 py-0 font-mono text-xs text-muted-foreground whitespace-nowrap border-r border-border bg-inherit">
                    {fmtDate(date)}
                  </td>
                  {allSeries.map((s) => (
                    <EditableCell
                      key={s.id}
                      value={getCellDisplay(s.id, date)}
                      dirty={edits[s.id]?.[date] !== undefined}
                      onChange={(v) => handleCellChange(s.id, date, v)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

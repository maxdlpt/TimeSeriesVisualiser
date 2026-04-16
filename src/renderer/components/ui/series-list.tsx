"use client"

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowUpDown, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inferFreqFromRecord, formatFreq } from '../../lib/freq'
import { toGeomIndex } from '../../lib/transforms'
import { ipc } from '../../lib/ipc'
import { getColor } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { useAppStore } from '../../store/app'
import { AreaChart, Area } from './area-chart'
import type { DBRecord, DataFreq, DataSeries } from '../../../shared/types'

// ─── Frequency badge ──────────────────────────────────────────────────────────

const FREQ_STYLES: Record<NonNullable<DataFreq> | 'unknown', string> = {
  daily:     'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400',
  monthly:   'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-400',
  quarterly: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400',
  yearly:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400',
  unknown:   'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-300',
}

const FREQ_ORDER: Record<NonNullable<DataFreq> | 'unknown', number> = {
  daily: 0, monthly: 1, quarterly: 2, yearly: 3, unknown: 4,
}

function FreqBadge({ record }: { record: DBRecord }) {
  const freq = inferFreqFromRecord(record.pointCount, record.startDate, record.endDate)
  const label = freq ? formatFreq(freq) : 'Unknown'
  const style = FREQ_STYLES[freq ?? 'unknown']
  return (
    <span className={cn('px-2.5 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap', style)}>
      {label}
    </span>
  )
}

// ─── Date formatting ──────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`
}

// ─── Mini chart ───────────────────────────────────────────────────────────────

interface MiniChartProps {
  record: DBRecord
  dbPath: string | null
  dbId: string | null
}

function MiniChart({ record, dbPath, dbId }: MiniChartProps) {
  const [series, setSeries] = useState<DataSeries | null>(null)
  const colorPalette   = useAppStore((s) => s.colorPalette)
  const customPalettes = useAppStore((s) => s.customPalettes)
  const theme          = useAppStore((s) => s.theme)
  const isDark         = isDarkTheme(theme)

  useEffect(() => {
    let cancelled = false
    const fetcher = dbPath
      ? ipc.external.getSeries(dbPath, record.id, dbId ?? record.id)
      : ipc.memory.getSeries(record.id)
    fetcher
      .then((s) => { if (!cancelled) setSeries(s) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [record.id, dbPath, dbId])

  if (!series || series.points.length === 0) {
    return <div className="h-10 w-28" />
  }

  const geomPts = toGeomIndex(series.points)
  const chartData = geomPts.map((p) => ({ date: p.date, [record.code]: p.value }))
  const color = getColor(colorPalette, 0, customPalettes, isDark)

  return (
    <div className="h-10 w-28">
      <AreaChart
        data={chartData}
        xDataKey="date"
        aspectRatio="auto"
        className="h-full"
        animationDuration={350}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <Area
          dataKey={record.code}
          stroke={color}
          fill={color}
          fillOpacity={0.15}
        />
      </AreaChart>
    </div>
  )
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'freq' | 'startDate' | 'endDate' | 'pointCount'
type SortDir = 'asc' | 'desc'

function sortRecords(records: DBRecord[], key: SortKey, dir: SortDir): DBRecord[] {
  const sorted = [...records].sort((a, b) => {
    let cmp = 0
    if (key === 'name')       cmp = a.name.localeCompare(b.name)
    else if (key === 'freq') {
      const fa = inferFreqFromRecord(a.pointCount, a.startDate, a.endDate) ?? 'unknown'
      const fb = inferFreqFromRecord(b.pointCount, b.startDate, b.endDate) ?? 'unknown'
      cmp = FREQ_ORDER[fa] - FREQ_ORDER[fb]
    }
    else if (key === 'startDate')  cmp = a.startDate.localeCompare(b.startDate)
    else if (key === 'endDate')    cmp = a.endDate.localeCompare(b.endDate)
    else if (key === 'pointCount') cmp = a.pointCount - b.pointCount
    return dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

// ─── SortableHeader ───────────────────────────────────────────────────────────

interface SortableHeaderProps {
  label: string
  sortKey: SortKey
  active: SortKey | null
  dir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}

function SortableHeader({ label, sortKey, active, dir, onSort, className }: SortableHeaderProps) {
  const isActive = active === sortKey
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th className={cn('p-4 font-medium text-muted-foreground', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'flex items-center gap-1.5 hover:text-foreground transition-colors select-none',
          isActive && 'text-foreground',
        )}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5', !isActive && 'opacity-40')} />
      </button>
    </th>
  )
}

// ─── Animation variants ───────────────────────────────────────────────────────

const containerVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const rowVariants = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 120, damping: 16 } },
}

// ─── SeriesList ───────────────────────────────────────────────────────────────

export interface SeriesListProps {
  records: DBRecord[]
  loading?: boolean
  error?: string | null
  dbPath: string | null
  dbId: string | null
  onDelete: (id: string) => void
  onImportSeries: () => void
}

export function SeriesList({ records, loading, error, dbPath, dbId, onDelete, onImportSeries }: SeriesListProps) {
  const [sortKey, setSortKey]             = useState<SortKey | null>(null)
  const [sortDir, setSortDir]             = useState<SortDir>('asc')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortKey(null); setSortDir('asc') }
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(
    () => (sortKey ? sortRecords(records, sortKey, sortDir) : records),
    [records, sortKey, sortDir],
  )

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading…</div>
  }
  if (error) {
    return <div className="flex items-center justify-center py-16 text-sm text-destructive">{error}</div>
  }
  if (records.length === 0) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground italic">No series in this database.</div>
  }

  const headerProps = { active: sortKey, dir: sortDir, onSort: handleSort }

  return (
    <div className="w-full rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-border">
              <SortableHeader label="Name"        sortKey="name"       {...headerProps} />
              <th className="p-4 font-medium text-muted-foreground text-center">Chart</th>
              <SortableHeader label="Data Points" sortKey="pointCount" {...headerProps} className="text-center [&_button]:mx-auto" />
              <SortableHeader label="Frequency"   sortKey="freq"       {...headerProps} className="text-center [&_button]:mx-auto" />
              <SortableHeader label="Start Date"  sortKey="startDate"  {...headerProps} />
              <SortableHeader label="End Date"    sortKey="endDate"    {...headerProps} />
              <th className="p-4 font-medium text-muted-foreground text-center">
                <button
                  type="button"
                  onClick={onImportSeries}
                  className="flex items-center gap-1 mx-auto text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Import Series
                </button>
              </th>
            </tr>
          </thead>
          <motion.tbody
            key={`${sortKey}-${sortDir}`}
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence>
              {sorted.map((r) => (
                <motion.tr
                  key={r.id}
                  variants={rowVariants}
                  className="border-b border-border last:border-none hover:bg-muted/40 transition-colors"
                >
                  {/* Name */}
                  <td className="p-4">
                    <div className="font-medium text-foreground">{r.name}</div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.description}</div>
                    )}
                  </td>

                  {/* Chart */}
                  <td className="p-2 text-center">
                    <div className="inline-block">
                      <MiniChart record={r} dbPath={dbPath} dbId={dbId} />
                    </div>
                  </td>

                  {/* Data Points */}
                  <td className="p-4 text-muted-foreground text-center tabular-nums">
                    {r.pointCount.toLocaleString()}
                  </td>

                  {/* Frequency */}
                  <td className="p-4 text-center">
                    <div className="flex justify-center">
                      <FreqBadge record={r} />
                    </div>
                  </td>

                  {/* Start Date */}
                  <td className="p-4 text-muted-foreground whitespace-nowrap">{fmtDate(r.startDate)}</td>

                  {/* End Date */}
                  <td className="p-4 text-muted-foreground whitespace-nowrap">{fmtDate(r.endDate)}</td>

                  {/* Actions */}
                  <td className="p-4 text-center">
                    <AnimatePresence mode="wait">
                      {confirmDeleteId === r.id ? (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.1 }}
                          className="flex items-center justify-center gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => { onDelete(r.id); setConfirmDeleteId(null) }}
                            className="text-xs text-white bg-destructive hover:bg-destructive/90 transition-colors px-2 py-1 rounded"
                          >
                            Delete
                          </button>
                        </motion.div>
                      ) : (
                        <motion.button
                          key="delete-btn"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                          type="button"
                          onClick={() => setConfirmDeleteId(r.id)}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors mx-auto"
                          aria-label={`Delete ${r.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </motion.tbody>
        </table>
      </div>
    </div>
  )
}

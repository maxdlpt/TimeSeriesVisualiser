import { useState, useCallback } from 'react'
import type { DataSeries, DataFreq } from '../../../shared/types'
import { formatFreq } from '../../lib/freq'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const FREQS: DataFreq[] = ['daily', 'monthly', 'quarterly', 'yearly']

function formatDateRange(points: DataSeries['points']): string {
  if (points.length === 0) return '—'
  let minT = Infinity
  let maxT = -Infinity
  for (const p of points) {
    const t = p.date.getTime()
    if (t < minT) minT = t
    if (t > maxT) maxT = t
  }
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  return `${fmt(new Date(minT))} – ${fmt(new Date(maxT))}`
}

interface Draft {
  name: string
  code: string
  description: string
  data_freq: DataFreq
}

interface Props {
  series: DataSeries[]
  onConfirm: (edited: DataSeries[]) => void
  onCancel: () => void
}

export function SeriesReviewPanel({ series, onConfirm, onCancel }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    series.map((s) => ({
      name: s.name,
      code: s.code,
      description: s.description,
      data_freq: s.data_freq ?? 'daily',
    })),
  )

  const update = useCallback((idx: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  }, [])

  const handleConfirm = () => {
    const edited = series.map((s, i) => ({ ...s, ...drafts[i] }))
    onConfirm(edited)
  }

  const hasErrors = drafts.some((d) => !d.name.trim() || !d.code.trim())

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Review and edit the parsed series before adding them to the graph.
      </p>

      <div className="flex flex-col gap-3">
        {series.map((s, i) => {
          const draft = drafts[i]
          return (
            <div
              key={s.id}
              className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3"
            >
              {/* Color swatch + date range + point count */}
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color ?? '#3b82f6' }}
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDateRange(s.points)} · {s.points.length.toLocaleString()} points
                </span>
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Name</label>
                  <Input
                    value={draft.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="Series name"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Code</label>
                  <Input
                    value={draft.code}
                    onChange={(e) =>
                      update(i, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })
                    }
                    className="h-8 text-sm font-mono"
                    placeholder="MY_CODE"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Description</label>
                  <Input
                    value={draft.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="Optional description"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Frequency</label>
                  <select
                    value={draft.data_freq}
                    onChange={(e) => update(i, { data_freq: e.target.value as DataFreq })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {FREQS.map((f) => (
                      <option key={f} value={f}>
                        {formatFreq(f)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Back
        </Button>
        <Button className="flex-1" onClick={handleConfirm} disabled={hasErrors}>
          Add to Graph
        </Button>
      </div>
    </div>
  )
}

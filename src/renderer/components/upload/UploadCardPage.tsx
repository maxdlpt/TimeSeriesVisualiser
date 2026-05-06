import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ChevronDown,
  BarChart2,
  Database,
  HardDrive,
  PlusCircle,
  X,
} from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useGraphStore } from '../../store/graph'
import { useGraphManagerStore } from '../../store/graph-manager'
import { useDBStore } from '../../store/db'
import { getColor } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { formatFreq } from '../../lib/freq'
import { toGeomIndex } from '../../lib/transforms'
import { cn } from '../../lib/utils'
import { AreaChart, Area } from '../ui/area-chart'
import type { DataSeries, DataFreq, DataType } from '../../../shared/types'
import type { Destination, Assignment } from './SeriesReviewPanel'

// ─── Types ───────────────────────────────────────────────────────────────────

type AddOption =
  | { kind: 'destination'; dest: Destination }
  | { kind: 'new-graph' }
  | { kind: 'to-graph'; graphId: string }

interface Props {
  series: DataSeries[]
  onDispatch: (assignments: Assignment[]) => Promise<boolean>
  onDiscard: (id: string) => void
  onCancel: () => void
}

interface Draft {
  name: string
  code: string
  description: string
  data_freq?: DataFreq
  dataType?: DataType
}

// ─── Frequency badge ─────────────────────────────────────────────────────────

const FREQ_STYLES: Record<NonNullable<DataFreq> | 'unknown', string> = {
  daily:         'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  weekly:        'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  monthly:       'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  quarterly:     'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'semi-annual': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  yearly:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  unknown:       'bg-muted text-muted-foreground',
}

const FREQS: DataFreq[] = ['daily', 'weekly', 'monthly', 'quarterly', 'semi-annual', 'yearly']
const DATA_TYPES: { value: DataType; label: string }[] = [
  { value: 'growth', label: 'Returns' },
  { value: 'level', label: 'Level' },
]

const DATA_TYPE_STYLES: Record<DataType, string> = {
  growth: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  level: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
}

// ─── Animated pill dropdown ─────────────────────────────────────────────────

interface PillDropdownProps<T extends string> {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  styleMap: Record<string, string>
  fallbackStyle?: string
}

function PillDropdown<T extends string>({ value, options, onChange, styleMap, fallbackStyle }: PillDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const currentLabel = options.find((o) => o.value === value)?.label ?? value
  const pillStyle = styleMap[value] ?? fallbackStyle ?? ''

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full transition-colors cursor-pointer',
          pillStyle,
        )}
      >
        {currentLabel}
        <ChevronDown className={cn('h-2.5 w-2.5 opacity-60 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 top-full mt-1 z-50 min-w-[8rem] rounded-lg overflow-hidden shadow-lg bg-card border border-border"
          >
            <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.02 } } }}>
              {options.map((opt) => (
                <motion.button
                  key={opt.value}
                  type="button"
                  variants={{ hidden: { opacity: 0, x: -10 }, visible: { opacity: 1, x: 0 } }}
                  onClick={() => { onChange(opt.value); setOpen(false) }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors',
                    opt.value === value && 'font-semibold',
                  )}
                >
                  <span className={cn('w-2 h-2 rounded-full shrink-0', styleMap[opt.value] ?? fallbackStyle)} />
                  <span>{opt.label}</span>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Inline mini-chart (from DataSeries, not DB) ────────────────────────────

function InlineMiniChart({ series }: { series: DataSeries }) {
  const colorPalette   = useAppStore((s) => s.colorPalette)
  const customPalettes = useAppStore((s) => s.customPalettes)
  const theme          = useAppStore((s) => s.theme)
  const uiTheme        = useAppStore((s) => s.uiTheme)

  const chartData = useMemo(() => {
    if (series.points.length === 0) return []
    const geomPts = toGeomIndex(series.points)
    return geomPts.map((p) => ({ date: p.date, val: p.value }))
  }, [series.points])

  const color = series.color ?? getColor(colorPalette, 0, customPalettes, isDarkTheme(theme), uiTheme)

  if (chartData.length === 0) return <div className="h-24 w-full rounded bg-muted/30" />

  return (
    <div className="h-24 w-full">
      <AreaChart
        data={chartData}
        xDataKey="date"
        aspectRatio="auto"
        className="h-full"
        animationDuration={350}
        margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
        showTooltip={false}
      >
        <Area dataKey="val" stroke={color} fill={color} fillOpacity={0.12} />
      </AreaChart>
    </div>
  )
}

// ─── Per-card Add dropdown ───────────────────────────────────────────────────

function CardAddDropdown({ onSelect }: { onSelect: (opt: AddOption) => void }) {
  const [open, setOpen]  = useState(false)
  const wrapRef          = useRef<HTMLDivElement>(null)
  const externalDBs      = useDBStore((s) => s.externalDBs)
  const openGraphs       = useGraphManagerStore((s) => s.openGraphs)
  const activeGraphId    = useGraphManagerStore((s) => s.activeGraphId)
  const activeGraphTitle = useGraphStore((s) => s.graphTitle)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const pick = (opt: AddOption) => { onSelect(opt); setOpen(false) }
  const reachableDBs = externalDBs.filter((db) => db.reachable)

  const graphOptions = openGraphs.map((g) => ({
    id: g.id,
    title:
      g.id === activeGraphId
        ? activeGraphTitle || 'New Graph'
        : g.snapshot?.graphTitle || 'New Graph',
    isActive: g.id === activeGraphId,
  }))

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
      >
        Add
        <ChevronDown className={cn('h-3 w-3 opacity-80 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full mt-1 z-50 min-w-[12rem] rounded-lg overflow-hidden shadow-lg bg-card border border-border"
          >
            <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.02 } } }}>
              {/* Graphs */}
              <div className="px-3 pt-1.5 pb-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">Graph</span>
              </div>
              {graphOptions.map((g) => (
                <motion.button
                  key={g.id}
                  type="button"
                  variants={{ hidden: { opacity: 0, x: -10 }, visible: { opacity: 1, x: 0 } }}
                  onClick={() =>
                    g.isActive
                      ? pick({ kind: 'destination', dest: { type: 'graph' } })
                      : pick({ kind: 'to-graph', graphId: g.id })
                  }
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors"
                >
                  <BarChart2 className="h-3 w-3 shrink-0 text-primary" />
                  <span className="flex-1 truncate">{g.title}</span>
                  {g.isActive && <span className="text-[9px] text-muted-foreground/60">active</span>}
                </motion.button>
              ))}
              <motion.button
                type="button"
                variants={{ hidden: { opacity: 0, x: -10 }, visible: { opacity: 1, x: 0 } }}
                onClick={() => pick({ kind: 'new-graph' })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors"
              >
                <PlusCircle className="h-3 w-3 shrink-0 text-primary" />
                <span>New Graph</span>
              </motion.button>

              <div className="border-t border-border mt-0.5" />

              {/* Databases */}
              <div className="px-3 pt-1.5 pb-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">Database</span>
              </div>
              <motion.button
                type="button"
                variants={{ hidden: { opacity: 0, x: -10 }, visible: { opacity: 1, x: 0 } }}
                onClick={() => pick({ kind: 'destination', dest: { type: 'memory' } })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors"
              >
                <HardDrive className="h-3 w-3 shrink-0 text-primary" />
                <span>Local Memory</span>
              </motion.button>
              {reachableDBs.map((db) => (
                <motion.button
                  key={db.id}
                  type="button"
                  variants={{ hidden: { opacity: 0, x: -10 }, visible: { opacity: 1, x: 0 } }}
                  onClick={() => pick({ kind: 'destination', dest: { type: 'external', id: db.id, path: db.path } })}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors"
                >
                  <Database className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="truncate">{db.name}</span>
                </motion.button>
              ))}
              <div className="pb-0.5" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Single card ─────────────────────────────────────────────────────────────

interface CardProps {
  series: DataSeries
  draft: Draft
  onUpdate: (patch: Partial<Draft>) => void
  onAdd: (opt: AddOption) => void
  onDiscard: () => void
}

function SeriesCard({ series, draft, onUpdate, onAdd, onDiscard }: CardProps) {
  const freqOptions = FREQS.map((f) => ({ value: f, label: formatFreq(f) }))

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="flex flex-col rounded-lg border border-border bg-card"
    >
      {/* Mini-chart */}
      <div className="overflow-hidden rounded-t-lg">
        <InlineMiniChart series={series} />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2.5 p-4">
        {/* Name */}
        <input
          value={draft.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none transition-colors px-0 py-0.5 w-full"
          placeholder="Series name"
        />

        {/* Code */}
        <input
          value={draft.code}
          onChange={(e) =>
            onUpdate({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })
          }
          className="text-xs font-mono text-muted-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none transition-colors px-0 py-0.5 w-full"
          placeholder="CODE"
        />

        {/* Badges row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <PillDropdown<DataFreq>
            value={draft.data_freq ?? 'monthly'}
            options={freqOptions}
            onChange={(v) => onUpdate({ data_freq: v })}
            styleMap={FREQ_STYLES}
            fallbackStyle={FREQ_STYLES.unknown}
          />

          <PillDropdown<DataType>
            value={draft.dataType ?? 'growth'}
            options={DATA_TYPES}
            onChange={(v) => onUpdate({ dataType: v })}
            styleMap={DATA_TYPE_STYLES}
          />

          <span className="text-[10px] text-muted-foreground ml-auto">
            {series.points.length} pts
          </span>
        </div>

        {/* Description */}
        <textarea
          value={draft.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          rows={1}
          className="text-xs text-muted-foreground bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1.5 py-1 resize-none transition-colors w-full"
          placeholder="Description (optional)"
        />

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={onDiscard}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            Discard
          </button>
          <CardAddDropdown onSelect={onAdd} />
        </div>
      </div>
    </motion.div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function UploadCardPage({ series, onDispatch, onDiscard, onCancel }: Props) {
  // Editable drafts keyed by series ID
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => {
    const m = new Map<string, Draft>()
    for (const s of series) {
      m.set(s.id, {
        name: s.name,
        code: s.code,
        description: s.description,
        data_freq: s.data_freq,
        dataType: (s as any).dataType,
      })
    }
    return m
  })

  const updateDraft = useCallback((id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const next = new Map(prev)
      const existing = next.get(id)
      if (existing) next.set(id, { ...existing, ...patch })
      return next
    })
  }, [])

  // Apply draft edits back to series before dispatching
  const applyDrafts = useCallback(
    (s: DataSeries): DataSeries => {
      const d = drafts.get(s.id)
      if (!d) return s
      return {
        ...s,
        name: d.name,
        code: d.code,
        description: d.description,
        data_freq: d.data_freq,
        dataType: d.dataType,
      } as DataSeries
    },
    [drafts],
  )

  const handleCardAdd = useCallback(
    async (seriesItem: DataSeries, opt: AddOption) => {
      const patched = applyDrafts(seriesItem)

      if (opt.kind === 'new-graph') {
        useGraphManagerStore.getState().createGraph()
        await onDispatch([{ series: patched, destination: { type: 'graph' } }])
        onDiscard(seriesItem.id)
        return
      }
      if (opt.kind === 'to-graph') {
        useGraphManagerStore.getState().switchGraph(opt.graphId)
        await onDispatch([{ series: patched, destination: { type: 'graph' } }])
        onDiscard(seriesItem.id)
        return
      }
      await onDispatch([{ series: patched, destination: opt.dest }])
      if (opt.dest.type !== 'memory' && opt.dest.type !== 'external') {
        onDiscard(seriesItem.id)
      }
    },
    [applyDrafts, onDispatch, onDiscard],
  )

  // Bulk Add All
  const handleAddAll = useCallback(
    async (opt: AddOption) => {
      const assignments: Assignment[] = series.map((s) => {
        const patched = applyDrafts(s)
        if (opt.kind === 'destination') {
          return { series: patched, destination: opt.dest }
        }
        return { series: patched, destination: { type: 'graph' as const } }
      })

      if (opt.kind === 'new-graph') {
        useGraphManagerStore.getState().createGraph()
      } else if (opt.kind === 'to-graph') {
        useGraphManagerStore.getState().switchGraph(opt.graphId)
      }

      const wentToGraph = await onDispatch(assignments)
      if (wentToGraph) useAppStore.getState().setActiveTab('graph')
    },
    [series, applyDrafts, onDispatch],
  )

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-sm text-muted-foreground">
          {series.length} series ready
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <CardAddDropdown onSelect={handleAddAll} />
        </div>
      </div>

      {/* Card grid */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 max-w-5xl mx-auto">
          <AnimatePresence mode="popLayout">
            {series.map((s) => {
              const draft = drafts.get(s.id)
              if (!draft) return null
              return (
                <SeriesCard
                  key={s.id}
                  series={s}
                  draft={draft}
                  onUpdate={(patch) => updateDraft(s.id, patch)}
                  onAdd={(opt) => handleCardAdd(s, opt)}
                  onDiscard={() => onDiscard(s.id)}
                />
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

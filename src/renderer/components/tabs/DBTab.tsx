"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Database, HardDrive } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { useDBStore } from '../../store/db'
import { cn } from '../../lib/utils'
import { Tabs, TabsList, TabsTab, TabsPanel } from '../ui/tabs'
import { SeriesList } from '../ui/series-list'
import { DataTable } from '../ui/data-table'
import { AddLinePanel } from '../graph/AddLinePanel'
import { ipc } from '../../lib/ipc'
import type { DBRecord, ExternalDB } from '../../../shared/types'

type SelectedDB = 'memory' | string

// ─── Tab Icons ────────────────────────────────────────────────────────────────

function BulletListIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <line x1="10" y1="7"  x2="19" y2="7"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="5"  y1="7"  x2="5.1" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="5"  y1="12" x2="5.1" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="17" x2="19" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="5"  y1="17" x2="5.1" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function TableIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M40.15 5H7.85C6.276 5 5 6.276 5 7.85V40.15C5 41.724 6.276 43 7.85 43H40.15C41.724 43 43 41.724 43 40.15V7.85C43 6.276 41.724 5 40.15 5Z" stroke="currentColor" strokeWidth="4" />
      <path d="M17 5V43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M31 5V43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M5 17H43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M5 31H43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function DBSettingsIcon({ className }: { className?: string }) {
  // The gear is drawn in its own 24×24 coordinate space and placed bottom-right
  // via a scale + translate transform.  strokeWidth is scaled up to compensate
  // so the rendered stroke appears the same weight as the Database paths.
  const SCALE = 0.65
  const SW    = 2 / SCALE   // compensate so rendered stroke ≈ 2 px
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Database cylinder */}
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
      {/* Punch-out background — r=7.8 fully covers gear knobs at SCALE=0.65 */}
      <circle cx="17.5" cy="17.5" r="7.8" fill="var(--color-background)" stroke="none" />
      {/* Settings gear — centre (12,12) → translate(9.7,9.7) + 12×0.65 = 17.5 */}
      <g transform={`translate(9.7,9.7) scale(${SCALE})`} strokeWidth={SW}>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </svg>
  )
}

const FONT_STYLE = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
}

function dbLabel(selected: SelectedDB, externalDBs: ExternalDB[]): string {
  if (selected === 'memory') return 'Local Memory'
  return externalDBs.find((db) => db.id === selected)?.name ?? 'Select Database'
}

function DBIcon({ selected, externalDBs }: { selected: SelectedDB; externalDBs: ExternalDB[] }) {
  if (selected === 'memory') return <HardDrive className="h-8 w-8 text-blue-500 shrink-0" />
  const db = externalDBs.find((d) => d.id === selected)
  return (
    <Database
      className={cn('h-8 w-8 shrink-0', db?.reachable === false ? 'text-red-400' : 'text-blue-500')}
    />
  )
}

// ─── Title Dropdown ───────────────────────────────────────────────────────────
// Styled like the GraphTab chart-mode title: text-4xl font-black with a
// ChevronDown. The list reuses the AddLinePanel SourceDropdown visual style.

interface TitleDropdownProps {
  selected: SelectedDB
  onSelect: (id: SelectedDB) => void
  externalDBs: ExternalDB[]
}

function TitleDropdown({ selected, onSelect, externalDBs }: TitleDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = (id: SelectedDB, reachable: boolean) => {
    if (!reachable) return
    onSelect(id)
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-3 leading-none select-none text-foreground group"
        style={FONT_STYLE}
      >
        <DBIcon selected={selected} externalDBs={externalDBs} />
        <span className="flex items-center gap-1">
          <span className="text-4xl font-black">{dbLabel(selected, externalDBs)}</span>
          <ChevronDown
            className={cn(
              'h-6 w-6 transition-transform duration-150 opacity-40 group-hover:opacity-80',
              open && 'rotate-180',
            )}
            strokeWidth={3}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute left-0 top-full mt-2 z-50',
              'min-w-[16rem] rounded-lg overflow-hidden',
              'bg-slate-100 dark:bg-zinc-900',
              'border-2 border-slate-200 dark:border-zinc-800',
              'shadow-lg',
            )}
          >
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
            >
              {/* Local Memory */}
              <motion.button
                type="button"
                onClick={() => handleSelect('memory', true)}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                  'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  'transition-colors duration-150',
                  selected === 'memory' && 'font-medium',
                )}
              >
                <HardDrive className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="flex-1">Local Memory</span>
                {selected === 'memory' && <Check className="h-3.5 w-3.5 shrink-0" />}
              </motion.button>

              {externalDBs.length > 0 && (
                <div className="border-t-2 border-slate-200 dark:border-zinc-800" />
              )}

              {externalDBs.map((db) => (
                <motion.button
                  key={db.id}
                  type="button"
                  onClick={() => handleSelect(db.id, db.reachable)}
                  variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                    'border-b-2 border-slate-200 last:border-b-0 dark:border-zinc-800',
                    'transition-colors duration-150',
                    db.reachable
                      ? 'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                      : 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-zinc-900',
                    selected === db.id && 'font-medium',
                  )}
                >
                  <Database className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{db.name}</span>
                  {!db.reachable && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  {selected === db.id && db.reachable && <Check className="h-3.5 w-3.5 shrink-0" />}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Series Dropdown (Data tab) ───────────────────────────────────────────────

interface SeriesDropdownProps {
  selected: string | 'all'
  onSelect: (id: string | 'all') => void
  records: DBRecord[]
}

function SeriesDropdown({ selected, onSelect, records }: SeriesDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = selected === 'all'
    ? 'All'
    : (records.find((r) => r.id === selected)?.name ?? 'All')

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 pb-1 select-none group"
        style={FONT_STYLE}
      >
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
          {label}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-[transform,color] duration-150',
            open && 'rotate-180',
          )}
          strokeWidth={2.5}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute left-0 top-full z-50',
              'min-w-[14rem] max-h-64 overflow-y-auto overflow-x-hidden rounded-lg',
              'bg-slate-100 dark:bg-zinc-900',
              'border-2 border-slate-200 dark:border-zinc-800',
              'shadow-lg',
            )}
          >
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.02 } } }}
            >
              {/* All option */}
              <motion.button
                type="button"
                onClick={() => { onSelect('all'); setOpen(false) }}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                  'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  'transition-colors duration-150',
                  selected === 'all' && 'font-medium',
                )}
              >
                <span className="flex-1">All</span>
                {selected === 'all' && <Check className="h-3.5 w-3.5 shrink-0" />}
              </motion.button>

              {records.length > 0 && (
                <div className="border-t-2 border-slate-200 dark:border-zinc-800" />
              )}

              {records.map((r) => (
                <motion.button
                  key={r.id}
                  type="button"
                  onClick={() => { onSelect(r.id); setOpen(false) }}
                  variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                    'border-b border-slate-200 last:border-b-0 dark:border-zinc-800',
                    'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                    'transition-colors duration-150',
                    selected === r.id && 'font-medium',
                  )}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  {selected === r.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── DBTab ────────────────────────────────────────────────────────────────────

export function DBTab() {
  const externalDBs = useDBStore((s) => s.externalDBs)
  const [selectedDB, setSelectedDB]   = useState<SelectedDB>('memory')
  const [records, setRecords]         = useState<DBRecord[]>([])
  const [loading, setLoading]         = useState(false)
  const [fetchError, setFetchError]   = useState<string | null>(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [activeInnerTab, setActiveInnerTab] = useState('list-series')
  const [dataSeriesFilter, setDataSeriesFilter] = useState<string | 'all'>('all')

  const extDB = selectedDB !== 'memory'
    ? (externalDBs.find((db) => db.id === selectedDB) ?? null)
    : null
  const dbPath = extDB?.path ?? null
  const dbId   = extDB?.id ?? null

  // Fetch series list whenever the selected DB changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFetchError(null)
    setRecords([])

    const fetcher = selectedDB === 'memory'
      ? ipc.memory.listSeries()
      : extDB
        ? ipc.external.listSeries(extDB.path)
        : Promise.resolve<DBRecord[]>([])

    fetcher
      .then((list) => { if (!cancelled) setRecords(list) })
      .catch((err) => { if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [selectedDB, externalDBs])

  const handleDelete = useCallback(async (id: string) => {
    try {
      if (dbPath) {
        await ipc.external.deleteSeries(dbPath, id)
      } else {
        await ipc.memory.deleteSeries(id)
      }
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch {
      // Silently ignore — the row stays in the list if deletion fails
    }
  }, [dbPath])

  return (
    <div className="flex flex-col h-full w-full p-8 gap-6">
      <TitleDropdown
        selected={selectedDB}
        onSelect={setSelectedDB}
        externalDBs={externalDBs}
      />

      <Tabs value={activeInnerTab} onValueChange={setActiveInnerTab} className="flex flex-col gap-4 flex-1 min-h-0">
        <div className="flex items-end justify-between">
          {activeInnerTab === 'list-series' && (
            <span
              className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/50 pb-1"
              style={FONT_STYLE}
            >
              Time-Series
            </span>
          )}
          {activeInnerTab === 'data' && (
            <SeriesDropdown
              selected={dataSeriesFilter}
              onSelect={setDataSeriesFilter}
              records={records}
            />
          )}
          {activeInnerTab === 'settings' && <div />}
          <TabsList>
            <TabsTab value="list-series"><BulletListIcon />List Series</TabsTab>
            <TabsTab value="data"><TableIcon />Data</TabsTab>
            <TabsTab value="settings"><DBSettingsIcon />Settings</TabsTab>
          </TabsList>
        </div>

        <TabsPanel value="list-series">
          <SeriesList
            records={records}
            loading={loading}
            error={fetchError}
            dbPath={dbPath}
            dbId={dbId}
            onDelete={handleDelete}
            onImportSeries={() => setIsImportOpen(true)}
          />
        </TabsPanel>
        <TabsPanel value="data" className="min-h-0 flex flex-col">
          <DataTable
            records={records}
            dbPath={dbPath}
            dbId={dbId}
            filter={dataSeriesFilter}
          />
        </TabsPanel>
        <TabsPanel value="settings" />
      </Tabs>

      {/* Import Series modal */}
      {isImportOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setIsImportOpen(false)}
        >
          <div
            className="bg-background rounded-xl shadow-xl p-8 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <AddLinePanel placement="left" onClose={() => setIsImportOpen(false)} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

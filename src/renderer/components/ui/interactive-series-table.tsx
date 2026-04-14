import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export interface AccordionGroup<TGroup, TRow> {
  id: string
  group: TGroup
  rows: TRow[]
}

export interface InteractiveSeriesTableProps<TGroup, TRow> {
  groups: AccordionGroup<TGroup, TRow>[]
  groupHeader: (group: TGroup) => ReactNode
  rowRender: (row: TRow, index: number) => ReactNode
  rowKey?: (row: TRow, index: number) => string | number
  defaultExpanded?: boolean
  className?: string
}

export function InteractiveSeriesTable<TGroup, TRow>({
  groups,
  groupHeader,
  rowRender,
  rowKey,
  defaultExpanded = false,
  className,
}: InteractiveSeriesTableProps<TGroup, TRow>): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpanded ? groups.map((g) => g.id) : [])
  )

  const toggle = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={cn('w-full space-y-2', className)}>
      {groups.map((g) => {
        const isOpen = expandedIds.has(g.id)
        return (
          <div
            key={g.id}
            className="rounded-lg border border-border bg-card overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggle(g.id)}
              aria-expanded={isOpen}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 text-left',
                'hover:bg-accent/30 transition-colors'
              )}
            >
              <div className="flex-1 min-w-0">{groupHeader(g.group)}</div>
              <motion.div
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="ml-2 shrink-0"
              >
                <ChevronDown className="h-4 w-4" />
              </motion.div>
            </button>

            <AnimatePresence mode="popLayout" initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="overflow-hidden border-t border-border"
                >
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{
                      visible: { transition: { staggerChildren: 0.03 } },
                    }}
                    className="divide-y divide-border/60"
                  >
                    {g.rows.map((row, index) => (
                      <motion.div
                        key={rowKey ? rowKey(row, index) : index}
                        variants={{
                          hidden: { opacity: 0, x: -10 },
                          visible: { opacity: 1, x: 0 },
                        }}
                        className="px-4 py-2"
                      >
                        {rowRender(row, index)}
                      </motion.div>
                    ))}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

export default InteractiveSeriesTable

import { useState, type ReactNode } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export interface SpotlightColumn<T> {
  key: keyof T
  label: string
  render?: (row: T) => ReactNode
}

export interface SpotlightTableProps<T> {
  rows: T[]
  columns: SpotlightColumn<T>[]
  searchKeys?: (keyof T)[]
  searchPlaceholder?: string
  onRowClick?: (row: T) => void
  rowKey?: (row: T, index: number) => string | number
  className?: string
}

export function SpotlightTable<T>({
  rows,
  columns,
  searchKeys,
  searchPlaceholder = 'Search...',
  onRowClick,
  rowKey,
  className,
}: SpotlightTableProps<T>): JSX.Element {
  const [q, setQ] = useState('')
  const lower = q.toLowerCase()
  const keys = searchKeys ?? columns.map((c) => c.key)

  const isMatch = (row: T): boolean => {
    if (!lower) return false
    return keys.some((k) => String(row[k] ?? '').toLowerCase().includes(lower))
  }

  return (
    <div className={cn('w-full', className)}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
        className="mb-4 px-4 py-2 rounded-lg border border-input bg-background max-w-sm w-full"
      />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={String(col.key)} className="p-3 text-left">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const hit = isMatch(row)
            const dim = Boolean(q) && !hit
            const key = rowKey ? rowKey(row, index) : index
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'transition border-b border-border/50',
                  dim ? 'opacity-20' : 'opacity-100',
                  onRowClick && 'cursor-pointer hover:bg-accent/30'
                )}
              >
                {columns.map((col) => (
                  <td key={String(col.key)} className="p-3">
                    {col.render ? col.render(row) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default SpotlightTable

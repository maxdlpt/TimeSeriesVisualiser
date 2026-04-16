import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useGraphStore } from '../../store/graph'
import { toCumReturn, toNormalized, toPctChange } from '../../lib/transforms'
import { computeMA } from '../../lib/ma'
import { Button } from '../ui/button'
import { SaveMenu } from './SaveMenu'
import type { DataPoint, DataSeries } from '../../../shared/types'

type Transform = 'cumReturn' | 'normalize' | 'pctChange' | 'raw'

// Transforms always read from `s.originalPoints`, never from `s.points`.
// `s.points` may already be transformed output, so feeding it back into a
// transform compounds (e.g. pct-change of normalised values is not the same
// as pct-change of raw values). Contract:
//   originalPoints — immutable raw values, set on first load
//   points         — currently displayed (= originalPoints when raw)
// 'raw' must return originalPoints — returning `s.points` would be a no-op when
// the series is already transformed.
function applyTransform(s: DataSeries, t: Transform): DataPoint[] {
  if (t === 'raw') return s.originalPoints
  const fn = t === 'cumReturn' ? toCumReturn : t === 'normalize' ? toNormalized : toPctChange
  return fn(s.originalPoints)
}

export function OperationsPanel(): JSX.Element {
  const { activeSeries, updateSeries, setRightPanel } = useGraphStore()

  const transform = (t: Transform): void => {
    for (const s of activeSeries) {
      const newPoints = applyTransform(s, t)
      // Recompute MA points from the post-transform data so the overlay stays
      // on the same Y-axis scale as the parent series.  'raw' restores the MA
      // of originalPoints (which applyTransform already returns for 'raw').
      const newMAs = (s.movingAverages ?? []).map(ma => ({
        ...ma,
        points: computeMA(newPoints, ma.type, ma.window),
      }))
      updateSeries(s.id, {
        points: newPoints,
        ...(newMAs.length > 0 && { movingAverages: newMAs }),
      })
    }
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="flex flex-col gap-6 p-4 h-full w-80 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Operations</h3>
        <button
          type="button"
          aria-label="Close operations panel"
          onClick={() => setRightPanel(null)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Transform (applies to all series)
        </p>
        <Button
          variant="outline"
          className="w-full justify-start text-sm"
          onClick={() => transform('cumReturn')}
        >
          → Cumulative Return (%)
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start text-sm"
          onClick={() => transform('normalize')}
        >
          → Normalize to 100
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start text-sm"
          onClick={() => transform('pctChange')}
        >
          → Period % Change
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start text-sm"
          onClick={() => transform('raw')}
        >
          ↺ Reset to Raw Values
        </Button>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Save
        </p>
        <SaveMenu />
      </div>
    </motion.div>
  )
}

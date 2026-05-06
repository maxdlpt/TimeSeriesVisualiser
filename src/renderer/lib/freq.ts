import type { DataFreq } from '../../shared/types'

/**
 * Classification thresholds — median calendar days between consecutive points.
 *
 * Why median, not mean?
 *   span/(N-1) = arithmetic mean of all gaps. One large gap (e.g. a data
 *   series that has a 3-year break) inflates the mean dramatically, making
 *   monthly data look quarterly. The median is immune to those outliers.
 *
 * Typical medians by frequency:
 *   daily (weekdays)  ~1 day   (Mon-Thu gaps = 1 day, Fri-Mon = 3 days; median = 1)
 *   weekly            ~7 days
 *   monthly           ~30 days (EOM varies 28–31)
 *   quarterly         ~91 days (90-92 depending on quarter)
 *   semi-annual       ~182 days
 *   yearly            ~365 days
 *
 * Boundaries chosen as midpoints between adjacent typical values:
 *   daily/weekly   : 4    (midpoint 1–7)
 *   weekly/monthly : 16   (midpoint 7–30)
 *   monthly/qtrly  : 45   (midpoint 30–91, clear gap)
 *   qtrly/semi     : 120  (midpoint 91–182)
 *   semi/yearly    : 270  (midpoint 182–365)
 */
function classify(medianDays: number): DataFreq {
  if (medianDays <= 4) return 'daily'
  if (medianDays <= 16) return 'weekly'
  if (medianDays <= 45) return 'monthly'
  if (medianDays <= 120) return 'quarterly'
  if (medianDays <= 270) return 'semi-annual'
  return 'yearly'
}

function medianGapDays(sortedMs: number[]): number {
  const gaps: number[] = []
  for (let i = 1; i < sortedMs.length; i++) {
    const g = (sortedMs[i] - sortedMs[i - 1]) / 86_400_000
    if (g > 0) gaps.push(g) // skip duplicate timestamps
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  // For even-length arrays take the lower median (conservative — avoids
  // upgrading e.g. sparse-monthly to quarterly unnecessarily).
  return gaps[mid]
}

/**
 * Detect frequency from a full points array (used at parse / IPC-load time).
 * Uses median consecutive gap — robust against missing periods and outlier gaps.
 */
export function detectFrequency(points: { date: Date }[]): DataFreq {
  if (points.length < 2) return 'daily'
  const sorted = points.map((p) => p.date.getTime()).sort((a, b) => a - b)
  return classify(medianGapDays(sorted))
}

/**
 * Infer frequency from DBRecord summary fields (accordion list — no full points).
 * Falls back to span/(N-1) mean since individual gaps aren't available, but this
 * is accurate enough when the data has no large gaps (the common case for DB-stored
 * series, which are typically clean before save).
 */
export function inferFreqFromRecord(
  pointCount: number,
  startDate: string,
  endDate: string,
): DataFreq {
  if (pointCount < 2) return 'daily'
  const span = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000
  return classify(span / (pointCount - 1))
}

/**
 * Snap a UTC date to the canonical end-of-period for the given frequency.
 *
 *   monthly   → last calendar day of that month   (Apr 29 → Apr 30)
 *   quarterly → last day of the quarter           (Feb 15 → Mar 31)
 *   yearly    → Dec 31 of that year
 *   daily     → no change
 *
 * Source datasets often stamp observations on a business day rather than the
 * true calendar period-end.  Once detectFrequency classifies the data, the
 * day-of-month is noise — snapping normalises it.
 */
export function snapToFrequency(date: Date, freq: DataFreq): Date {
  if (freq === 'daily' || freq === 'weekly') return date
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() // 0-based
  if (freq === 'yearly') return new Date(Date.UTC(y, 11, 31))
  if (freq === 'semi-annual') {
    // Semi-annual: snap to Jun 30 or Dec 31
    return m < 6 ? new Date(Date.UTC(y, 5, 30)) : new Date(Date.UTC(y, 11, 31))
  }
  if (freq === 'quarterly') {
    // Quarter: 0→Mar, 1→Jun, 2→Sep, 3→Dec
    const qEnd = Math.floor(m / 3) * 3 + 3 // month after quarter-end (0-based)
    return new Date(Date.UTC(y, qEnd, 0))   // day 0 = last day of prior month
  }
  // monthly: last day of this month
  return new Date(Date.UTC(y, m + 1, 0))
}

/** Human-readable label for display. */
export function formatFreq(freq: DataFreq): string {
  return freq.charAt(0).toUpperCase() + freq.slice(1)
}

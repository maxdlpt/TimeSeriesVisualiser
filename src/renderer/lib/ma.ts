import type { DataPoint } from '../../shared/types'

/**
 * Rolling (trailing) MA: each output point is the mean of the preceding
 * `window` points including itself.  The first `window - 1` input points
 * have no output (not enough history).
 *
 * Output dates are identical to input dates — always a subset of the
 * parent series' timestamps, so the chart pivot never grows wider.
 */
export function computeRollingMA(points: DataPoint[], window: number): DataPoint[] {
  const result: DataPoint[] = []
  for (let i = window - 1; i < points.length; i++) {
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += points[j].value
    result.push({ date: points[i].date, value: sum / window })
  }
  return result
}

/**
 * Centered MA: each output point averages `floor((W-1)/2)` points before
 * and `ceil((W-1)/2)` points after itself.  Edge points where the full
 * window doesn't fit are excluded (gaps at both ends of the series).
 *
 * For odd W (e.g. 7): symmetric ±3 points.
 * For even W (e.g. 6): 2 before + current + 3 after (slightly forward-leaning).
 */
export function computeCenteredMA(points: DataPoint[], window: number): DataPoint[] {
  const before = Math.floor((window - 1) / 2)
  const after  = window - 1 - before
  const result: DataPoint[] = []
  for (let i = before; i <= points.length - 1 - after; i++) {
    let sum = 0
    for (let j = i - before; j <= i + after; j++) sum += points[j].value
    result.push({ date: points[i].date, value: sum / window })
  }
  return result
}

/**
 * Compute a moving average over a points array.
 * Returns an empty array if the window is larger than the available data.
 */
export function computeMA(
  points: DataPoint[],
  type: 'centered' | 'rolling',
  window: number,
): DataPoint[] {
  if (points.length < window) return []
  return type === 'rolling'
    ? computeRollingMA(points, window)
    : computeCenteredMA(points, window)
}

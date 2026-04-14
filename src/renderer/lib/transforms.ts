import type { DataPoint } from '../../shared/types'

export function toCumReturn(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  const base = pts[0].value
  return pts.map(p => ({ date: p.date, value: ((p.value - base) / base) * 100 }))
}

export function toNormalized(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  const base = pts[0].value
  return pts.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
}

export function toPctChange(pts: DataPoint[]): DataPoint[] {
  return pts.map((p, i) => {
    if (i === 0) return { date: p.date, value: 0 }
    const prev = pts[i - 1].value
    return { date: p.date, value: ((p.value - prev) / Math.abs(prev)) * 100 }
  })
}

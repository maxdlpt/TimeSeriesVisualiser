import { describe, it, expect } from 'vitest'
import { toCumReturn, toNormalized, toPctChange } from '../transforms'
import type { DataPoint } from '../../../shared/types'

const pts: DataPoint[] = [
  { date: new Date('2020-01-01'), value: 100 },
  { date: new Date('2020-02-01'), value: 110 },
  { date: new Date('2020-03-01'), value: 99 },
]

describe('transforms', () => {
  it('toCumReturn: first point is 0, second is 10%', () => {
    const out = toCumReturn(pts)
    expect(out[0].value).toBeCloseTo(0)
    expect(out[1].value).toBeCloseTo(10)
  })

  it('toNormalized: first point is 100', () => {
    const out = toNormalized(pts)
    expect(out[0].value).toBe(100)
    expect(out[1].value).toBeCloseTo(110)
  })

  it('toPctChange: second point shows period % change', () => {
    const out = toPctChange(pts)
    expect(out[1].value).toBeCloseTo(10)
  })
})

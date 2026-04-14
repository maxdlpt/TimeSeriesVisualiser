import { describe, it, expect } from 'vitest'
import { parseCSVText } from '../parse'

describe('parseCSVText', () => {
  it('parses simple date,value CSV', () => {
    const csv = `date,price\n2020-01-01,100\n2020-02-01,110`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(1)
    expect(series[0].name).toBe('price')
    expect(series[0].points).toHaveLength(2)
    expect(series[0].points[0].value).toBe(100)
  })

  it('parses multi-series CSV', () => {
    const csv = `date,cpi,gdp\n2020-01-01,257,21000\n2020-02-01,258,21100`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(2)
    expect(series.map(s => s.name)).toContain('cpi')
    expect(series.map(s => s.name)).toContain('gdp')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useGraphStore } from '../graph'
import type { DataSeries } from '../../../shared/types'

const POINTS = [{ date: new Date('2020-01-01'), value: 257 }]
const SERIES: DataSeries = {
  id: 's1', name: 'CPI', code: 'CPI', description: '', source: 'memory',
  points: [...POINTS],
  originalPoints: [...POINTS],
}

beforeEach(() => {
  useGraphStore.setState({ activeSeries: [], zoomDomain: null, rightPanel: null })
})

describe('useGraphStore', () => {
  it('adds a series', () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    expect(useGraphStore.getState().activeSeries).toHaveLength(1)
  })

  it('removes a series by id', () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    act(() => useGraphStore.getState().removeSeries('s1'))
    expect(useGraphStore.getState().activeSeries).toHaveLength(0)
  })

  it('sets zoom domain', () => {
    const domain = { start: new Date('2020-01-01'), end: new Date('2021-01-01') }
    act(() => useGraphStore.getState().setZoomDomain(domain))
    expect(useGraphStore.getState().zoomDomain).toEqual(domain)
  })

  it('auto-sets transform to cumulative for level series with no prior transform', () => {
    const levelSeries: DataSeries = {
      ...SERIES, id: 'level1', dataType: 'level', startingValue: 100,
    }
    act(() => useGraphStore.getState().addSeries(levelSeries))
    expect(useGraphStore.getState().activeSeries[0].transform).toBe('cumulative')
  })

  it('does not override transform for level series that already has one', () => {
    const levelSeries: DataSeries = {
      ...SERIES, id: 'level2', dataType: 'level', startingValue: 100,
      transform: 'returns',
    }
    act(() => useGraphStore.getState().addSeries(levelSeries))
    expect(useGraphStore.getState().activeSeries[0].transform).toBe('returns')
  })

  it('does not set transform for growth series', () => {
    const growthSeries: DataSeries = { ...SERIES, id: 'g1', dataType: 'growth' }
    act(() => useGraphStore.getState().addSeries(growthSeries))
    expect(useGraphStore.getState().activeSeries[0].transform).toBeUndefined()
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../schema'
import { MemoryDB } from '../memory'

let db: Database.Database
let memDB: MemoryDB

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  memDB = new MemoryDB(db)
})

afterEach(() => {
  db.close()
})

describe('MemoryDB', () => {
  it('saves and lists a series (growth default)', () => {
    memDB.saveSeries({
      id: 's1', name: 'US CPI', code: 'USCPI', description: 'CPI all items',
      points: [{ date: '2020-01-01', value: 257.97 }]
    })
    const list = memDB.listSeries()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('US CPI')
    expect(list[0].dataType).toBe('growth')
  })

  it('saves and lists a level series', () => {
    memDB.saveSeries({
      id: 's2', name: 'SP500', code: 'SP500', description: '',
      dataType: 'level', startingValue: 4000,
      points: [{ date: '2020-01-01', value: 0 }, { date: '2020-02-01', value: 2.5 }]
    })
    const list = memDB.listSeries()
    expect(list[0].dataType).toBe('level')
  })

  it('fetches a series with dataType and startingValue', () => {
    memDB.saveSeries({
      id: 's3', name: 'GDP', code: 'GDP', description: '',
      dataType: 'level', startingValue: 21000,
      points: [
        { date: '2020-01-01', value: 0 },
        { date: '2020-04-01', value: 1.5 }
      ]
    })
    const s = memDB.getSeries('s3')
    expect(s?.dataType).toBe('level')
    expect(s?.startingValue).toBe(21000)
    expect(s?.points).toHaveLength(2)
  })

  it('getSeries returns dataType growth and startingValue undefined for legacy series', () => {
    memDB.saveSeries({ id: 's4', name: 'Ret', code: 'RET', description: '', points: [] })
    const s = memDB.getSeries('s4')
    expect(s?.dataType).toBe('growth')
    expect(s?.startingValue).toBeUndefined()
  })

  it('updateSeriesMeta changes dataType without touching points', () => {
    memDB.saveSeries({
      id: 's5', name: 'X', code: 'X', description: '',
      dataType: 'growth', points: [{ date: '2020-01-01', value: 1 }]
    })
    memDB.updateSeriesMeta('s5', { dataType: 'level', startingValue: 500 })
    const s = memDB.getSeries('s5')
    expect(s?.dataType).toBe('level')
    expect(s?.startingValue).toBe(500)
    expect(s?.points).toHaveLength(1)
  })

  it('updateSeriesMeta clears startingValue when switching to growth', () => {
    memDB.saveSeries({
      id: 's6', name: 'Y', code: 'Y', description: '',
      dataType: 'level', startingValue: 100,
      points: [{ date: '2020-01-01', value: 0 }]
    })
    memDB.updateSeriesMeta('s6', { dataType: 'growth', startingValue: undefined })
    const s = memDB.getSeries('s6')
    expect(s?.dataType).toBe('growth')
    expect(s?.startingValue).toBeUndefined()
  })

  it('deleteSeries cascades to series_points', () => {
    memDB.saveSeries({
      id: 's7', name: 'Z', code: 'Z', description: '',
      points: [{ date: '2020-01-01', value: 1 }]
    })
    memDB.deleteSeries('s7')
    expect(memDB.listSeries()).toHaveLength(0)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { initSchema } from '../schema'
import { MemoryDB } from '../memory'
import { ExternalDBReader, TsvSchemaError, checkPathReachable } from '../external'

describe('ExternalDBReader (valid DB)', () => {
  let tmpPath: string
  let extDB: ExternalDBReader

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `test-${Date.now()}.db`)
    const db = new Database(tmpPath)
    initSchema(db)
    const mem = new MemoryDB(db)
    mem.saveSeries({
      id: 'x1',
      name: 'Ext Series',
      code: 'EXT',
      description: '',
      points: [{ date: '2020-01-01', value: 42 }],
    })
    db.close()
    extDB = new ExternalDBReader(tmpPath)
  })

  afterEach(() => {
    extDB.close()
    fs.unlinkSync(tmpPath)
  })

  it('lists series from external file', () => {
    const list = extDB.listSeries()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Ext Series')
  })

  it('gets series with points', () => {
    const s = extDB.getSeries('x1')
    expect(s?.points[0].value).toBe(42)
  })

  it('checkPathReachable returns true for a valid TSV DB', () => {
    expect(checkPathReachable(tmpPath)).toBe(true)
  })

  it('enables foreign_keys pragma on the reader connection (symmetry with MemoryDB)', () => {
    expect(extDB.isForeignKeysEnabled()).toBe(true)
  })
})

describe('ExternalDBReader (schema validation)', () => {
  let badPath: string

  beforeEach(() => {
    // A valid SQLite file that lacks the TSV schema
    badPath = path.join(os.tmpdir(), `bad-${Date.now()}.db`)
    const bad = new Database(badPath)
    bad.exec(`CREATE TABLE unrelated (x INTEGER); INSERT INTO unrelated VALUES (1);`)
    bad.close()
  })

  afterEach(() => {
    if (fs.existsSync(badPath)) fs.unlinkSync(badPath)
  })

  it('throws TsvSchemaError listing the missing tables', () => {
    let caught: unknown
    try {
      new ExternalDBReader(badPath)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(TsvSchemaError)
    const err = caught as TsvSchemaError
    expect(err.code).toBe('INVALID_SCHEMA')
    expect(err.missingTables).toEqual(expect.arrayContaining(['series', 'series_points']))
    expect(err.message).toMatch(/schema/i)
  })

  it('checkPathReachable returns false for a DB with the wrong schema', () => {
    expect(checkPathReachable(badPath)).toBe(false)
  })

  it('checkPathReachable returns false for a non-existent path', () => {
    expect(checkPathReachable(path.join(os.tmpdir(), `missing-${Date.now()}.db`))).toBe(false)
  })
})

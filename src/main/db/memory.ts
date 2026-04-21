import type Database from 'better-sqlite3'
import type { DBRecord, DataType } from '../../shared/types'

interface RawPoint { date: string; value: number }

export interface SeriesMetaPatch {
  dataType: DataType
  startingValue?: number
}

interface SavePayload {
  id: string
  name: string
  code: string
  description: string
  dataType?: DataType
  startingValue?: number
  points: RawPoint[]
}

interface RawSeriesRow {
  id: string
  name: string
  code: string
  description: string
  data_type: string
  starting_value: number | null
}

export class MemoryDB {
  constructor(private db: Database.Database) {}

  listSeries(): DBRecord[] {
    const rows = this.db.prepare<[], RawSeriesRow & { startDate: string; endDate: string; pointCount: number }>(`
      SELECT s.id, s.name, s.code, s.description,
        s.data_type, s.starting_value,
        MIN(p.date) as startDate, MAX(p.date) as endDate,
        COUNT(p.date) as pointCount
      FROM series s
      LEFT JOIN series_points p ON p.series_id = s.id
      GROUP BY s.id
    `).all()
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      startDate: row.startDate,
      endDate: row.endDate,
      pointCount: row.pointCount,
      dataType: (row.data_type as DataType) ?? 'growth',
    }))
  }

  getSeries(id: string): { id: string; name: string; code: string; description: string; dataType: DataType; startingValue?: number; points: RawPoint[] } | null {
    const meta = this.db.prepare('SELECT id, name, code, description, data_type, starting_value FROM series WHERE id = ?').get(id) as RawSeriesRow | undefined
    if (!meta) return null
    const points = this.db.prepare<[string], RawPoint>(
      'SELECT date, value FROM series_points WHERE series_id = ? ORDER BY date'
    ).all(id)
    return {
      id: meta.id,
      name: meta.name,
      code: meta.code,
      description: meta.description,
      dataType: (meta.data_type as DataType) ?? 'growth',
      startingValue: meta.starting_value ?? undefined,
      points,
    }
  }

  saveSeries(payload: SavePayload): void {
    const insertSeries = this.db.prepare(
      'INSERT OR REPLACE INTO series (id, name, code, description, data_type, starting_value) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const insertPoint = this.db.prepare(
      'INSERT OR REPLACE INTO series_points (series_id, date, value) VALUES (?, ?, ?)'
    )
    const deletePoints = this.db.prepare('DELETE FROM series_points WHERE series_id = ?')

    this.db.transaction(() => {
      insertSeries.run(
        payload.id,
        payload.name,
        payload.code,
        payload.description,
        payload.dataType ?? 'growth',
        payload.startingValue ?? null,
      )
      deletePoints.run(payload.id)
      for (const p of payload.points) {
        insertPoint.run(payload.id, p.date, p.value)
      }
    })()
  }

  updateSeriesMeta(id: string, patch: SeriesMetaPatch): void {
    this.db.prepare(
      'UPDATE series SET data_type = ?, starting_value = ? WHERE id = ?'
    ).run(patch.dataType, patch.startingValue ?? null, id)
  }

  deleteSeries(id: string): void {
    this.db.prepare('DELETE FROM series WHERE id = ?').run(id)
  }
}

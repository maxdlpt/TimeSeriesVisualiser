export interface DataPoint {
  date: Date
  value: number
}

export interface DataSeries {
  id: string
  name: string
  code: string
  description: string
  points: DataPoint[]
  source: 'memory' | 'external'
  dbId?: string          // only when source === 'external'
  color?: string
}

/**
 * Wire-format series as it crosses the IPC boundary: dates serialised as
 * ISO strings (YYYY-MM-DD), no renderer-only fields (source, dbId, color).
 * Consumers reshape into `DataSeries` in the renderer.
 */
export interface RawSeries {
  id: string
  name: string
  code: string
  description: string
  points: { date: string; value: number }[]
}

export interface DBRecord {
  id: string
  name: string
  code: string
  description: string
  startDate: string   // ISO string
  endDate: string     // ISO string
  pointCount: number
}

export interface ExternalDB {
  id: string
  name: string
  path: string
  reachable: boolean
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  colorPalette: string   // palette key
  externalDBs: ExternalDB[]
}

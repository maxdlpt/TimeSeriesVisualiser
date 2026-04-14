import type { DBRecord, AppSettings, RawSeries } from '../shared/types'

export interface TsvAPI {
  memory: {
    listSeries: () => Promise<DBRecord[]>
    getSeries: (id: string) => Promise<RawSeries | null>
    saveSeries: (payload: RawSeries) => Promise<void>
    deleteSeries: (id: string) => Promise<void>
  }
  external: {
    listSeries: (path: string) => Promise<DBRecord[]>
    getSeries: (path: string, id: string) => Promise<RawSeries | null>
    checkPath: (path: string) => Promise<boolean>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (s: AppSettings) => Promise<void>
  }
  dialog: {
    openDB: () => Promise<string | null>
    saveDB: (path: string, ids: string[]) => Promise<boolean>
  }
}

declare global {
  interface Window {
    tsv: TsvAPI
  }
}

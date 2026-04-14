import type { DataSeries, DBRecord, AppSettings } from '../../shared/types'

declare global {
  interface Window {
    tsv: {
      memory: {
        listSeries: () => Promise<DBRecord[]>
        getSeries: (id: string) => Promise<{ id: string; name: string; code: string; description: string; points: { date: string; value: number }[] } | null>
        saveSeries: (payload: unknown) => Promise<void>
        deleteSeries: (id: string) => Promise<void>
      }
      external: {
        listSeries: (path: string) => Promise<DBRecord[]>
        getSeries: (path: string, id: string) => Promise<unknown>
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
  }
}

function rawToDataSeries(raw: { id: string; name: string; code: string; description: string; points: { date: string; value: number }[] }, source: DataSeries['source'], dbId?: string): DataSeries {
  return {
    ...raw,
    source,
    dbId,
    points: raw.points.map(p => ({ date: new Date(p.date), value: p.value })),
  }
}

export const ipc = {
  memory: {
    listSeries: (): Promise<DBRecord[]> => window.tsv.memory.listSeries(),
    getSeries: async (id: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.memory.getSeries(id)
      return raw ? rawToDataSeries(raw, 'memory') : null
    },
    saveSeries: (s: DataSeries): Promise<void> => window.tsv.memory.saveSeries({
      id: s.id, name: s.name, code: s.code, description: s.description,
      points: s.points.map(p => ({ date: p.date.toISOString().slice(0, 10), value: p.value })),
    }),
    deleteSeries: (id: string): Promise<void> => window.tsv.memory.deleteSeries(id),
  },
  external: {
    listSeries: (path: string): Promise<DBRecord[]> => window.tsv.external.listSeries(path),
    getSeries: async (path: string, id: string, dbId: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.external.getSeries(path, id) as { id: string; name: string; code: string; description: string; points: { date: string; value: number }[] } | null
      return raw ? rawToDataSeries(raw, 'external', dbId) : null
    },
    checkPath: (path: string): Promise<boolean> => window.tsv.external.checkPath(path),
  },
  settings: {
    get: (): Promise<AppSettings> => window.tsv.settings.get(),
    save: (s: AppSettings): Promise<void> => window.tsv.settings.save(s),
  },
  dialog: {
    openDB: (): Promise<string | null> => window.tsv.dialog.openDB(),
    saveDB: (path: string, ids: string[]): Promise<boolean> => window.tsv.dialog.saveDB(path, ids),
  },
}

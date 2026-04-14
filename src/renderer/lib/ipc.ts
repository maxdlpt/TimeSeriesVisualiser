import type { DataSeries, DBRecord, AppSettings, RawSeries } from '../../shared/types'

function rawToDataSeries(
  raw: RawSeries,
  source: DataSeries['source'],
  dbId?: string,
): DataSeries {
  const points = raw.points.map((p) => ({ date: new Date(p.date), value: p.value }))
  return {
    ...raw,
    source,
    dbId,
    points,
    // Defensive per-element clone: 'Reset to Raw' must restore these exactly
    // even after an in-place mutation of any point's `value` or `date`.
    originalPoints: points.map((p) => ({ ...p })),
  }
}

export const ipc = {
  memory: {
    listSeries: (): Promise<DBRecord[]> => window.tsv.memory.listSeries(),
    getSeries: async (id: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.memory.getSeries(id)
      return raw ? rawToDataSeries(raw, 'memory') : null
    },
    saveSeries: (s: DataSeries): Promise<void> =>
      window.tsv.memory.saveSeries({
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        points: s.points.map((p) => ({
          date: p.date.toISOString().slice(0, 10),
          value: p.value,
        })),
      }),
    deleteSeries: (id: string): Promise<void> => window.tsv.memory.deleteSeries(id),
  },
  external: {
    listSeries: (path: string): Promise<DBRecord[]> => window.tsv.external.listSeries(path),
    getSeries: async (path: string, id: string, dbId: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.external.getSeries(path, id)
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
    saveDB: (path: string, ids: string[]): Promise<boolean> =>
      window.tsv.dialog.saveDB(path, ids),
  },
}

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { AppSettings, GraphSession, RawSeries } from '../shared/types'

contextBridge.exposeInMainWorld('tsv', {
  memory: {
    listSeries: () => ipcRenderer.invoke(IPC.MEMORY_LIST_SERIES),
    getSeries: (id: string) => ipcRenderer.invoke(IPC.MEMORY_GET_SERIES, id),
    saveSeries: (payload: RawSeries) => ipcRenderer.invoke(IPC.MEMORY_SAVE_SERIES, payload),
    deleteSeries: (id: string) => ipcRenderer.invoke(IPC.MEMORY_DELETE_SERIES, id),
  },
  external: {
    listSeries: (path: string) => ipcRenderer.invoke(IPC.EXTERNAL_LIST_SERIES, path),
    getSeries: (path: string, id: string) =>
      ipcRenderer.invoke(IPC.EXTERNAL_GET_SERIES, path, id),
    checkPath: (path: string) => ipcRenderer.invoke(IPC.EXTERNAL_CHECK_PATH, path),
    saveSeries: (path: string, payload: RawSeries) =>
      ipcRenderer.invoke(IPC.EXTERNAL_SAVE_SERIES, path, payload),
    deleteSeries: (path: string, id: string) =>
      ipcRenderer.invoke(IPC.EXTERNAL_DELETE_SERIES, path, id),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    save: (s: AppSettings) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, s),
  },
  dialog: {
    openDB: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_DB),
    saveDB: (path: string, ids: string[]) => ipcRenderer.invoke(IPC.DIALOG_SAVE_DB, path, ids),
  },
  session: {
    get: () => ipcRenderer.invoke(IPC.SESSION_GET),
    save: (s: GraphSession) => ipcRenderer.invoke(IPC.SESSION_SAVE, s),
  },
})

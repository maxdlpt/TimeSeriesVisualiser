import { ipcMain, dialog, app } from 'electron'
import path from 'path'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema'
import { MemoryDB } from '../db/memory'
import { ExternalDBReader, checkPathReachable } from '../db/external'
import { IPC } from '../../shared/ipc-channels'
import type { AppSettings, GraphSession, RawSeries } from '../../shared/types'

export function registerHandlers(): void {
  // Singleton internal memory DB. Initialised here (not at module import time)
  // so `app.getPath('userData')` is only read after `app.whenReady()` has
  // resolved — the caller of registerHandlers is expected to do so.
  const dbPath = path.join(app.getPath('userData'), 'memory.db')
  const rawDb = new Database(dbPath)
  initSchema(rawDb)
  const memDB = new MemoryDB(rawDb)

  const getSettings = (): AppSettings => {
    const raw = rawDb.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
      | { value: string }
      | undefined
    if (!raw) return { theme: 'system', colorPalette: 'default', externalDBs: [] }
    return JSON.parse(raw.value)
  }

  const saveSettings = (s: AppSettings): void => {
    rawDb
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)")
      .run(JSON.stringify(s))
  }

  ipcMain.handle(IPC.MEMORY_LIST_SERIES, () => memDB.listSeries())
  ipcMain.handle(IPC.MEMORY_GET_SERIES, (_e, id: string) => memDB.getSeries(id))
  ipcMain.handle(IPC.MEMORY_SAVE_SERIES, (_e, payload: RawSeries) => {
    memDB.saveSeries(payload)
  })
  ipcMain.handle(IPC.MEMORY_DELETE_SERIES, (_e, id: string) => {
    memDB.deleteSeries(id)
  })

  // External DB reads: let errors propagate so the renderer's ipcRenderer.invoke
  // promise rejects. TsvSchemaError carries `code` + `missingTables` that the
  // renderer can inspect via err.message; swallowing here would throw that away.
  ipcMain.handle(IPC.EXTERNAL_LIST_SERIES, (_e, filePath: string) => {
    const reader = new ExternalDBReader(filePath)
    try {
      return reader.listSeries()
    } finally {
      reader.close()
    }
  })

  ipcMain.handle(IPC.EXTERNAL_GET_SERIES, (_e, filePath: string, id: string) => {
    const reader = new ExternalDBReader(filePath)
    try {
      return reader.getSeries(id)
    } finally {
      reader.close()
    }
  })

  ipcMain.handle(IPC.EXTERNAL_CHECK_PATH, (_e, filePath: string) => checkPathReachable(filePath))

  ipcMain.handle(IPC.EXTERNAL_SAVE_SERIES, (_e, filePath: string, payload: RawSeries) => {
    const extDb = new Database(filePath)
    initSchema(extDb)
    const extMem = new MemoryDB(extDb)
    try {
      extMem.saveSeries(payload)
    } finally {
      extDb.close()
    }
  })

  ipcMain.handle(IPC.EXTERNAL_DELETE_SERIES, (_e, filePath: string, id: string) => {
    const extDb = new Database(filePath)
    initSchema(extDb)
    const extMem = new MemoryDB(extDb)
    try {
      extMem.deleteSeries(id)
    } finally {
      extDb.close()
    }
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s: AppSettings) => {
    saveSettings(s)
  })

  const getSession = (): GraphSession | null => {
    const raw = rawDb
      .prepare("SELECT value FROM settings WHERE key = 'graph_session'")
      .get() as { value: string } | undefined
    if (!raw) return null
    try { return JSON.parse(raw.value) } catch { return null }
  }

  const saveSession = (s: GraphSession): void => {
    rawDb
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('graph_session', ?)")
      .run(JSON.stringify(s))
  }

  ipcMain.handle(IPC.SESSION_GET, () => getSession())
  ipcMain.handle(IPC.SESSION_SAVE, (_e, s: GraphSession) => {
    saveSession(s)
  })

  ipcMain.handle(IPC.DIALOG_OPEN_DB, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Database', extensions: ['db'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_SAVE_DB, async (_e, filePath: string, seriesIds: string[]) => {
    const result = await dialog.showSaveDialog({
      defaultPath: filePath,
      filters: [{ name: 'Database', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return false
    const outDb = new Database(result.filePath)
    initSchema(outDb)
    const outMem = new MemoryDB(outDb)
    for (const id of seriesIds) {
      const s = memDB.getSeries(id)
      if (s) outMem.saveSeries(s)
    }
    outDb.close()
    return true
  })
}

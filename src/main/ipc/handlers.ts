import { ipcMain, dialog, app } from 'electron'
import path from 'path'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema'
import { MemoryDB } from '../db/memory'
import { ExternalDBReader, checkPathReachable } from '../db/external'
import { IPC } from '../../shared/ipc-channels'
import type { AppSettings } from '../../shared/types'

// Singleton internal memory DB
const dbPath = path.join(app.getPath('userData'), 'memory.db')
const rawDb = new Database(dbPath)
initSchema(rawDb)
const memDB = new MemoryDB(rawDb)

function getSettings(): AppSettings {
  const raw = rawDb.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
    | { value: string }
    | undefined
  if (!raw) return { theme: 'system', colorPalette: 'default', externalDBs: [] }
  return JSON.parse(raw.value)
}

function saveSettings(s: AppSettings): void {
  rawDb
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)")
    .run(JSON.stringify(s))
}

export function registerHandlers(): void {
  ipcMain.handle(IPC.MEMORY_LIST_SERIES, () => memDB.listSeries())
  ipcMain.handle(IPC.MEMORY_GET_SERIES, (_e, id: string) => memDB.getSeries(id))
  ipcMain.handle(IPC.MEMORY_SAVE_SERIES, (_e, payload) => {
    memDB.saveSeries(payload)
  })
  ipcMain.handle(IPC.MEMORY_DELETE_SERIES, (_e, id: string) => {
    memDB.deleteSeries(id)
  })

  ipcMain.handle(IPC.EXTERNAL_LIST_SERIES, (_e, filePath: string) => {
    try {
      const reader = new ExternalDBReader(filePath)
      const list = reader.listSeries()
      reader.close()
      return list
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.EXTERNAL_GET_SERIES, (_e, filePath: string, id: string) => {
    try {
      const reader = new ExternalDBReader(filePath)
      const s = reader.getSeries(id)
      reader.close()
      return s
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.EXTERNAL_CHECK_PATH, (_e, filePath: string) => checkPathReachable(filePath))

  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s: AppSettings) => {
    saveSettings(s)
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

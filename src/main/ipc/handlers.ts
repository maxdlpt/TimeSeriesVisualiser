import { ipcMain, dialog, app, BrowserWindow, clipboard } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawnSync } from 'child_process'
import Database from 'better-sqlite3'
import XLSX from 'xlsx'
import { initSchema } from '../db/schema'
import { MemoryDB } from '../db/memory'
import { ExternalDBReader, checkPathReachable } from '../db/external'
import { IPC } from '../../shared/ipc-channels'
import type { AppSettings, GraphSession, RawSeries, SavedGraph, SavedGraphMeta, DataType } from '../../shared/types'

interface SeriesMetaPatch {
  dataType: DataType
  startingValue?: number
}

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
    if (!raw) return { theme: 'system', colorPalette: 'mono', externalDBs: [] }
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

  ipcMain.handle(IPC.MEMORY_UPDATE_SERIES_META, (_e, id: string, patch: SeriesMetaPatch) => {
    memDB.updateSeriesMeta(id, patch)
  })

  ipcMain.handle(IPC.EXTERNAL_UPDATE_SERIES_META, (_e, filePath: string, id: string, patch: SeriesMetaPatch) => {
    const extDb = new Database(filePath)
    initSchema(extDb)
    const extMem = new MemoryDB(extDb)
    try {
      extMem.updateSeriesMeta(id, patch)
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

  // ─── Saved graphs (.tsv-graph files) ──────────────────────────────────────
  const graphsDir = path.join(app.getPath('userData'), 'graphs')
  if (!fs.existsSync(graphsDir)) fs.mkdirSync(graphsDir, { recursive: true })

  ipcMain.handle(IPC.GRAPH_SAVE, (_e, payload: SavedGraph, existingFilename?: string) => {
    const filename = existingFilename ?? `${crypto.randomUUID()}.tsv-graph`
    fs.writeFileSync(path.join(graphsDir, filename), JSON.stringify(payload), 'utf-8')
    return filename
  })

  ipcMain.handle(IPC.GRAPH_LIST, (): SavedGraphMeta[] => {
    const files = fs.readdirSync(graphsDir).filter(f => f.endsWith('.tsv-graph'))
    const metas: SavedGraphMeta[] = []
    for (const filename of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(graphsDir, filename), 'utf-8')) as SavedGraph
        metas.push({
          filename,
          name: raw.name,
          savedAt: raw.savedAt,
          seriesCount: raw.session?.series?.length ?? 0,
        })
      } catch { /* skip corrupt files */ }
    }
    return metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  })

  ipcMain.handle(IPC.GRAPH_LOAD, (_e, filename: string): SavedGraph | null => {
    const filePath = path.join(graphsDir, filename)
    if (!fs.existsSync(filePath)) return null
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) } catch { return null }
  })

  ipcMain.handle(IPC.GRAPH_DELETE, (_e, filename: string) => {
    const filePath = path.join(graphsDir, filename)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  })

  ipcMain.handle(IPC.GRAPH_IMPORT, async (): Promise<SavedGraph | null> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'TSV Graph', extensions: ['tsv-graph'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    try { return JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8')) } catch { return null }
  })

  ipcMain.handle(IPC.GRAPH_EXPORT, async (_e, payload: SavedGraph) => {
    const safeName = payload.name.replace(/[^a-zA-Z0-9 _-]/g, '')
    const result = await dialog.showSaveDialog({
      defaultPath: `${safeName}.tsv-graph`,
      filters: [{ name: 'TSV Graph', extensions: ['tsv-graph'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, JSON.stringify(payload), 'utf-8')
    return true
  })

  ipcMain.handle(IPC.CAPTURE_RECT, async (_e, rect: { x: number; y: number; width: number; height: number }) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
    return image.toPNG()
  })

  ipcMain.handle(IPC.DIALOG_SAVE_PNG, async (_e, defaultName: string, pngData: Buffer) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, Buffer.from(pngData))
    return true
  })

  ipcMain.handle(IPC.DIALOG_SAVE_CSV, async (_e, defaultName: string, csvText: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'CSV File', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, csvText, 'utf-8')
    return true
  })

  ipcMain.handle(IPC.DIALOG_OPEN_DB, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Database', extensions: ['db'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_CREATE_DB, async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'New Database.db',
      filters: [{ name: 'Database', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return null
    const newDb = new Database(result.filePath)
    initSchema(newDb)
    newDb.close()
    return result.filePath
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

  // ─── Clipboard: read spreadsheet data via Electron's full clipboard API ──────
  //
  // The web clipboardData API sanitizes HTML, stripping Excel's x:num attributes
  // that contain raw numeric values. The main process can read the RAW CF_HTML
  // clipboard buffer which preserves these attributes.
  //
  // On Windows, the CF_HTML format includes byte-offset headers:
  //   Version:0.9\r\nStartHTML:XXXX\r\nEndHTML:XXXX\r\n...
  // followed by the actual HTML. clipboard.readHTML() strips x:num in some Electron
  // versions, but clipboard.readBuffer('text/html') gives the raw bytes.
  ipcMain.handle(IPC.CLIPBOARD_READ_SPREADSHEET, () => {
    const formats = clipboard.availableFormats()
    let bestGrid: string[][] | null = null
    let bestSource = 'none'

    console.log('[clipboard] Available formats:', formats)

    // ── Helper: Excel serial date → YYYY-MM-DD ─────────────────────────────
    const serialToISO = (serial: number): string => {
      const dayOff = serial > 60 ? serial - 2 : serial - 1
      const d = new Date(Date.UTC(1900, 0, 1 + dayOff))
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }

    // ── Helper: parse HTML table with x:num extraction ──────────────────────
    const parseHtmlTable = (htmlStr: string, label: string): string[][] | null => {
      const hasXnum = htmlStr.includes('x:num')
      console.log(`[clipboard] ${label}: contains x:num = ${hasXnum}`)
      if (!hasXnum) {
        // Log a snippet around the first <td to see what attributes exist
        const tdIdx = htmlStr.indexOf('<td')
        if (tdIdx >= 0) console.log(`[clipboard] ${label}: first <td snippet:`, htmlStr.slice(tdIdx, tdIdx + 200))
      }

      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
      const cellRegex = /<t[dh][^>]*?>([\s\S]*?)<\/t[dh]>/gi
      const rows: string[][] = []
      let rowMatch: RegExpExecArray | null
      let logged = 0

      while ((rowMatch = rowRegex.exec(htmlStr)) !== null) {
        const rowHtml = rowMatch[1]
        const cells: string[] = []
        let cellMatch: RegExpExecArray | null
        cellRegex.lastIndex = 0

        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
          const fullTag = cellMatch[0]
          // Extract x:num — may use single quotes, double quotes, or no quotes
          const xm = fullTag.match(/x:num=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/)
          const xNum = xm ? (xm[1] ?? xm[2] ?? xm[3]) : null
          const textContent = cellMatch[1].replace(/<[^>]*>/g, '').trim()

          if (cells.length === 0 && xNum != null && !isNaN(Number(xNum))) {
            cells.push(serialToISO(Number(xNum)))
          } else {
            cells.push(xNum ?? textContent)
          }
        }

        if (cells.length > 0) {
          if (logged < 2) {
            console.log(`[clipboard] ${label} row[${rows.length}]:`, cells.slice(0, 3))
            logged++
          }
          rows.push(cells)
        }
      }

      console.log(`[clipboard] ${label}: parsed ${rows.length} rows`)
      return rows.length > 0 ? rows : null
    }

    // ── Helper: parse XML Spreadsheet (SpreadsheetML 2003) ────────────────
    // Excel puts this format on the clipboard with EXACT numeric values
    // (not display-formatted) and proper DateTime types for dates.
    const parseXmlSpreadsheet = (xml: string): string[][] | null => {
      const rows: string[][] = []
      const rowRe = /<(?:ss:)?Row[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/gi
      let rm: RegExpExecArray | null

      while ((rm = rowRe.exec(xml)) !== null) {
        const inner = rm[1]
        const cells: string[] = []

        const cellRe = /<(?:ss:)?Cell([^>]*)>([\s\S]*?)<\/(?:ss:)?Cell>/gi
        let cm: RegExpExecArray | null

        while ((cm = cellRe.exec(inner)) !== null) {
          const attrs = cm[1]
          const body = cm[2]

          // Handle ss:Index (1-based column skip for sparse rows)
          const idxM = attrs.match(/ss:Index="(\d+)"/)
          if (idxM) {
            const target = parseInt(idxM[1]) - 1
            while (cells.length < target) cells.push('')
          }

          // Extract <Data ss:Type="...">value</Data>
          const dataM = body.match(/<(?:ss:)?Data\s+ss:Type="(\w+)"[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/)
          if (dataM) {
            const type = dataM[1]
            const raw = dataM[2].trim()

            if (type === 'DateTime') {
              // "2023-01-15T00:00:00.000" → "2023-01-15"
              cells.push(raw.slice(0, 10))
            } else if (type === 'Number' && cells.length === 0) {
              // First column Number might be an Excel serial date
              const n = Number(raw)
              if (n > 1 && n < 100000) {
                // Likely a serial date — convert to ISO
                cells.push(serialToISO(n))
              } else {
                cells.push(raw)
              }
            } else {
              // Number → exact raw value with full precision
              // String → text content
              cells.push(raw)
            }
          } else {
            cells.push('')
          }
        }

        if (cells.length > 0) rows.push(cells)
      }

      console.log(`[clipboard] XML Spreadsheet: parsed ${rows.length} rows`)
      if (rows.length > 0) {
        console.log(`[clipboard] XML Spreadsheet row[0]:`, rows[0].slice(0, 3))
        if (rows.length > 1) console.log(`[clipboard] XML Spreadsheet row[1]:`, rows[1].slice(0, 3))
      }

      return rows.length > 0 ? rows : null
    }

    // ── Helper: parse Biff8 buffer via XLSX library ──────────────────────
    const parseBiff8Buffer = (buf: Buffer): string[][] | null => {
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws || !ws['!ref']) return null
      const range = XLSX.utils.decode_range(ws['!ref'])
      const grid: string[][] = []
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: string[] = []
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as
            | { t: string; v: unknown; w?: string }
            | undefined
          if (!cell) { row.push(''); continue }
          if (cell.t === 'd' && cell.v instanceof Date) {
            row.push(cell.v.toISOString().slice(0, 10))
          } else if (cell.t === 'n' && c === range.s.c && typeof cell.v === 'number' && cell.v > 1 && cell.v < 100000) {
            row.push(serialToISO(cell.v as number))
          } else if (cell.t === 'n') {
            row.push(String(cell.v))
          } else {
            row.push(cell.w ?? String(cell.v ?? ''))
          }
        }
        grid.push(row)
      }
      return grid.length > 0 ? grid : null
    }

    // ── 1. Electron readBuffer — fast path (may return 0 bytes) ────────────
    // Chromium's clipboard only exposes standard formats. These registered
    // Windows format names might not be accessible, but are worth trying.
    for (const fmt of ['XML Spreadsheet', 'Biff8']) {
      if (bestGrid) break
      try {
        const buf = clipboard.readBuffer(fmt)
        console.log(`[clipboard] readBuffer("${fmt}"): ${buf.length} bytes`)
        if (buf.length > 0) {
          const grid = fmt === 'Biff8'
            ? parseBiff8Buffer(buf)
            : parseXmlSpreadsheet(buf.toString('utf8'))
          if (grid) {
            bestGrid = grid
            bestSource = `electron-${fmt}`
          }
        }
      } catch (err) {
        console.log(`[clipboard] readBuffer("${fmt}") skipped:`, (err as Error).message?.slice(0, 80))
      }
    }

    // ── 2. PowerShell .NET Clipboard — reads ANY registered Windows format ─
    // Electron/Chromium can't access "XML Spreadsheet" or "Biff8" because
    // they're not in Chromium's format table. .NET's System.Windows.Forms
    // .Clipboard has full access to every registered clipboard format.
    if (!bestGrid) {
      try {
        // Single PowerShell call: try XML Spreadsheet first, fall back to
        // Biff8 (written to temp file since it's binary).
        const biffTmp = path.join(app.getPath('temp'), 'tsv-clip.biff8')
        const psScript = [
          'Add-Type -AssemblyName System.Windows.Forms',
          "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
          // Try XML Spreadsheet (text-based, raw values)
          "$xml = [System.Windows.Forms.Clipboard]::GetData('XML Spreadsheet')",
          'if ($xml -is [System.IO.MemoryStream]) {',
          '  $r = [System.IO.StreamReader]::new($xml, [System.Text.Encoding]::UTF8)',
          "  Write-Output 'FMT:XML'",
          '  $r.ReadToEnd()',
          '  $r.Close()',
          '  exit',
          '} elseif ($xml -is [string] -and $xml.Length -gt 10) {',
          "  Write-Output 'FMT:XML'",
          '  Write-Output $xml',
          '  exit',
          '}',
          // Fall back to Biff8 (binary → temp file)
          "$biff = [System.Windows.Forms.Clipboard]::GetData('Biff8')",
          'if ($biff -is [System.IO.MemoryStream]) {',
          `  $f = [System.IO.File]::Create('${biffTmp}')`,
          '  $biff.CopyTo($f)',
          '  $f.Close()',
          "  Write-Output 'FMT:BIFF8'",
          `  Write-Output '${biffTmp}'`,
          '  exit',
          '}',
          "Write-Output 'FMT:NONE'",
        ].join('\n')

        const psResult = spawnSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-Command', psScript,
        ], {
          encoding: 'utf8',
          timeout: 8000,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        })

        const psOut = psResult.stdout ?? ''
        const firstLine = psOut.split('\n')[0]?.trim()
        console.log(`[clipboard] PowerShell: format=${firstLine}, exit=${psResult.status}, stderr=${(psResult.stderr ?? '').slice(0, 120)}`)

        if (psResult.status === 0 && firstLine === 'FMT:XML') {
          // Everything after "FMT:XML\n" is the XML content
          const xml = psOut.slice(psOut.indexOf('\n') + 1)
          console.log(`[clipboard] PS XML: ${xml.length} chars, snippet: ${xml.slice(0, 200)}`)
          const xmlGrid = parseXmlSpreadsheet(xml)
          if (xmlGrid) {
            bestGrid = xmlGrid
            bestSource = 'PS-XML-Spreadsheet'
          }
        } else if (psResult.status === 0 && firstLine === 'FMT:BIFF8') {
          const biffPath = psOut.split('\n')[1]?.trim()
          if (biffPath && fs.existsSync(biffPath)) {
            const biffBuf = fs.readFileSync(biffPath)
            try { fs.unlinkSync(biffPath) } catch { /* best-effort cleanup */ }
            console.log(`[clipboard] PS Biff8: ${biffBuf.length} bytes`)
            const biffGrid = parseBiff8Buffer(biffBuf)
            if (biffGrid) {
              console.log(`[clipboard] PS Biff8: parsed ${biffGrid.length} rows`)
              if (biffGrid.length > 1) console.log(`[clipboard] PS Biff8 row[1]:`, biffGrid[1].slice(0, 3))
              bestGrid = biffGrid
              bestSource = 'PS-Biff8'
            }
          }
        }
      } catch (err) {
        console.log(`[clipboard] PowerShell failed:`, (err as Error).message?.slice(0, 120))
      }
    }

    // ── 3. Raw CF_HTML buffer (display-formatted, fallback) ────────────────
    if (!bestGrid) {
      try {
        const rawBuf = clipboard.readBuffer('HTML Format')
        if (rawBuf.length > 0) {
          let rawHtml = rawBuf.toString('utf8')
          const fragStart = rawHtml.match(/StartFragment:(\d+)/)
          const fragEnd = rawHtml.match(/EndFragment:(\d+)/)
          if (fragStart && fragEnd) {
            rawHtml = rawBuf.slice(Number(fragStart[1]), Number(fragEnd[1])).toString('utf8')
          }
          const rawGrid = parseHtmlTable(rawHtml, 'HTML Format')
          if (rawGrid) {
            bestGrid = rawGrid
            bestSource = 'HTML Format'
          }
        }
      } catch { /* skip */ }
    }

    // ── 4. clipboard.readHTML() fallback ────────────────────────────────────
    if (!bestGrid) {
      const html = clipboard.readHTML()
      if (html) {
        const grid = parseHtmlTable(html, 'readHTML')
        if (grid) { bestGrid = grid; bestSource = 'readHTML' }
      }
    }

    // ── 5. Plain text fallback (tab-separated, display-formatted) ──────────
    if (!bestGrid) {
      const text = clipboard.readText()
      if (text.trim()) {
        bestGrid = text.trim().split(/\r?\n/).map((row: string) => row.split('\t'))
        bestSource = 'text'
      }
    }

    // Normalize: pad all rows to the same column count (some parsers
    // omit trailing empty cells, producing jagged arrays).
    if (bestGrid && bestGrid.length > 0) {
      const maxCols = Math.max(...bestGrid.map(r => r.length))
      for (const row of bestGrid) {
        while (row.length < maxCols) row.push('')
      }
    }

    console.log(`[clipboard] WINNER: "${bestSource}" with ${bestGrid?.length ?? 0} rows, cols=${bestGrid?.[0]?.length ?? 0}`)
    if (bestGrid && bestGrid.length > 0) {
      console.log(`[clipboard] Headers:`, bestGrid[0])
      if (bestGrid.length > 1) console.log(`[clipboard] Sample row[1]:`, bestGrid[1])
    }

    return bestGrid
  })
}

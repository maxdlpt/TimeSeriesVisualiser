# Data Type Label (Level / Growth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `DataType` (`'level'` | `'growth'`) label to every series, auto-detect it at upload parse time, convert Level series to growth rates at ingest, and display Level series in absolute or normalised Index mode on the chart.

**Architecture:** Changes thread through 5 layers — shared types → SQLite schema + DB layer → IPC + preload → renderer lib (parse, transforms, ipc, store) → UI (GraphTab, SeriesEditPanel, SeriesReviewPanel, DBTab / series-list). Each layer is independently testable. Pure utility functions (`detectDataType`, `toGrowthRates`, `reconstructLevels`, `toLevelIndex`) use TDD. DB layer tests use a real in-memory SQLite instance (never mock).

**Tech Stack:** TypeScript, better-sqlite3, Vitest, React 18, Zustand, Tailwind v4

---

## File Change Map

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `DataType`; extend `DataSeries`, `RawSeries`, `SessionSeries`, `DBRecord` |
| `src/shared/ipc-channels.ts` | Two new channel constants |
| `src/main/db/schema.ts` | Idempotent ALTER TABLE for `data_type` and `starting_value` |
| `src/main/db/memory.ts` | `SavePayload` gains fields; `listSeries`/`getSeries`/`saveSeries` updated; new `updateSeriesMeta` |
| `src/main/ipc/handlers.ts` | Pass `dataType`/`startingValue` through; two new `update-series-meta` handlers |
| `src/preload/index.ts` | Expose `updateSeriesMeta` for memory and external |
| `src/preload/index.d.ts` | Add type signature for `updateSeriesMeta` |
| `src/renderer/lib/parse.ts` | Add `detectDataType`, `toGrowthRates`; apply in `parseCSVText` |
| `src/renderer/lib/transforms.ts` | Add `reconstructLevels`, `toLevelIndex` |
| `src/renderer/lib/ipc.ts` | Thread `dataType`/`startingValue`; save `originalPoints` (bug fix); add `updateSeriesMeta` |
| `src/renderer/store/graph.ts` | `addSeries` auto-sets `transform = 'cumulative'` for Level series |
| `src/renderer/components/tabs/GraphTab.tsx` | New `applyLevelIndex`; update `displaySeries` useMemo; "Cumulative"→"Index" labels |
| `src/renderer/components/graph/SeriesEditPanel.tsx` | "Cumulative"→"Index" labels |
| `src/renderer/components/upload/SeriesReviewPanel.tsx` | `dataType` field in Draft + dropdown UI |
| `src/renderer/components/ui/series-list.tsx` | Level/Growth badge + clickable inline popover |
| `src/main/db/__tests__/memory.test.ts` | Tests for new fields in save/get/list/updateSeriesMeta |
| `src/renderer/lib/__tests__/parse.test.ts` | Tests for `detectDataType`, `toGrowthRates` |
| `src/renderer/lib/__tests__/transforms.test.ts` | Tests for `reconstructLevels`, `toLevelIndex` |
| `src/renderer/store/__tests__/graph.test.ts` | Test for Level-series auto-transform in `addSeries` |

---

## Task 1: Type System

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add `DataType` and extend all types**

In `src/shared/types.ts`, add at the top (after the `SeriesTransform` line):

```ts
export type DataType = 'level' | 'growth'
```

Then extend `DataSeries` (add after `cumBaseInput?`):

```ts
  dataType?: DataType       // undefined treated as 'growth' for backward compat
  startingValue?: number    // only meaningful when dataType === 'level'
```

Extend `RawSeries` (add after `points`):

```ts
  dataType?: DataType
  startingValue?: number
```

Extend `SessionSeries` (add after `cumBaseInput?`):

```ts
  dataType?: DataType
  startingValue?: number
```

Extend `DBRecord` (add after `pointCount`):

```ts
  dataType?: DataType   // populated by listSeries(); undefined for legacy rows
```

- [ ] **Step 2: Add two new IPC channel constants**

In `src/shared/ipc-channels.ts`, add inside the `IPC` enum after `MEMORY_DELETE_SERIES`:

```ts
  MEMORY_UPDATE_SERIES_META = 'memory:update-series-meta',
```

And after `EXTERNAL_DELETE_SERIES`:

```ts
  EXTERNAL_UPDATE_SERIES_META = 'external:update-series-meta',
```

- [ ] **Step 3: Run typecheck — expect zero errors (only new optional fields, no breakage)**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/shared/ipc-channels.ts
git commit -m "feat: add DataType, extend DataSeries/RawSeries/SessionSeries/DBRecord, new IPC channels"
```

---

## Task 2: DB Schema Migration

**Files:**
- Modify: `src/main/db/schema.ts`

- [ ] **Step 1: Add idempotent ALTER TABLE statements**

In `src/main/db/schema.ts`, add the migration block **after** the `db.exec(...)` call:

```ts
export function initSchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      code        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS series_points (
      series_id   TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      value       REAL NOT NULL,
      PRIMARY KEY (series_id, date)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Idempotent column additions — swallow "duplicate column name" errors on re-run.
  const addColumn = (sql: string) => {
    try { db.exec(sql) } catch { /* column already exists */ }
  }
  addColumn(`ALTER TABLE series ADD COLUMN data_type     TEXT NOT NULL DEFAULT 'growth'`)
  addColumn(`ALTER TABLE series ADD COLUMN starting_value REAL`)
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/schema.ts
git commit -m "feat: idempotent ALTER TABLE to add data_type and starting_value to series"
```

---

## Task 3: DB Layer + Tests

**Files:**
- Modify: `src/main/db/memory.ts`
- Modify: `src/main/db/__tests__/memory.test.ts`

- [ ] **Step 1: Write failing tests for new DB behaviour**

Replace the full contents of `src/main/db/__tests__/memory.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../schema'
import { MemoryDB } from '../memory'

let db: Database.Database
let memDB: MemoryDB

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  memDB = new MemoryDB(db)
})

afterEach(() => {
  db.close()
})

describe('MemoryDB', () => {
  it('saves and lists a series (growth default)', () => {
    memDB.saveSeries({
      id: 's1', name: 'US CPI', code: 'USCPI', description: 'CPI all items',
      points: [{ date: '2020-01-01', value: 257.97 }]
    })
    const list = memDB.listSeries()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('US CPI')
    expect(list[0].dataType).toBe('growth')
  })

  it('saves and lists a level series with dataType and startingValue', () => {
    memDB.saveSeries({
      id: 's2', name: 'SP500', code: 'SP500', description: '',
      dataType: 'level', startingValue: 4000,
      points: [{ date: '2020-01-01', value: 0 }, { date: '2020-02-01', value: 2.5 }]
    })
    const list = memDB.listSeries()
    expect(list[0].dataType).toBe('level')
  })

  it('fetches a series by id with dataType and startingValue', () => {
    memDB.saveSeries({
      id: 's3', name: 'GDP', code: 'GDP', description: '',
      dataType: 'level', startingValue: 21000,
      points: [
        { date: '2020-01-01', value: 0 },
        { date: '2020-04-01', value: 1.5 }
      ]
    })
    const s = memDB.getSeries('s3')
    expect(s?.dataType).toBe('level')
    expect(s?.startingValue).toBe(21000)
    expect(s?.points).toHaveLength(2)
  })

  it('getSeries returns dataType growth and startingValue undefined for legacy series', () => {
    // Simulate a legacy series with no data_type (DEFAULT fills 'growth')
    memDB.saveSeries({ id: 's4', name: 'Ret', code: 'RET', description: '', points: [] })
    const s = memDB.getSeries('s4')
    expect(s?.dataType).toBe('growth')
    expect(s?.startingValue).toBeUndefined()
  })

  it('updateSeriesMeta changes dataType without touching points', () => {
    memDB.saveSeries({
      id: 's5', name: 'X', code: 'X', description: '',
      dataType: 'growth', points: [{ date: '2020-01-01', value: 1 }]
    })
    memDB.updateSeriesMeta('s5', { dataType: 'level', startingValue: 500 })
    const s = memDB.getSeries('s5')
    expect(s?.dataType).toBe('level')
    expect(s?.startingValue).toBe(500)
    expect(s?.points).toHaveLength(1) // points untouched
  })

  it('updateSeriesMeta clears startingValue when switching to growth', () => {
    memDB.saveSeries({
      id: 's6', name: 'Y', code: 'Y', description: '',
      dataType: 'level', startingValue: 100,
      points: [{ date: '2020-01-01', value: 0 }]
    })
    memDB.updateSeriesMeta('s6', { dataType: 'growth', startingValue: undefined })
    const s = memDB.getSeries('s6')
    expect(s?.dataType).toBe('growth')
    expect(s?.startingValue).toBeUndefined()
  })

  it('deleteSeries cascades to series_points', () => {
    memDB.saveSeries({
      id: 's7', name: 'Z', code: 'Z', description: '',
      points: [{ date: '2020-01-01', value: 1 }]
    })
    memDB.deleteSeries('s7')
    expect(memDB.listSeries()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm run test -- --reporter=verbose src/main/db/__tests__/memory.test.ts
```

Expected: failures for `dataType`, `startingValue`, `updateSeriesMeta` (not implemented yet).

- [ ] **Step 3: Update `memory.ts` to make tests pass**

Replace the full contents of `src/main/db/memory.ts`:

```ts
import type Database from 'better-sqlite3'
import type { DBRecord, DataType } from '../../shared/types'

interface RawPoint { date: string; value: number }

interface SeriesMetaPatch {
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
    return this.db.prepare<[], DBRecord & { data_type: string }>(`
      SELECT s.id, s.name, s.code, s.description,
        s.data_type,
        MIN(p.date) as startDate, MAX(p.date) as endDate,
        COUNT(p.date) as pointCount
      FROM series s
      LEFT JOIN series_points p ON p.series_id = s.id
      GROUP BY s.id
    `).all().map(row => ({
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
```

- [ ] **Step 4: Run tests — expect all passing**

```bash
npm run test -- --reporter=verbose src/main/db/__tests__/memory.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/db/memory.ts src/main/db/__tests__/memory.test.ts
git commit -m "feat: MemoryDB supports data_type and starting_value; add updateSeriesMeta"
```

---

## Task 4: IPC Handlers + Preload Bridge

**Files:**
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Update `handlers.ts` — add `SeriesMetaPatch` interface and two new handlers**

In `src/main/ipc/handlers.ts`, add the `SeriesMetaPatch` interface after the imports (or after the `registerHandlers` opening):

```ts
interface SeriesMetaPatch {
  dataType: 'level' | 'growth'
  startingValue?: number
}
```

Add the two new handlers at the end of `registerHandlers()`, before the closing brace (after the existing `EXTERNAL_DELETE_SERIES` handler):

```ts
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
```

- [ ] **Step 2: Update `preload/index.ts` — expose `updateSeriesMeta` on both namespaces**

In `src/preload/index.ts`, inside the `memory` object, add after `deleteSeries`:

```ts
    updateSeriesMeta: (id: string, patch: { dataType: string; startingValue?: number }) =>
      ipcRenderer.invoke(IPC.MEMORY_UPDATE_SERIES_META, id, patch),
```

Inside the `external` object, add after `deleteSeries`:

```ts
    updateSeriesMeta: (path: string, id: string, patch: { dataType: string; startingValue?: number }) =>
      ipcRenderer.invoke(IPC.EXTERNAL_UPDATE_SERIES_META, path, id, patch),
```

- [ ] **Step 3: Update `preload/index.d.ts` — add type declarations**

In `src/preload/index.d.ts`, inside the `TsvAPI` interface, extend the `memory` and `external` namespaces. Add to `memory`:

```ts
    updateSeriesMeta: (id: string, patch: { dataType: 'level' | 'growth'; startingValue?: number }) => Promise<void>
```

Add to `external`:

```ts
    updateSeriesMeta: (path: string, id: string, patch: { dataType: 'level' | 'growth'; startingValue?: number }) => Promise<void>
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: IPC handlers and preload bridge for update-series-meta"
```

---

## Task 5: Parse Utilities + Tests

**Files:**
- Modify: `src/renderer/lib/parse.ts`
- Modify: `src/renderer/lib/__tests__/parse.test.ts`

- [ ] **Step 1: Write failing tests for `detectDataType` and `toGrowthRates`**

Append to `src/renderer/lib/__tests__/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseCSVText, detectDataType, toGrowthRates } from '../parse'
import type { DataPoint } from '../../../shared/types'

// ── existing tests preserved above ──

describe('detectDataType', () => {
  function pts(vals: number[]): DataPoint[] {
    return vals.map((v, i) => ({ date: new Date(2020, i, 1), value: v }))
  }

  it('returns growth when more than 15% of values are negative', () => {
    // 2 negatives out of 10 = 20%
    expect(detectDataType(pts([1, 2, -1, 3, 4, 5, 6, 7, -2, 8]))).toBe('growth')
  })

  it('returns level when <5% negative and medianAbs > 20 (price-like)', () => {
    expect(detectDataType(pts([100, 105, 102, 108, 110]))).toBe('level')
  })

  it('returns growth for return-like values (small magnitude)', () => {
    expect(detectDataType(pts([1.2, -0.5, 0.8, 1.1, 0.3]))).toBe('growth')
  })

  it('returns growth for empty array', () => {
    expect(detectDataType([])).toBe('growth')
  })

  it('returns level for a large-magnitude all-positive index series', () => {
    const vals = Array.from({ length: 20 }, (_, i) => 4000 + i * 10)
    expect(detectDataType(pts(vals))).toBe('level')
  })
})

describe('toGrowthRates', () => {
  it('first point is a zero sentinel with the original date', () => {
    const input: DataPoint[] = [
      { date: new Date('2020-01-01'), value: 100 },
      { date: new Date('2020-02-01'), value: 110 },
      { date: new Date('2020-03-01'), value: 99 },
    ]
    const { growthPoints, startingValue } = toGrowthRates(input)
    expect(growthPoints[0].value).toBe(0)
    expect(growthPoints[0].date).toEqual(input[0].date)
    expect(startingValue).toBe(100)
  })

  it('computes percentage change correctly', () => {
    const input: DataPoint[] = [
      { date: new Date('2020-01-01'), value: 100 },
      { date: new Date('2020-02-01'), value: 110 },
    ]
    const { growthPoints } = toGrowthRates(input)
    // (110 - 100) / |100| * 100 = 10
    expect(growthPoints[1].value).toBeCloseTo(10)
  })

  it('handles negative prices in denominator via Math.abs', () => {
    const input: DataPoint[] = [
      { date: new Date('2020-01-01'), value: -50 },
      { date: new Date('2020-02-01'), value: -40 },
    ]
    const { growthPoints } = toGrowthRates(input)
    // (-40 - -50) / |-50| * 100 = 10/50 * 100 = 20
    expect(growthPoints[1].value).toBeCloseTo(20)
  })

  it('produces N growth points for N input points', () => {
    const input: DataPoint[] = [
      { date: new Date('2020-01-01'), value: 4000 },
      { date: new Date('2020-02-01'), value: 4100 },
      { date: new Date('2020-03-01'), value: 3900 },
    ]
    const { growthPoints } = toGrowthRates(input)
    expect(growthPoints).toHaveLength(3)
  })
})

describe('parseCSVText with data type detection', () => {
  it('detects level series and converts to growth rates', () => {
    const csv = `date,sp500\n2020-01-01,4000\n2020-02-01,4100\n2020-03-01,3900`
    const series = parseCSVText(csv)
    expect(series[0].dataType).toBe('level')
    expect(series[0].startingValue).toBe(4000)
    // First point should be 0 (sentinel), second ≈ +2.5%
    expect(series[0].points[0].value).toBe(0)
    expect(series[0].points[1].value).toBeCloseTo(2.5)
  })

  it('detects growth series and stores raw values', () => {
    const csv = `date,ret\n2020-01-01,1.2\n2020-02-01,-0.5\n2020-03-01,0.8`
    const series = parseCSVText(csv)
    expect(series[0].dataType).toBe('growth')
    expect(series[0].startingValue).toBeUndefined()
    expect(series[0].points[0].value).toBe(1.2)
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm run test -- --reporter=verbose src/renderer/lib/__tests__/parse.test.ts
```

Expected: failures for `detectDataType` and `toGrowthRates` (not yet exported).

- [ ] **Step 3: Add `detectDataType` and `toGrowthRates` to `parse.ts`**

In `src/renderer/lib/parse.ts`, add after the existing imports (add `DataType` and `DataPoint` to the types import):

```ts
import type { DataSeries, DataPoint, DataType } from '../../shared/types'
```

Then add these two functions just before the `parseCSVText` function:

```ts
/**
 * Heuristic that classifies uploaded values as Level (prices/indices) or Growth (returns).
 *
 * Rules:
 *   negFrac > 0.15               → 'growth'  (returns frequently change sign)
 *   negFrac < 0.05 AND medAbs > 20 → 'level'  (nearly all positive, price magnitude)
 *   otherwise                    → 'growth'  (safe default)
 */
export function detectDataType(points: DataPoint[]): DataType {
  const N = points.length
  if (N === 0) return 'growth'
  const negFrac = points.filter(p => p.value < 0).length / N
  if (negFrac > 0.15) return 'growth'
  const absVals = points.map(p => Math.abs(p.value)).sort((a, b) => a - b)
  const medianAbs = absVals[Math.floor((N - 1) / 2)]
  if (negFrac < 0.05 && medianAbs > 20) return 'level'
  return 'growth'
}

/**
 * Converts N level data points into N growth rate points.
 *
 * growthPoints[0]  = { date: d₀, value: 0 }               (sentinel — no prior period)
 * growthPoints[i]  = { date: dᵢ, value: (valᵢ − valᵢ₋₁) / |valᵢ₋₁| × 100 }
 * startingValue    = points[0].value                        (original first price)
 *
 * Math.abs in denominator matches toPctChange — handles negative prices correctly.
 */
export function toGrowthRates(points: DataPoint[]): { growthPoints: DataPoint[]; startingValue: number } {
  const startingValue = points[0].value
  const growthPoints: DataPoint[] = [
    { date: points[0].date, value: 0 },
    ...points.slice(1).map((p, i) => ({
      date: p.date,
      value: ((p.value - points[i].value) / Math.abs(points[i].value)) * 100,
    })),
  ]
  return { growthPoints, startingValue }
}
```

- [ ] **Step 4: Integrate detection + conversion into `parseCSVText`**

In `parseCSVText`, replace the `return valueHeaders.map(...)` block with:

```ts
  return valueHeaders.map((col, i) => {
    const rawPoints = rows
      .map((row, rowIdx) => ({
        date: parsedDates[rowIdx],
        value: parseFloat(row[col]),
      }))
      .filter((p) => !isNaN(p.date.getTime()) && !isNaN(p.value))
    const freq = detectFrequency(rawPoints)
    if (freq !== 'daily') {
      for (const p of rawPoints) p.date = snapToFrequency(p.date, freq)
    }

    const detectedType = detectDataType(rawPoints)
    let points = rawPoints
    let startingValue: number | undefined

    if (detectedType === 'level') {
      const converted = toGrowthRates(rawPoints)
      points = converted.growthPoints
      startingValue = converted.startingValue
    }

    return {
      id: makeId(),
      name: col.replace(/_\d+$/, ''),
      code: codes[i],
      description: '',
      data_freq: freq,
      source: 'memory' as const,
      dataType: detectedType,
      startingValue,
      points,
      originalPoints: points.map((p) => ({ ...p })),
    }
  })
```

- [ ] **Step 5: Run tests — expect all passing**

```bash
npm run test -- --reporter=verbose src/renderer/lib/__tests__/parse.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/parse.ts src/renderer/lib/__tests__/parse.test.ts
git commit -m "feat: detectDataType, toGrowthRates — Level series converted at parse time"
```

---

## Task 6: New Transform Functions + Tests

**Files:**
- Modify: `src/renderer/lib/transforms.ts`
- Modify: `src/renderer/lib/__tests__/transforms.test.ts`

- [ ] **Step 1: Write failing tests for `reconstructLevels` and `toLevelIndex`**

Append to `src/renderer/lib/__tests__/transforms.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toCumReturn, toNormalized, toPctChange, reconstructLevels, toLevelIndex } from '../transforms'
import type { DataPoint } from '../../../shared/types'

// ── existing tests above ──

describe('reconstructLevels', () => {
  it('returns empty array for empty input', () => {
    expect(reconstructLevels([], 100)).toEqual([])
  })

  it('first point is startingValue', () => {
    const pts: DataPoint[] = [
      { date: new Date('2020-01-01'), value: 0 },
      { date: new Date('2020-02-01'), value: 10 },
    ]
    const result = reconstructLevels(pts, 4000)
    expect(result[0].value).toBe(4000)
  })

  it('compounds growth rates correctly', () => {
    // Starting at 100, +10%, then -9.09%  ≈ back to 100
    const pts: DataPoint[] = [
      { date: new Date('2020-01-01'), value: 0 },
      { date: new Date('2020-02-01'), value: 10 },
      { date: new Date('2020-03-01'), value: -9.0909 },
    ]
    const result = reconstructLevels(pts, 100)
    expect(result[0].value).toBe(100)
    expect(result[1].value).toBeCloseTo(110)
    expect(result[2].value).toBeCloseTo(100, 1)
  })

  it('produces N output points for N input points', () => {
    const pts: DataPoint[] = [
      { date: new Date('2020-01-01'), value: 0 },
      { date: new Date('2020-02-01'), value: 2.5 },
      { date: new Date('2020-03-01'), value: -2.44 },
    ]
    expect(reconstructLevels(pts, 4000)).toHaveLength(3)
  })

  it('is the inverse of toGrowthRates', () => {
    // Build some levels, convert to growth rates, then reconstruct — should round-trip.
    const original: DataPoint[] = [
      { date: new Date('2020-01-01'), value: 4000 },
      { date: new Date('2020-02-01'), value: 4100 },
      { date: new Date('2020-03-01'), value: 3950 },
    ]
    // Manual conversion (mirrors toGrowthRates)
    const growthPts: DataPoint[] = [
      { date: original[0].date, value: 0 },
      { date: original[1].date, value: ((4100 - 4000) / 4000) * 100 },
      { date: original[2].date, value: ((3950 - 4100) / 4100) * 100 },
    ]
    const reconstructed = reconstructLevels(growthPts, 4000)
    expect(reconstructed[0].value).toBeCloseTo(4000)
    expect(reconstructed[1].value).toBeCloseTo(4100)
    expect(reconstructed[2].value).toBeCloseTo(3950, 1)
  })
})

describe('toLevelIndex', () => {
  const levels: DataPoint[] = [
    { date: new Date('2020-01-01'), value: 4000 },
    { date: new Date('2020-02-01'), value: 4200 },
    { date: new Date('2020-03-01'), value: 3800 },
  ]

  it('normalises to 100 at the base date', () => {
    const baseMs = levels[0].date.getTime()
    const result = toLevelIndex(levels, baseMs)
    expect(result[0].value).toBeCloseTo(100)
  })

  it('scales subsequent points proportionally', () => {
    const baseMs = levels[0].date.getTime()
    const result = toLevelIndex(levels, baseMs)
    expect(result[1].value).toBeCloseTo(105) // 4200/4000 * 100
    expect(result[2].value).toBeCloseTo(95)  // 3800/4000 * 100
  })

  it('uses the first point at or after baseDateMs if no exact match', () => {
    const baseMs = levels[1].date.getTime()
    const result = toLevelIndex(levels, baseMs)
    expect(result[1].value).toBeCloseTo(100)
    expect(result[0].value).toBeCloseTo((4000 / 4200) * 100, 1)
  })

  it('returns empty array for empty input', () => {
    expect(toLevelIndex([], 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm run test -- --reporter=verbose src/renderer/lib/__tests__/transforms.test.ts
```

Expected: failures for `reconstructLevels` and `toLevelIndex` (not yet exported).

- [ ] **Step 3: Add `reconstructLevels` and `toLevelIndex` to `transforms.ts`**

Append to `src/renderer/lib/transforms.ts`:

```ts
/**
 * Reconstructs absolute level values from stored growth rates and a starting value.
 *
 * val₀ = startingValue
 * valᵢ = (1 + growthRateᵢ / 100) × valᵢ₋₁
 *
 * This is the inverse of toGrowthRates — used to display Level series in absolute mode.
 */
export function reconstructLevels(originalPoints: DataPoint[], startingValue: number): DataPoint[] {
  if (originalPoints.length === 0) return []
  const result: DataPoint[] = [{ date: originalPoints[0].date, value: startingValue }]
  for (let i = 1; i < originalPoints.length; i++) {
    result.push({
      date: originalPoints[i].date,
      value: (1 + originalPoints[i].value / 100) * result[i - 1].value,
    })
  }
  return result
}

/**
 * Normalises absolute level values to an index anchored at 100 on `baseDateMs`.
 *
 * Uses the first point whose timestamp is >= baseDateMs as the base.
 * val_t / val_base × 100
 */
export function toLevelIndex(levels: DataPoint[], baseDateMs: number): DataPoint[] {
  if (levels.length === 0) return []
  const basePoint = levels.find(p => p.date.getTime() >= baseDateMs)
  if (!basePoint || basePoint.value === 0) return levels
  const base = basePoint.value
  return levels.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
}
```

- [ ] **Step 4: Run tests — expect all passing**

```bash
npm run test -- --reporter=verbose src/renderer/lib/__tests__/transforms.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/transforms.ts src/renderer/lib/__tests__/transforms.test.ts
git commit -m "feat: reconstructLevels and toLevelIndex pure transform functions"
```

---

## Task 7: Renderer IPC Layer

**Files:**
- Modify: `src/renderer/lib/ipc.ts`

- [ ] **Step 1: Update `rawToDataSeries` to pass `dataType` and `startingValue`**

`rawToDataSeries` already spreads `...raw` before the explicit fields, so once `RawSeries` has `dataType?` and `startingValue?` (done in Task 1), those fields are automatically passed through `...raw`. No code change needed here — verify by inspection that the return block contains `...raw`.

The current return is:
```ts
return {
  ...raw,     // ← includes dataType? and startingValue? from RawSeries
  source,
  dbId,
  data_freq: freq,
  points,
  originalPoints: points.map((p) => ({ ...p })),
}
```

This is correct as-is.

- [ ] **Step 2: Update `serializeSeries` to include `dataType` and `startingValue`**

In `src/renderer/lib/ipc.ts`, in the `serializeSeries` function, add the two new fields after `cumBaseInput`:

```ts
export function serializeSeries(s: DataSeries): SessionSeries {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    description: s.description,
    data_freq: s.data_freq,
    source: s.source,
    dbId: s.dbId,
    color: s.color,
    visible: s.visible,
    lineStyle: s.lineStyle,
    lineWidth: s.lineWidth,
    movingAverages: s.movingAverages?.map(serializeMA),
    transform: s.transform,
    cumMethod: s.cumMethod,
    cumBaseInput: s.cumBaseInput,
    dataType: s.dataType,
    startingValue: s.startingValue,
    points: s.points.map((p) => ({ date: p.date.toISOString().slice(0, 10), value: p.value })),
    originalPoints: s.originalPoints.map((p) => ({ date: p.date.toISOString().slice(0, 10), value: p.value })),
  }
}
```

`deserializeSeries` already uses `...s` spread so `dataType` and `startingValue` come through automatically.

- [ ] **Step 3: Fix `ipc.memory.saveSeries` to save `originalPoints` instead of `points`**

This is a bug fix — currently the display-transformed values are being persisted.

In `src/renderer/lib/ipc.ts`, update `ipc.memory.saveSeries`:

```ts
    saveSeries: (s: DataSeries): Promise<void> =>
      window.tsv.memory.saveSeries({
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        dataType: s.dataType,
        startingValue: s.startingValue,
        points: s.originalPoints.map((p) => ({
          date: p.date.toISOString().slice(0, 10),
          value: p.value,
        })),
      }),
```

Update `ipc.external.saveSeries` the same way:

```ts
    saveSeries: (path: string, s: DataSeries): Promise<void> =>
      window.tsv.external.saveSeries(path, {
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        dataType: s.dataType,
        startingValue: s.startingValue,
        points: s.originalPoints.map((p) => ({
          date: p.date.toISOString().slice(0, 10),
          value: p.value,
        })),
      }),
```

- [ ] **Step 4: Add `updateSeriesMeta` to `ipc.memory` and `ipc.external`**

Add to `ipc.memory` (after `deleteSeries`):

```ts
    updateSeriesMeta: (id: string, patch: { dataType: 'level' | 'growth'; startingValue?: number }): Promise<void> =>
      window.tsv.memory.updateSeriesMeta(id, patch),
```

Add to `ipc.external` (after `deleteSeries`):

```ts
    updateSeriesMeta: (path: string, id: string, patch: { dataType: 'level' | 'growth'; startingValue?: number }): Promise<void> =>
      window.tsv.external.updateSeriesMeta(path, id, patch),
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/ipc.ts
git commit -m "fix: save originalPoints (not display points); thread dataType/startingValue through IPC layer"
```

---

## Task 8: Graph Store Auto-Set + Test

**Files:**
- Modify: `src/renderer/store/graph.ts`
- Modify: `src/renderer/store/__tests__/graph.test.ts`

- [ ] **Step 1: Write a failing test for Level-series auto-transform**

Append to `src/renderer/store/__tests__/graph.test.ts`:

```ts
  it('auto-sets transform to cumulative when adding a Level series', () => {
    const levelSeries: DataSeries = {
      id: 'l1', name: 'SP500', code: 'SP500', description: '', source: 'memory',
      dataType: 'level', startingValue: 4000,
      points: [{ date: new Date('2020-01-01'), value: 0 }],
      originalPoints: [{ date: new Date('2020-01-01'), value: 0 }],
    }
    act(() => useGraphStore.getState().addSeries(levelSeries))
    const added = useGraphStore.getState().activeSeries[0]
    expect(added.transform).toBe('cumulative')
  })

  it('does not override transform for Growth series', () => {
    const growthSeries: DataSeries = {
      id: 'g1', name: 'CPI', code: 'CPI', description: '', source: 'memory',
      dataType: 'growth',
      points: [{ date: new Date('2020-01-01'), value: 1.2 }],
      originalPoints: [{ date: new Date('2020-01-01'), value: 1.2 }],
    }
    act(() => useGraphStore.getState().addSeries(growthSeries))
    const added = useGraphStore.getState().activeSeries[0]
    expect(added.transform).toBeUndefined() // no auto-set for growth
  })
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm run test -- --reporter=verbose src/renderer/store/__tests__/graph.test.ts
```

Expected: the new two tests fail.

- [ ] **Step 3: Update `addSeries` in `graph.ts`**

In `src/renderer/store/graph.ts`, replace the `addSeries` action:

```ts
  addSeries: (s) => set((state) => {
    if (state.activeSeries.find(x => x.id === s.id)) return state
    // Level series auto-select Index mode. The isAlone check in applyLevelIndex
    // at render time determines absolute vs normalised display automatically.
    const incoming = s.dataType === 'level' ? { ...s, transform: 'cumulative' as const } : s
    return { activeSeries: [...state.activeSeries, incoming] }
  }),
```

- [ ] **Step 4: Run tests — expect all passing**

```bash
npm run test -- --reporter=verbose src/renderer/store/__tests__/graph.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/graph.ts src/renderer/store/__tests__/graph.test.ts
git commit -m "feat: addSeries auto-sets transform=cumulative for Level series"
```

---

## Task 9: GraphTab — Level Index Display Path

**Files:**
- Modify: `src/renderer/components/tabs/GraphTab.tsx`

This task adds `applyLevelIndex` and wires it into `displaySeries`.

- [ ] **Step 1: Add the `reconstructLevels` and `computeMA` import (if not already present)**

At the top of `src/renderer/components/tabs/GraphTab.tsx`, ensure these are imported:

```ts
import { computeMA } from '../../lib/ma'
import { reconstructLevels } from '../../lib/transforms'
```

(`computeMA` is already imported; add `reconstructLevels` to the `transforms` import line.)

- [ ] **Step 2: Add the `applyLevelIndex` function**

Insert this function directly after `applyDrawdown` (around line 245):

```ts
/**
 * Apply the Level-Index display transform to all Level series in cumulative mode.
 *
 * Behaviour:
 *   isAlone (only one Level-index series on the chart):
 *     → Absolute mode — reconstruct original price levels using startingValue.
 *   Multiple Level-index series:
 *     → Normalised mode — intersect dates, normalise all to 100 at the earliest
 *       common date (or cumBaseInput if provided).
 *
 * This mirrors the intersection-date semantics of applyCumulativeReturns.
 */
function applyLevelIndex(series: DataSeries[]): DataSeries[] {
  if (series.length === 0) return series

  const isAlone = series.length === 1

  if (isAlone) {
    const s = series[0]
    if (s.startingValue == null) return series
    const levels = reconstructLevels(s.originalPoints, s.startingValue)
    const newMAs = (s.movingAverages ?? []).map(ma => ({
      ...ma,
      points: computeMA(levels, ma.type, ma.window),
    }))
    return [{ ...s, points: levels, movingAverages: newMAs }]
  }

  // Multi-series: reconstruct levels for each, then normalise to common base date.
  const withLevels = series.map(s => ({
    s,
    levels: s.startingValue != null
      ? reconstructLevels(s.originalPoints, s.startingValue)
      : s.originalPoints,
  }))

  // Intersection of timestamps across all series
  const sets = withLevels.map(({ levels }) => new Set(levels.map(p => p.date.getTime())))
  const intersectionTs = new Set<number>(
    [...sets[0]].filter(t => sets.every(set => set.has(t))),
  )
  const sorted = Array.from(intersectionTs).sort((a, b) => a - b)
  if (sorted.length === 0) return series

  // Base timestamp: earliest common date, or snap to cumBaseInput if provided.
  let baseTs = sorted[0]
  const baseInput = series.find(s => s.cumBaseInput?.trim())?.cumBaseInput?.trim() ?? ''
  if (baseInput) {
    const parsed = new Date(baseInput.trim())
    if (!isNaN(parsed.getTime())) {
      const target = parsed.getTime()
      baseTs = sorted.reduce((best, t) =>
        Math.abs(t - target) < Math.abs(best - target) ? t : best,
      )
    }
  }

  return withLevels.map(({ s, levels }) => {
    const filtered = levels.filter(p => intersectionTs.has(p.date.getTime()))
    if (filtered.length === 0) return s
    const basePoint = filtered.find(p => p.date.getTime() === baseTs)
    if (!basePoint || basePoint.value === 0) return { ...s, points: filtered }
    const base = basePoint.value
    const normPoints = filtered.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
    const newMAs = (s.movingAverages ?? []).map(ma => ({
      ...ma,
      points: computeMA(normPoints, ma.type, ma.window),
    }))
    return { ...s, points: normPoints, movingAverages: newMAs }
  })
}
```

- [ ] **Step 3: Update `displaySeries` useMemo to route Level series through `applyLevelIndex`**

Replace the `displaySeries` useMemo (lines ~866–900) with:

```ts
  const displaySeries = useMemo(() => {
    if (activeSeries.length === 0) return activeSeries

    // Group by transform type. Level series in cumulative mode go to applyLevelIndex;
    // Growth series in cumulative mode continue through applyCumulativeReturns.
    const raw: DataSeries[] = []
    const levelCum: DataSeries[] = []
    const cumGroups = new Map<string, DataSeries[]>()  // key = cumMethod:cumBaseInput
    const ddSeries: DataSeries[] = []

    for (const s of activeSeries) {
      const t = s.transform ?? 'returns'
      if (t === 'returns') raw.push(s)
      else if (t === 'drawdown') ddSeries.push(s)
      else if (s.dataType === 'level') levelCum.push(s)
      else {
        const key = `${s.cumMethod ?? 'geometric'}:${s.cumBaseInput ?? ''}`
        const group = cumGroups.get(key) ?? []
        group.push(s)
        cumGroups.set(key, group)
      }
    }

    // Level series in index mode (absolute if alone, normalised if multiple)
    const levelResults = levelCum.length > 0 ? applyLevelIndex(levelCum) : []

    // Growth cumulative per group (independent intersection dates)
    const cumResults: DataSeries[] = []
    for (const [key, group] of cumGroups) {
      const [method, baseInput] = key.split(':') as [CumMethod, string]
      cumResults.push(...applyCumulativeReturns(group, method, baseInput))
    }

    const ddResults = ddSeries.length > 0 ? applyDrawdown(ddSeries) : []

    // Merge back in original order
    const resultMap = new Map<string, DataSeries>()
    for (const s of [...raw, ...levelResults, ...cumResults, ...ddResults]) resultMap.set(s.id, s)
    return activeSeries.map(s => resultMap.get(s.id) ?? s)
  }, [activeSeries])
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/tabs/GraphTab.tsx
git commit -m "feat: applyLevelIndex — absolute and normalised Level-series display in GraphTab"
```

---

## Task 10: UI Label Renames ("Cumulative" → "Index")

**Files:**
- Modify: `src/renderer/components/graph/SeriesEditPanel.tsx`
- Modify: `src/renderer/components/tabs/GraphTab.tsx`

- [ ] **Step 1: Rename labels in `SeriesEditPanel.tsx`**

In `src/renderer/components/graph/SeriesEditPanel.tsx`, make these two changes:

Change line 673 (the button label):
```ts
// Before:
{ value: 'cumulative' as const, label: 'Cumulative' },
// After:
{ value: 'cumulative' as const, label: 'Index' },
```

Change line 691 (the sub-options header comment and visible text — find `"Cumulative sub-options"`):
```ts
// Before:
{/* Cumulative sub-options — only when this series is set to cumulative */}
// After:
{/* Index sub-options — only when this series is set to cumulative */}
```

- [ ] **Step 2: Rename the visible "Cumulative" axis label in `GraphTab.tsx`**

Find the section in GraphTab that renders the axis label text "cumulative" or "Cumulative" for display. This is in the legend or axis label area. Search for string literals containing `"cumulative"` in UI render positions (not code logic).

In `GraphTab.tsx`, find all occurrences where the string `'Cumulative'` or `'cumulative'` is used as a **display label** (not as a `SeriesTransform` value like `=== 'cumulative'` or `transform === 'cumulative'`).

Common locations:
- Legend badge showing transform name: find `transform === 'cumulative' ? 'Cumulative'` or similar
- Any tooltip or label that displays the transform name

Replace each display-only occurrence of `'Cumulative'` with `'Index'`.

Example: if there is a pattern like:
```ts
const transformLabel = t === 'cumulative' ? 'Cumulative' : t === 'drawdown' ? 'Drawdown' : 'Returns'
```
Change to:
```ts
const transformLabel = t === 'cumulative' ? 'Index' : t === 'drawdown' ? 'Drawdown' : 'Returns'
```

Do NOT change `=== 'cumulative'` comparisons or `transform: 'cumulative'` assignments — only visible label strings.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/graph/SeriesEditPanel.tsx src/renderer/components/tabs/GraphTab.tsx
git commit -m "feat: rename Cumulative→Index in all UI labels (SeriesTransform value unchanged)"
```

---

## Task 11: SeriesReviewPanel — Data Type Dropdown

**Files:**
- Modify: `src/renderer/components/upload/SeriesReviewPanel.tsx`

- [ ] **Step 1: Add `DataType` import and extend `Draft` interface**

In `src/renderer/components/upload/SeriesReviewPanel.tsx`, update the types import to include `DataType`:

```ts
import type { DataSeries, DataFreq, DataType } from '../../../shared/types'
```

Extend the `Draft` interface (add after `data_freq`):

```ts
interface Draft {
  name: string
  code: string
  description: string
  data_freq: DataFreq
  dataType: DataType
}
```

- [ ] **Step 2: Initialise `dataType` from parsed series in the `drafts` useState**

Replace the `useState<Map<string, Draft>>` initialiser:

```ts
    const [drafts, setDrafts] = useState<Map<string, Draft>>(
      () => new Map(series.map(s => [s.id, {
        name: s.name,
        code: s.code,
        description: s.description,
        data_freq: s.data_freq ?? 'daily',
        dataType: s.dataType ?? 'growth',
      }]))
    )
```

- [ ] **Step 3: Add the Data Type dropdown to the 2×2 grid (making it 2×3, or a row of 5 below)**

In the JSX, after the Frequency `<div>` block inside the `grid grid-cols-2 gap-x-4 gap-y-3`, add a new grid cell spanning both columns for the Data Type dropdown. Insert after the closing `</div>` of the Frequency field:

```tsx
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Data Type</label>
                  <select
                    value={draft.dataType}
                    onChange={e => updateDraft(s.id, { dataType: e.target.value as DataType })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option
                      value="level"
                      title="Prices, indices, and exchange rates. Stored internally as period growth rates with a starting value. Displayed as an index by default."
                    >
                      Level
                    </option>
                    <option
                      value="growth"
                      title="Period-over-period changes or returns. Stored as-is."
                    >
                      Growth
                    </option>
                  </select>
                </div>
```

- [ ] **Step 4: Apply `dataType` when `getAll()` returns assignments**

The `useImperativeHandle` `getAll()` spreads `drafts.get(s.id)` over `s`. Since `Draft` now includes `dataType`, the spread automatically applies it. Verify the current implementation:

```ts
    useImperativeHandle(ref, () => ({
      getAll: () => series.map(s => ({
        series: { ...s, ...(drafts.get(s.id) ?? {}) },  // ← dataType propagates via spread
        destination: destinations.get(s.id) ?? { type: 'graph' },
      })),
    }), [series, drafts, destinations])
```

No change needed here — the spread already applies all Draft fields.

Also ensure the inline single-add button passes dataType:

```ts
                onClick={() => onAddSingle({ series: { ...s, ...draft }, destination: dest })}
```

This already spreads `draft` which contains `dataType`. No change needed.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/upload/SeriesReviewPanel.tsx
git commit -m "feat: Data Type dropdown in SeriesReviewPanel with Level/Growth options and hover tooltips"
```

---

## Task 12: DBTab Series List — Level/Growth Badge

**Files:**
- Modify: `src/renderer/components/ui/series-list.tsx`

This adds a clickable Level/Growth badge to each series row that opens an inline popover for editing `data_type` and `starting_value`.

- [ ] **Step 1: Add `DataType` import and a `DataTypeBadge` component with popover**

In `src/renderer/components/ui/series-list.tsx`, add `DataType` to the types import:

```ts
import type { DBRecord, DataFreq, DataSeries, DataType } from '../../../shared/types'
```

Add the `ipc` import if not already present:
```ts
import { ipc } from '../../lib/ipc'
```

Add the new `DataTypeBadge` component after the existing `FreqBadge` component:

```tsx
interface DataTypeBadgeProps {
  record: DBRecord
  dbPath: string | null
  onUpdated: (id: string, dataType: DataType, startingValue?: number) => void
}

function DataTypeBadge({ record, dbPath, onUpdated }: DataTypeBadgeProps) {
  const [open, setOpen] = useState(false)
  const [dataType, setDataType] = useState<DataType>(record.dataType ?? 'growth')
  const [startingValue, setStartingValue] = useState<string>(
    record.dataType === 'level' ? '' : ''  // populated when popover opens; we don't store startingValue in DBRecord
  )
  const ref = useRef<HTMLDivElement>(null)

  // Reset local state when record changes
  useEffect(() => {
    setDataType(record.dataType ?? 'growth')
    setOpen(false)
  }, [record.id, record.dataType])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleConfirm() {
    const sv = dataType === 'level' ? parseFloat(startingValue) : undefined
    if (dataType === 'level' && (isNaN(sv!) || sv == null)) return  // require a valid number
    try {
      if (dbPath) {
        await ipc.external.updateSeriesMeta(dbPath, record.id, { dataType, startingValue: sv })
      } else {
        await ipc.memory.updateSeriesMeta(record.id, { dataType, startingValue: sv })
      }
      onUpdated(record.id, dataType, sv)
      setOpen(false)
    } catch { /* silent — rare IPC failure */ }
  }

  const isLevel = (record.dataType ?? 'growth') === 'level'

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'px-2.5 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap transition-colors',
          isLevel
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/50'
            : 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700',
        )}
      >
        {isLevel ? 'Level' : 'Growth'}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className={cn(
              'absolute left-0 top-full mt-1 z-50',
              'min-w-[180px] rounded-lg overflow-hidden shadow-lg',
              'bg-slate-50 dark:bg-zinc-900',
              'border border-slate-200 dark:border-zinc-800',
              'p-3 space-y-3',
            )}
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Data Type</p>
              <select
                value={dataType}
                onChange={e => setDataType(e.target.value as DataType)}
                className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="level">Level</option>
                <option value="growth">Growth</option>
              </select>
            </div>

            {dataType === 'level' && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Starting Value</p>
                <input
                  type="number"
                  value={startingValue}
                  onChange={e => setStartingValue(e.target.value)}
                  placeholder="e.g. 4000"
                  className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded py-1 text-xs text-muted-foreground hover:text-foreground border border-border transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 rounded py-1 text-xs font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
              >
                Save
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Add `useRef` to imports (it should already be imported; verify)**

`useRef` is already in the component file. If `useEffect`, `useRef`, `useState` are not in the import at the top, add them.

The current import is:
```ts
import { useEffect, useMemo, useRef, useState } from 'react'
```

This is fine.

- [ ] **Step 3: Update `SeriesListProps` to accept `onUpdateDataType` callback**

Update the `SeriesListProps` interface:

```ts
export interface SeriesListProps {
  records: DBRecord[]
  loading?: boolean
  error?: string | null
  dbPath: string | null
  dbId: string | null
  onDelete: (id: string) => void
  onImportSeries: () => void
  onRowClick?: (id: string) => void
  onUpdateDataType?: (id: string, dataType: DataType, startingValue?: number) => void
}
```

Update the `SeriesList` function signature to destructure `onUpdateDataType`:

```ts
export function SeriesList({ records, loading, error, dbPath, dbId, onDelete, onImportSeries, onRowClick, onUpdateDataType }: SeriesListProps) {
```

- [ ] **Step 4: Add the `DataTypeBadge` column to the table**

In the `<thead>` row, add a header after the Frequency header:

```tsx
              <th className="p-4 font-medium text-muted-foreground text-center">Type</th>
```

In each `<motion.tr>`, add the badge cell after the Frequency cell:

```tsx
                  {/* Data Type */}
                  <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-center">
                      <DataTypeBadge
                        record={r}
                        dbPath={dbPath}
                        onUpdated={(id, dt, sv) => onUpdateDataType?.(id, dt, sv)}
                      />
                    </div>
                  </td>
```

- [ ] **Step 5: Wire `onUpdateDataType` in `DBTab.tsx`**

In `src/renderer/components/tabs/DBTab.tsx`, in the `<SeriesList>` component call (around line 1256), add the callback prop:

```tsx
          <SeriesList
            records={records}
            loading={loading}
            error={fetchError}
            dbPath={dbPath}
            dbId={dbId}
            onDelete={handleDelete}
            onImportSeries={() => setIsImportOpen(true)}
            onRowClick={(id) => { setDataSeriesFilter(id); setActiveInnerTab('data') }}
            onUpdateDataType={(id, dataType) => {
              setRecords(prev => prev.map(r => r.id === id ? { ...r, dataType } : r))
            }}
          />
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ui/series-list.tsx src/renderer/components/tabs/DBTab.tsx
git commit -m "feat: Level/Growth badge in series list with inline popover for editing data type"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Upload detection: `detectDataType` in parse.ts (Task 5)
- [x] DB storage: schema migration + `MemoryDB` (Tasks 2, 3); `data_type` DEFAULT 'growth' for backward compat
- [x] Growth-rate conversion at parse time: `toGrowthRates` (Task 5)
- [x] `originalPoints` save bug fix: `ipc.ts` saves `originalPoints` (Task 7)
- [x] `startingValue` on series table: schema + MemoryDB (Tasks 2, 3)
- [x] `dataType`/`startingValue` threaded through IPC, preload, renderer IPC layer (Tasks 4, 7)
- [x] Graph store auto-set `transform = 'cumulative'` for Level series (Task 8)
- [x] `applyLevelIndex` absolute and normalised modes (Task 9)
- [x] `reconstructLevels` and `toLevelIndex` pure functions (Task 6)
- [x] `displaySeries` updated to route Level series through `applyLevelIndex` (Task 9)
- [x] `hasCumulative` already covers Level series (transform === 'cumulative') — no change needed
- [x] `resolvedBaseDate` already covers Level series — no change needed
- [x] `confirmRebase` already covers Level series — no change needed
- [x] "Cumulative" → "Index" UI rename (Task 10)
- [x] SeriesReviewPanel `dataType` dropdown (Task 11)
- [x] DBTab Level/Growth badge + inline edit (Task 12)
- [x] `updateSeriesMeta` IPC (Tasks 3, 4, 7)
- [x] Session restore: `deserializeSeries` uses `...s` so `dataType`/`startingValue` come through automatically

**Type consistency check:**
- `DataType = 'level' | 'growth'` defined in types.ts, used consistently across all tasks
- `SavePayload.dataType?` and `SavePayload.startingValue?` match `MemoryDB.saveSeries` parameter
- `SeriesMetaPatch.dataType: DataType` used in `updateSeriesMeta` — matches handlers.ts `SeriesMetaPatch`
- `reconstructLevels(originalPoints, startingValue)` signature consistent between transforms.ts (Task 6) and GraphTab usage (Task 9)
- `applyLevelIndex` uses `DataSeries[]` → `DataSeries[]` — consistent with `applyCumulativeReturns` signature

**No placeholders:** All code blocks are complete.

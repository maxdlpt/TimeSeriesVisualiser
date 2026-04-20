# Data Type Labels (Level / Growth) — Design Spec

**Date:** 2026-04-20  
**Status:** Approved  
**Scope:** Upload detection, DB storage, graph display, UI labelling

---

## Overview

Every series in TSV is assigned a `data_type` — either `'level'` (prices, indices, exchange rates) or `'growth'` (period-over-period returns, ratios). This label:

1. Controls how the series is stored in the DB (Level series are converted to growth rates at ingest; Growth series are stored as-is).
2. Controls the default display transform when a Level series is added to the graph.
3. Is shown and editable in the DB tab and the upload review panel.
4. Motivates renaming the "Cumulative" transform to **"Index"** throughout the UI.

---

## Storage Mechanism

```
data_type = 'growth'
  → series_data stores raw growth values unchanged
  → starting_value = NULL in series table

data_type = 'level'
  → series_data stores GROWTH RATE values (converted at parse time)
  → starting_value = original first price, stored in series table
```

Both `'level'` and `'growth'` series end up with growth rates in `series_data`. The `data_type` flag and `starting_value` on the series row are the only differences.

### DB Schema changes (`src/main/db/schema.ts`)

Two new columns added to the `series` table via idempotent `ALTER TABLE … ADD COLUMN` (wrapped in try/catch to swallow "duplicate column" errors on re-run):

```sql
ALTER TABLE series ADD COLUMN data_type     TEXT NOT NULL DEFAULT 'growth';
ALTER TABLE series ADD COLUMN starting_value REAL;
```

`starting_value` is NULL for Growth series. No change to `series_points`.

---

## Parse-Time Detection & Conversion (`src/renderer/lib/parse.ts`)

### `detectDataType(points: DataPoint[]): DataType`

Multi-signal heuristic applied to the raw uploaded values:

```
negFrac    = count(value < 0) / N
medianAbs  = median(|values|)

if negFrac > 0.15                          → 'growth'   (returns alternate sign frequently)
if negFrac < 0.05 AND medianAbs > 20       → 'level'    (nearly all positive, large magnitude)
else                                       → 'growth'   (safe default)
```

The threshold `medianAbs > 20` cleanly separates level series (prices/indices: 50–50 000+) from high-volatility annual return series (rarely exceed ±20%). Daily/monthly return series almost always fail the `negFrac < 0.05` gate regardless of magnitude.

### `toGrowthRates(points: DataPoint[]): { growthPoints: DataPoint[]; startingValue: number }`

Converts N level data points into N growth rate points:

```
growthPoints[0]  = { date: d₀, value: 0 }                               // sentinel — no prior period
growthPoints[i]  = { date: dᵢ, value: ((valᵢ - valᵢ₋₁) / |valᵢ₋₁|) × 100 }  // % change
startingValue    = points[0].value                                        // original first price
```

`Math.abs(valᵢ₋₁)` in the denominator mirrors `toPctChange` — handles negative prices correctly.

### Integration in `parseCSVText` / `parseExcelBuffer`

After building `points` for each column:
1. Call `detectDataType(points)`.
2. If `'level'`: call `toGrowthRates(points)` → replace `points` and `originalPoints` with `growthPoints`; attach `startingValue`.
3. Set `dataType` on the returned `DataSeries`.

`parseExcelBuffer` delegates to `parseCSVText` after building a CSV string, so Level detection is inherited automatically.

---

## Type System Changes (`src/shared/types.ts`)

```ts
export type DataType = 'level' | 'growth'
```

### `DataSeries` gains:
```ts
dataType?:      DataType   // undefined treated as 'growth' for backward compat
startingValue?: number     // only present when dataType === 'level'
```

### `RawSeries` (IPC wire format) gains:
```ts
dataType?:      DataType
startingValue?: number
```

### `SessionSeries` gains:
```ts
dataType?:      DataType
startingValue?: number
```

### `DBRecord` gains:
```ts
dataType?: DataType   // populated by listSeries() so DBTab can display it without loading points
```

`SeriesTransform` stays `'returns' | 'cumulative' | 'drawdown'` internally. The "Cumulative" → "Index" change is a **UI label rename only** — no code value changes.

---

## IPC Layer (`src/renderer/lib/ipc.ts`)

### `rawToDataSeries`
Pass through `dataType` and `startingValue` from the raw payload into the returned `DataSeries`.

### `serializeSeries` / `deserializeSeries`
Include `dataType` and `startingValue` in the serialised `SessionSeries`.

### `ipc.memory.saveSeries` and `ipc.external.saveSeries`
**Breaking change from current behaviour:** currently saves `s.points` (current display values). This is wrong — it would persist transformed/reconstructed values rather than the canonical raw form.

**New behaviour:** save `s.originalPoints` for all series. `originalPoints` is always the canonical storage form (growth rates for Level, raw returns for Growth). Also include `dataType` and `startingValue` in the payload.

---

## Main Process DB Layer

### `src/main/db/memory.ts`
- `SavePayload` interface gains `dataType?` and `startingValue?`.
- `listSeries()`: SELECT includes `data_type` → populates `DBRecord.dataType`.
- `getSeries()`: SELECT includes `data_type` and `starting_value`.
- `saveSeries()`: INSERT OR REPLACE includes `data_type` and `starting_value`.

### `src/main/db/external.ts`
Same pattern — `getSeries` and write path updated identically.

### `src/main/ipc/handlers.ts`
External save/delete handlers already pass through the full payload; add `dataType` and `startingValue` to the passed objects.

---

## Display Mechanism (`src/renderer/components/tabs/GraphTab.tsx`)

### `displaySeries` useMemo — updated pipeline

```
For each series in activeSeries:
  transform = s.transform ?? 'returns'

  'returns'   → no change (existing behavior for both data types)
  'drawdown'  → no change (existing applyDrawdown; compounds growth rates → works for both types)
  'cumulative' →
    if s.dataType !== 'level':  existing applyCumulativeReturns (no change)
    if s.dataType === 'level':  new applyLevelIndex path (see below)
```

### `applyLevelIndex` — new function

Called with all Level series that have `transform === 'cumulative'`.

**Step 1 — Reconstruct absolute levels for each series:**
```
val₀ = startingValue
valᵢ = (1 + growthRateᵢ / 100) × valᵢ₋₁
```
This gives N level values at the original N dates.

**Step 2 — Decide display mode:**
```
levelSeriesInIndexMode = activeSeries.filter(s => s.dataType === 'level' && s.transform === 'cumulative')
isAlone = levelSeriesInIndexMode.length === 1
```

**Step 3 — Apply display:**
- `isAlone === true` → **Absolute**: `points = reconstructedLevels` (shows original prices)
- `isAlone === false` → **Normalised**: find earliest common date across all Level index series (= max of each series' first date). If `cumBaseInput` is set on the series, snap to that date instead. Normalise: `val_t / val_base × 100`.

Moving averages are recomputed from the final `points` in both branches (existing MA recompute pattern).

### Two new pure functions (`src/renderer/lib/transforms.ts`)

```ts
reconstructLevels(originalPoints: DataPoint[], startingValue: number): DataPoint[]
toLevelIndex(levels: DataPoint[], baseDateMs: number): DataPoint[]
```

### `confirmRebase` (right-click context menu)
No change needed — right-click already sets `cumBaseInput` on all cumulative series. Level index series also have `cumBaseInput`, so the right-click rebase works for them automatically.

### `resolvedBaseDate`
Currently uses the first cumulative series' `cumBaseInput`. Extend to also work for Level series in index mode (they use the same `cumBaseInput` field).

### Axis assignment
Level series in Index mode behave like cumulative Growth series for axis purposes:
- Level-index → left axis (same as existing `hasCumulative` logic)
- Extend `hasCumulative` check to include: `s.dataType === 'level' && s.transform === 'cumulative'`

### UI label rename
All occurrences of "Cumulative" in GraphTab (button labels, axis labels, comments) → **"Index"**.

---

## Graph Store (`src/renderer/store/graph.ts`)

### `addSeries` — auto-set transform for Level series

```ts
addSeries: (s) => set((state) => {
  if (state.activeSeries.find(x => x.id === s.id)) return state

  let incoming = s
  if (s.dataType === 'level') {
    // Auto-select Index mode — absolute if first Level series, normalised if others present
    incoming = { ...s, transform: 'cumulative' }
    // The isAlone check at render time handles absolute vs normalised automatically
  }

  return { activeSeries: [...state.activeSeries, incoming] }
})
```

The `isAlone` branching happens at render time in `applyLevelIndex`, so `addSeries` only needs to set `transform = 'cumulative'`. No explicit `levelDisplayMode` field required.

---

## Upload Review Panel (`src/renderer/components/upload/SeriesReviewPanel.tsx`)

### Changes
- `Draft` interface gains `dataType: DataType`.
- Initialised from `s.dataType` (auto-detected).
- New "Data Type" field added to the 2×2 grid (making it 2×3, or adding a fifth field below):

```
<select> with two options:
  <option value="level">Level</option>   title="Prices, indices, and exchange rates.
                                               Stored internally as period growth rates
                                               with a starting value. Displayed as an
                                               index by default."
  <option value="growth">Growth</option> title="Period-over-period changes or returns.
                                               Stored as-is."
```

HTML `title` attributes provide the hover tooltip. No extra tooltip library needed.

- `getAll()` applies the `dataType` draft field to the returned series.

---

## DB Tab (`src/renderer/components/tabs/DBTab.tsx`)

### Series list
Each series row shows a small badge: `Level` or `Growth` (defaults to `Growth` when `dataType` is undefined for legacy rows). Badge styled as a pill — `bg-blue-100 text-blue-700` for Level, `bg-slate-100 text-slate-500` for Growth.

### Editing `data_type` and `starting_value`
The badge is clickable — opens an inline popover with:
- A `<select>` for `data_type` (Level / Growth)
- A number input for `starting_value` (only shown / required when `data_type = 'level'`)

On confirm: since **both Level and Growth series store growth rates in `series_data`**, changing `data_type` only updates the metadata in the `series` row — no point data reconversion is required. A new IPC handler `memory:update-series-meta` (and `external:update-series-meta`) updates `data_type` and `starting_value` on the series row without touching `series_points`.

If the user changes from Level to Growth: `starting_value` is set to NULL. The growth rate points remain unchanged.
If the user changes from Growth to Level: they must supply a `starting_value`. The existing growth rate points are now interpreted as Level growth rates.

---

## "Cumulative" → "Index" Rename Map

| Location | Old text | New text |
|---|---|---|
| `SeriesEditPanel.tsx` Calculations tab button | "Cumulative" | "Index" |
| `SeriesEditPanel.tsx` sub-options header | "Cumulative sub-options" | "Index sub-options" |
| `GraphTab.tsx` axis/badge labels | "cumulative" / "Cumulative" | "index" / "Index" |
| `GraphTab.tsx` `leftAxisMode` value | `'index'` (already uses this) | no change |
| Session comments and `graphStateKey` | any human-readable "cumulative" | "index" |

`SeriesTransform` type value `'cumulative'` is **not** renamed (backward compat with stored sessions).

---

## File Change Map

| File | Change type |
|---|---|
| `src/shared/types.ts` | Add `DataType`; extend `DataSeries`, `RawSeries`, `SessionSeries`, `DBRecord` |
| `src/main/db/schema.ts` | Add two `ALTER TABLE` columns with try/catch guards |
| `src/main/db/memory.ts` | `SavePayload`, `listSeries`, `getSeries`, `saveSeries` |
| `src/main/db/external.ts` | `getSeries` and write methods |
| `src/main/ipc/handlers.ts` | Pass `dataType` + `startingValue` through external save/delete |
| `src/renderer/lib/parse.ts` | Add `detectDataType`, `toGrowthRates`; apply in `parseCSVText` |
| `src/renderer/lib/ipc.ts` | `rawToDataSeries`, `serializeSeries`, `deserializeSeries`; save `originalPoints` |
| `src/renderer/lib/transforms.ts` | Add `reconstructLevels`, `toLevelIndex` |
| `src/renderer/store/graph.ts` | `addSeries` auto-sets `transform = 'cumulative'` for Level series |
| `src/renderer/components/tabs/GraphTab.tsx` | `displaySeries` Level index path; UI label renames |
| `src/renderer/components/graph/SeriesEditPanel.tsx` | "Cumulative" → "Index" label rename |
| `src/renderer/components/upload/SeriesReviewPanel.tsx` | `dataType` field in Draft + dropdown UI |
| `src/renderer/components/tabs/DBTab.tsx` | `dataType` badge display + inline edit + new IPC call |
| `src/main/ipc/handlers.ts` | New `memory:update-series-meta` and `external:update-series-meta` handlers |
| `src/shared/ipc-channels.ts` | Two new channel constants |
| `src/preload/index.ts` + `index.d.ts` | Expose new `updateSeriesMeta` methods on `window.tsv` |

---

## Invariants & Edge Cases

1. **Backward compat:** All existing series in the DB have no `data_type` column value → SQLite `DEFAULT 'growth'` fills it as `'growth'`. They display as before. No migration needed.

2. **`originalPoints` is canonical.** The save path always writes `originalPoints` (growth rates). The display path may produce transformed `points`, but those are ephemeral — never persisted.

3. **`isAlone` is a render-time computation.** No explicit "absolute vs normalised" field on `DataSeries`. The `applyLevelIndex` function counts Level-index series at render time and chooses the appropriate display automatically. This means adding a second Level series to the graph automatically switches all Level series from absolute → normalised.

4. **`cumBaseInput` doubles as the index base date.** Right-click rebase on the chart sets `cumBaseInput` on all cumulative-mode series (both Growth and Level). No new state field needed.

5. **Growth series in Index mode:** unchanged — `applyCumulativeReturns` is called as before. `data_type = 'growth'` series are never routed through `applyLevelIndex`.

6. **Session restore:** `deserializeSeries` passes through `dataType` and `startingValue`. Level series restored with `transform = 'cumulative'` will correctly enter the `applyLevelIndex` path. No special restore logic.

7. **`detectDataType` is heuristic.** The upload review dropdown lets the user override the auto-detection before the series reaches the store.

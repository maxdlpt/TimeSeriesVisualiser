# TimeSeriesVisualiser — CLAUDE.md

Electron desktop app for visualising, uploading, and sharing time-series data. FRED-inspired charting with SQLite storage. Built by Maximilien Delaporte.

---

## Quick-start commands

```bash
npm run dev          # start Electron + Vite dev server (opens DevTools automatically)
npm run typecheck    # tsc check for both main (node) and renderer (web) tsconfigs
npm run test         # vitest run (single pass)
npm run test:watch   # vitest watch mode
npm run build        # typecheck + electron-vite build → out/
npm run build:win    # package for Windows via electron-builder
npm run rebuild      # electron-rebuild for better-sqlite3 (run after any Node version change)
```

---

## Tech stack

| Layer | Library | Version |
|---|---|---|
| Desktop shell | Electron | 33 |
| Build | electron-vite + Vite | 2.x / 5.x |
| UI framework | React | 18 (NOT 19 — peer-dep constraints with @ark-ui, @visx, framer-motion) |
| Language | TypeScript | 5 |
| SQLite | better-sqlite3 | 12 |
| State | Zustand | 5 |
| Chart | @visx/shape, @visx/scale, @visx/grid, @visx/curve | 3.x |
| Styling | Tailwind CSS v4 + shadcn/ui (slate palette) | 4.x |
| Animation | motion/react (framer-motion v12) | 12 |
| UI primitives | @ark-ui/react, lucide-react, @ant-design/icons | - |
| CSV/Excel | papaparse, xlsx | - |
| Tests | Vitest + @testing-library/react | 4.x |
| Packaging | electron-builder | 26 |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process                              │
│  src/main/index.ts → ipc/handlers.ts               │
│  All SQLite access here. Never in the renderer.     │
│  DB path: app.getPath('userData')/memory.db         │
└─────────────────┬───────────────────────────────────┘
                  │ ipcMain.handle / ipcRenderer.invoke
┌─────────────────┴───────────────────────────────────┐
│  Preload Bridge                                     │
│  src/preload/index.ts                               │
│  contextBridge.exposeInMainWorld('tsv', {...})       │
│  Exposes: window.tsv.memory / external / settings / dialog │
└─────────────────┬───────────────────────────────────┘
                  │ window.tsv.*
┌─────────────────┴───────────────────────────────────┐
│  React Renderer  src/renderer/                      │
│  lib/ipc.ts  ← typed wrappers, also does RawSeries  │
│              → DataSeries conversion here           │
│  store/{app,graph,db}.ts  ← Zustand stores          │
│  App.tsx  ← tab router: graph | upload | settings   │
└─────────────────────────────────────────────────────┘
```

### Key architectural rules

1. **SQLite only lives in Main.** `better-sqlite3` cannot run in the renderer. The handlers.ts file is the single entry point for all DB operations; do not add DB logic anywhere else.

2. **IPC boundary uses `RawSeries`, not `DataSeries`.** `DataSeries` has `Date` objects, `source`, `dbId`, and `color` — none of which survive `structuredClone`. The wire type `RawSeries` uses ISO date strings only. Conversion happens in `src/renderer/lib/ipc.ts:rawToDataSeries()`.

3. **`ipc.ts` is the only place that calls `window.tsv.*`.** Components call `ipc.memory.*`, `ipc.external.*`, etc. Never call `window.tsv.*` directly in components.

4. **`registerHandlers()` is called after `app.whenReady()`.** This is intentional — `app.getPath('userData')` is only valid after ready. Do not move or inline the handler registration.

---

## Path aliases

Both `@/` and `@renderer/` resolve to `src/renderer/`. Configured in:
- `electron.vite.config.ts` (renderer build)
- `vitest.config.ts` (tests)
- `tsconfig.web.json` (type-checking)

Use `@/` or `@renderer/` for all renderer-internal imports.

---

## Zustand stores

### `useAppStore` — `src/renderer/store/app.ts`
- `activeTab`: `'graph' | 'upload' | 'settings'`
- `theme`, `colorPalette`: mirrors `AppSettings` in `shared/types.ts`
- `settingsHydrated` (**critical**): ephemeral flag, never persisted. Set to `true` by `useHydrateSettings` after pushing saved settings into stores. `useStartupDBCheck` gates on this flag — without it the startup DB probe would read the empty initial store (no external DBs yet) and silently no-op on first boot. **Do not read `settingsHydrated` from `getState()`** — use the Zustand hook so effects re-fire when the flag flips.

### `useGraphStore` — `src/renderer/store/graph.ts`
- `activeSeries: DataSeries[]` — what's on the chart
- `zoomDomain: { start, end } | null` — current time window (null = full range)
- `rightPanel: 'operations' | 'addLine' | null` — which slide-in panel is open
- `addSeries` deduplicates by id (no-op if already present)

### `useDBStore` — `src/renderer/store/db.ts`
- `externalDBs: ExternalDB[]` — registered external `.db` files
- Hydrated by `useHydrateSettings` from `ipc.settings.get()` on boot

---

## Startup hydration sequence

```
App mounts
  → useHydrateSettings() runs (useEffect, [])
      → ipc.settings.get() (async IPC)
      → pushes theme/colorPalette → useAppStore
      → pushes externalDBs → useDBStore
      → setSettingsHydrated() [LAST]
  → useStartupDBCheck() subscribes to settingsHydrated
      → early-return while settingsHydrated === false
      → on true: probes each externalDB.path via ipc.external.checkPath
      → updateReachability() per probe
      → saves settings if any reachable flag changed
```

Unreachable DBs are **kept** in the list (not rejected). `AddLinePanel` filters the source dropdown to `reachable === true`. This "add-with-false + self-heal" model means a network share being briefly offline doesn't lose the user's config.

---

## Data model

### `DataSeries` (renderer, `src/shared/types.ts`)
```ts
{
  id: string            // crypto.randomUUID()
  name: string          // display name (from column header)
  code: string          // UPPER_SNAKE_CASE, UNIQUE in schema
  description: string
  data_freq?: DataFreq  // 'daily' | 'monthly' | 'quarterly' | 'yearly'
  points: DataPoint[]   // CURRENT display values (may be transformed)
  originalPoints: DataPoint[]  // IMMUTABLE raw values — transforms always read from here
  source: 'memory' | 'external'
  dbId?: string         // only when source === 'external'
  color?: string
  visible?: boolean     // true when undefined
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  lineWidth?: number    // defaults to 2
}
```

**`originalPoints` invariant:** transforms in `OperationsPanel` always apply to `originalPoints`, never to `points`. This prevents compounding (e.g. pct-change of already-normalised values). "Reset to Raw" restores `originalPoints` as the new `points`.

### Frequency detection (`src/renderer/lib/freq.ts`)
Uses **median consecutive gap** (not mean) — robust against data series with large gaps. Thresholds: ≤10 days = daily, ≤45 = monthly, ≤150 = quarterly, else yearly.

### Date parsing (`src/renderer/lib/parse.ts`)
DD/MM vs MM/DD ambiguity is resolved at the **column level** (not row-by-row). Detection order:
1. Any first component > 12 → DD/MM
2. Any second component > 12 → MM/DD
3. Fully ambiguous → compare median consecutive gap of each interpretation, choose the larger

---

## Upload flow

```
UploadTab (mode: 'file' | 'paste')
  → FileDropZone or PasteTable parse to DataSeries[]
  → stored in local pendingSeries state (NOT pushed to graph store yet)
  → colors assigned at buffer-in time using getColor(palette, activeSeriesCount + i)
  → SeriesReviewPanel: user can edit name/code/description/freq
  → "Add to Graph": batch-adds to graphStore, navigates to graph tab, clears buffer
```

Why the buffer? Re-parsing on every PasteTable keystroke must not flood the graph store. The "Back" button cleanly discards without side effects.

**Known TODO:** cross-upload code collisions. Two separate uploads each with a "Price" column both produce `code: 'PRICE'` and will collide on the schema's UNIQUE constraint. The save layer needs to detect existing codes and prompt to rename/overwrite/auto-suffix.

---

## Chart rendering (`src/renderer/components/ui/area-chart.tsx`)

- Built on `@visx/shape`, `@visx/scale`, `@visx/grid` — raw SVG, no recharts
- Multiple series are **pivoted** into `{ date: Date, [code]: value | null }[]` rows before being passed in. Null values produce visible gaps (honest for financial data)
- Zoom: scroll-wheel (vertical = zoom, horizontal = pan, Ctrl+scroll = widen chart width). Uses rAF batching — burst wheel events collapse to one update per frame
- Drag-select zoom: click-drag on chart surface selects a time range
- Double-click: resets zoom to full range
- Series are capped at `MAX_DISPLAY_POINTS = 1000` for render perf (downsampled by stride)
- `key={animKey}` on `AreaChart` — bumped when navigating back to graph tab or adding a new series, replaying the draw animation

---

## Operations / transforms (`src/renderer/lib/transforms.ts`)

Three transforms, all applied to `originalPoints`:
- `toCumReturn`: `((value - base) / base) * 100` (relative to first point)
- `toNormalized`: `(value / base) * 100` (index to 100)
- `toPctChange`: period-over-period percentage change

`OperationsPanel` applies the selected transform to **all** active series simultaneously.

---

## SQLite schema (`src/main/db/schema.ts`)

```sql
series       (id TEXT PK, name, code UNIQUE, description, created_at)
series_points(series_id FK→series, date TEXT, value REAL, PK(series_id, date))
settings     (key TEXT PK, value TEXT)  -- single row: key='app', value=JSON AppSettings
```

Foreign keys ON + CASCADE DELETE. `initSchema` is idempotent (`CREATE TABLE IF NOT EXISTS`). Called once on startup and again when exporting to a new `.db` file.

External `.db` files must have the same schema. `ExternalDBReader` (`src/main/db/external.ts`) opens them read-only. `TsvSchemaError` is thrown if required tables are missing — its `.code` and `.missingTables` fields propagate to the renderer via the IPC error message.

---

## Styling conventions

- **Tailwind v4** with `@tailwindcss/vite` plugin — no `tailwind.config.js`, config is inline in `globals.css`
- **Dark mode**: class-based (`.dark` on `<html>`). `lib/theme.ts:applyTheme()` adds/removes it. `globals.css` uses `@custom-variant dark (&:where(.dark, .dark *))` — standard Tailwind v4 pattern
- **shadcn design tokens**: CSS custom properties on `:root` and `.dark`. Use `bg-background`, `text-foreground`, `border-border`, etc. — never hardcode colours for themeable surfaces
- **Panel animations**: right-side panels slide in with `motion` spring (`stiffness: 300, damping: 30`, `x: '100%' → 0`). `AnimatePresence` wraps them in `GraphTab`

---

## Testing

- Vitest with jsdom environment for renderer tests, node environment for main/shared
- Test files: `src/**/__tests__/**/*.test.{ts,tsx}`
- Setup file: `src/test/setup.ts` (jest-dom matchers)
- `window.tsv` is mocked in renderer tests — `better-sqlite3` is not available in jsdom
- Do NOT mock SQLite in main-process tests (`src/main/db/__tests__/`) — those run against a real in-memory DB. This was a deliberate choice to catch schema/migration issues.

---

## Known deferred work

- **Task 15: CSV Export** — deferred indefinitely. The `DIALOG_EXPORT_SERIES` IPC channel is defined in `ipc-channels.ts` but has no handler registered and no UI wired.
- **Moving averages** in `SeriesEditPanel` → Calculations tab: toggles are rendered but `aria-disabled="true"`, non-functional placeholder only.
- **Cross-upload code collision** in the save flow (see Upload flow section above).
- **`electron-builder.yml`** exists but build has not been end-to-end tested.

---

## File map (actual, post-implementation)

```
src/
  main/
    index.ts                   Electron entry, BrowserWindow, registerHandlers
    db/
      schema.ts                initSchema() — CREATE TABLE IF NOT EXISTS
      memory.ts                MemoryDB class — CRUD for internal DB
      external.ts              ExternalDBReader + checkPathReachable
    ipc/
      handlers.ts              All ipcMain.handle() registrations (single file)
  preload/
    index.ts                   contextBridge → window.tsv
    index.d.ts                 TypeScript declaration for window.tsv
  renderer/
    main.tsx                   ReactDOM.createRoot
    App.tsx                    Tab router + useHydrateSettings + useStartupDBCheck
    store/
      app.ts                   activeTab, theme, colorPalette, settingsHydrated
      graph.ts                 activeSeries, zoomDomain, rightPanel
      db.ts                    externalDBs registry
    components/
      layout/
        AppLayout.tsx          Sidebar + <main>
      tabs/
        GraphTab.tsx           Chart canvas, zoom, legend, panel orchestration
        UploadTab.tsx          File/Paste toggle, pendingSeries buffer, SeriesReviewPanel
        SettingsTab.tsx        Theme, palette, external DB management
      graph/
        AddLinePanel.tsx       Right panel: source dropdown + accordion series list
        OperationsPanel.tsx    Right panel: transform buttons + SaveMenu
        SeriesEditPanel.tsx    Inline panel: colour/line style/weight, calculations tab
        SaveMenu.tsx           Save-to-memory / export-to-.db buttons
      upload/
        FileDropZone.tsx       Drag-drop + browse for CSV/Excel
        PasteTable.tsx         Editable paste table
        SeriesReviewPanel.tsx  Review/edit parsed series before committing
      ui/
        area-chart.tsx         @visx AreaChart (Area, XAxis, YAxis, Grid, Crosshair, etc.)
        sidebar.tsx            Collapsible nav sidebar
        segment-group.tsx      @ark-ui SegmentGroup (Selector component)
        animated-dropdown.tsx  Framer-motion dropdown
        interactive-series-table.tsx  Accordion table
        spotlight-table.tsx    Spotlight search table
        button.tsx / input.tsx / badge.tsx  shadcn primitives
    hooks/
      useHydrateSettings.ts    Boot: load persisted settings → push to stores → set flag
      useStartupDBCheck.ts     Boot (gated on settingsHydrated): probe external DB paths
    lib/
      ipc.ts                   Typed wrappers for window.tsv + RawSeries→DataSeries
      colors.ts                PALETTES map (default/pastel/muted/mono) + getColor()
      transforms.ts            toCumReturn, toNormalized, toPctChange
      parse.ts                 parseCSVText, parseExcelBuffer (DD/MM vs MM/DD detection)
      freq.ts                  detectFrequency, inferFreqFromRecord, formatFreq
      theme.ts                 applyTheme() — toggles .dark on <html>
      utils.ts                 cn() (clsx + tailwind-merge)
    styles/
      globals.css              Tailwind v4 import + shadcn tokens
  shared/
    types.ts                   DataSeries, DataPoint, RawSeries, DBRecord, ExternalDB, AppSettings, DataFreq
    ipc-channels.ts            IPC enum constants
  test/
    setup.ts                   Vitest setup (jest-dom)
docs/
  superpowers/plans/
    2026-04-14-time-series-visualiser.md   Original implementation plan (Tasks 1–15)
  team-lead-fd-substitute.md   Team-lead / FD-substitute process doc
  team-lead-fd-substitute-log.md  Log of past consultations with that process
```

---

## Plan document

The full implementation plan lives at `docs/superpowers/plans/2026-04-14-time-series-visualiser.md`. Tasks 1–14 are substantially complete. Task 15 (CSV Export) is deferred. Divergences from the plan are annotated inline in the plan file.

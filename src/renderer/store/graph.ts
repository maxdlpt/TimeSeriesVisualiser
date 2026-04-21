import { create } from 'zustand'
import type { DataSeries, SeriesTransform, CumMethod } from '../../shared/types'

interface ZoomDomain {
  start: Date
  end: Date
}

type RightPanel = 'operations' | 'addLine' | null

interface GraphState {
  activeSeries: DataSeries[]
  zoomDomain: ZoomDomain | null
  rightPanel: RightPanel
  showGrid: boolean
  graphTitle: string
  savedFilename: string | null
  addSeries: (s: DataSeries) => void
  removeSeries: (id: string) => void
  updateSeries: (id: string, patch: Partial<DataSeries>) => void
  reorderSeries: (newOrder: DataSeries[]) => void
  toggleSeriesVisibility: (id: string) => void
  setZoomDomain: (domain: ZoomDomain | null) => void
  setRightPanel: (panel: RightPanel) => void
  setShowGrid: (show: boolean) => void
  setGraphTitle: (title: string) => void
  setSavedFilename: (filename: string | null) => void
  resetGraph: () => void
  /** Bulk-set transform for all series at once (convenience for "Set All To..." action). */
  setAllTransforms: (transform: SeriesTransform, cumMethod?: CumMethod, cumBaseInput?: string) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  activeSeries: [],
  zoomDomain: null,
  rightPanel: null,
  showGrid: true,
  graphTitle: 'New Graph',
  savedFilename: null,
  addSeries: (s) => set((state) => {
    if (state.activeSeries.find(x => x.id === s.id)) return {}
    // Auto-select cumulative ("Index") mode for level series that haven't had
    // a transform explicitly chosen yet (freshly uploaded or loaded from DB).
    // Session-restored series carry their last transform in the JSON, so we
    // must not override when transform is already set.
    const entry = s.dataType === 'level' && s.transform == null
      ? { ...s, transform: 'cumulative' as const }
      : s
    return { activeSeries: [...state.activeSeries, entry] }
  }),
  removeSeries: (id) => set((state) => ({
    activeSeries: state.activeSeries.filter(s => s.id !== id)
  })),
  updateSeries: (id, patch) => set((state) => ({
    activeSeries: state.activeSeries.map(s => s.id === id ? { ...s, ...patch } : s)
  })),
  reorderSeries: (newOrder) => set({ activeSeries: newOrder }),
  toggleSeriesVisibility: (id) => set((state) => ({
    activeSeries: state.activeSeries.map(s => {
      if (s.id !== id) return s
      const nowVisible = !(s.visible ?? true)
      return {
        ...s,
        visible: nowVisible,
        movingAverages: nowVisible
          ? (s.movingAverages ?? []).map(ma =>
              ma.hiddenWithParent ? { ...ma, visible: true, hiddenWithParent: undefined } : ma
            )
          : (s.movingAverages ?? []).map(ma =>
              ma.visible !== false ? { ...ma, visible: false, hiddenWithParent: true } : ma
            ),
      }
    }),
  })),
  setZoomDomain: (domain) => set({ zoomDomain: domain }),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  setShowGrid: (show) => set({ showGrid: show }),
  setGraphTitle: (title) => set({ graphTitle: title }),
  setSavedFilename: (filename) => set({ savedFilename: filename }),
  resetGraph: () => set({
    activeSeries: [],
    zoomDomain: null,
    rightPanel: null,
    showGrid: true,
    graphTitle: 'New Graph',
    savedFilename: null,
  }),
  setAllTransforms: (transform, cumMethod, cumBaseInput) => set((state) => ({
    activeSeries: state.activeSeries.map(s => ({
      ...s,
      transform,
      cumMethod: cumMethod ?? s.cumMethod,
      cumBaseInput: cumBaseInput ?? s.cumBaseInput,
    })),
  })),
}))

import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app'
import { useGraphStore } from '../store/graph'
import { ipc, deserializeSeries } from '../lib/ipc'

/**
 * On first mount after settings hydration, load the last saved graph session
 * and push it into the graph store.
 *
 * Gated on `settingsHydrated` for the same reason as `useStartupDBCheck`:
 * we must not restore a session before the settings (including external-DB
 * reachability) have been applied, because series from external sources need
 * the DB registry to be correct.
 *
 * The `hasRestored` ref prevents a double-fire: React 18 Strict Mode mounts
 * effects twice in development, and `settingsHydrated` flipping from false →
 * true would otherwise trigger two restores.
 */
export function useRestoreSession(): void {
  const settingsHydrated = useAppStore((s) => s.settingsHydrated)
  const hasRestoredRef   = useRef(false)

  useEffect(() => {
    if (!settingsHydrated) return
    if (hasRestoredRef.current) return
    hasRestoredRef.current = true

    ipc.session
      .get()
      .then((session) => {
        if (!session || session.series.length === 0) return
        const { addSeries, setZoomDomain, setChartMode, setCumMethod, setCumBaseInput, setShowGrid, setGraphTitle } = useGraphStore.getState()
        for (const s of session.series) {
          addSeries(deserializeSeries(s))
        }
        if (session.zoomDomain) {
          setZoomDomain({
            start: new Date(session.zoomDomain.start),
            end:   new Date(session.zoomDomain.end),
          })
        }
        if (session.chartMode)            setChartMode(session.chartMode)
        if (session.cumMethod)            setCumMethod(session.cumMethod)
        if (session.cumBaseInput)         setCumBaseInput(session.cumBaseInput)
        if (session.showGrid !== undefined) setShowGrid(session.showGrid)
        if (session.graphTitle)           setGraphTitle(session.graphTitle)
      })
      .catch(() => {})
  }, [settingsHydrated])
}

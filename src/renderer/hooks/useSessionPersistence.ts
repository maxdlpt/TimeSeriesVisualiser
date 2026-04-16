import { useEffect, useRef } from 'react'
import { useGraphStore } from '../store/graph'
import { ipc, serializeSeries } from '../lib/ipc'

const DEBOUNCE_MS = 1500

/**
 * Debounced auto-save of the full graph state (series + zoom) to SQLite.
 * Fires 1.5 s after the last change to `activeSeries` or `zoomDomain`, so
 * rapid edits (colour picker, MA toggles) collapse to a single write.
 *
 * Saves are best-effort — IPC failures are silently swallowed so they never
 * surface as errors in normal usage.
 */
export function useSessionPersistence(): void {
  const activeSeries  = useGraphStore((s) => s.activeSeries)
  const zoomDomain    = useGraphStore((s) => s.zoomDomain)
  const chartMode     = useGraphStore((s) => s.chartMode)
  const cumMethod     = useGraphStore((s) => s.cumMethod)
  const cumBaseInput  = useGraphStore((s) => s.cumBaseInput)
  const showGrid      = useGraphStore((s) => s.showGrid)
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      ipc.session
        .save({
          series: activeSeries.map(serializeSeries),
          zoomDomain: zoomDomain
            ? { start: zoomDomain.start.toISOString(), end: zoomDomain.end.toISOString() }
            : null,
          chartMode,
          cumMethod,
          cumBaseInput,
          showGrid,
        })
        .catch(() => {})
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [activeSeries, zoomDomain, chartMode, cumMethod, cumBaseInput, showGrid])
}

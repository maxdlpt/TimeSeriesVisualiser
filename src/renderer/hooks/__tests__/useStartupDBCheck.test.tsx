// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStartupDBCheck } from '../useStartupDBCheck'
import { useDBStore } from '../../store/db'
import { useAppStore } from '../../store/app'

// Mock the ipc module so we can drive checkPath + settings.save returns per-test.
vi.mock('../../lib/ipc', () => ({
  ipc: {
    external: { checkPath: vi.fn() },
    settings: { save: vi.fn() },
  },
}))

// Re-import after mock so mocks are accessible to assertions.
import { ipc } from '../../lib/ipc'

beforeEach(() => {
  useAppStore.setState({ theme: 'system', colorPalette: 'default' })
  useDBStore.setState({ externalDBs: [] })
  vi.mocked(ipc.external.checkPath).mockReset()
  vi.mocked(ipc.settings.save).mockReset().mockResolvedValue(undefined)
})

describe('useStartupDBCheck', () => {
  it('does nothing when externalDBs is empty', async () => {
    const { unmount } = renderHook(() => useStartupDBCheck())
    // Give any async work a tick to run.
    await new Promise((r) => setTimeout(r, 10))
    expect(ipc.external.checkPath).not.toHaveBeenCalled()
    expect(ipc.settings.save).not.toHaveBeenCalled()
    unmount()
  })

  it('re-probes each external DB and updates reachability per probe result', async () => {
    // Seed store: one DB currently reachable-true that will probe false, one
    // currently reachable-false that will probe true. Exercises both transitions.
    useDBStore.setState({
      externalDBs: [
        { id: 'a', name: 'offline-now', path: 'C:/a.db', reachable: true },
        { id: 'b', name: 'online-now', path: 'C:/b.db', reachable: false },
      ],
    })

    vi.mocked(ipc.external.checkPath).mockImplementation(async (path: string) => {
      if (path === 'C:/a.db') return false
      if (path === 'C:/b.db') return true
      throw new Error(`unexpected path ${path}`)
    })

    renderHook(() => useStartupDBCheck())

    await waitFor(() => {
      const dbs = useDBStore.getState().externalDBs
      expect(dbs.find((d) => d.id === 'a')?.reachable).toBe(false)
      expect(dbs.find((d) => d.id === 'b')?.reachable).toBe(true)
    })

    expect(ipc.external.checkPath).toHaveBeenCalledTimes(2)
    expect(ipc.external.checkPath).toHaveBeenCalledWith('C:/a.db')
    expect(ipc.external.checkPath).toHaveBeenCalledWith('C:/b.db')
  })

  it('persists via settings.save when any reachable value changed', async () => {
    useDBStore.setState({
      externalDBs: [{ id: 'a', name: 'x', path: 'C:/a.db', reachable: true }],
    })
    vi.mocked(ipc.external.checkPath).mockResolvedValue(false)

    renderHook(() => useStartupDBCheck())

    await waitFor(() => {
      expect(ipc.settings.save).toHaveBeenCalledTimes(1)
    })
    // Full AppSettings shape with the post-sweep store state.
    expect(ipc.settings.save).toHaveBeenCalledWith({
      theme: 'system',
      colorPalette: 'default',
      externalDBs: [{ id: 'a', name: 'x', path: 'C:/a.db', reachable: false }],
    })
  })

  it('does NOT call settings.save when no reachable value changed', async () => {
    useDBStore.setState({
      externalDBs: [{ id: 'a', name: 'x', path: 'C:/a.db', reachable: true }],
    })
    // Same reachable as pre-sweep — save-on-change guard should skip the write.
    vi.mocked(ipc.external.checkPath).mockResolvedValue(true)

    renderHook(() => useStartupDBCheck())

    // Let the sweep resolve fully.
    await waitFor(() => {
      expect(ipc.external.checkPath).toHaveBeenCalledTimes(1)
    })
    // Short wait to make sure save isn't called late.
    await new Promise((r) => setTimeout(r, 20))
    expect(ipc.settings.save).not.toHaveBeenCalled()
  })

  it('cancels late-resolving probes on unmount (does not call updateReachability)', async () => {
    useDBStore.setState({
      externalDBs: [{ id: 'a', name: 'x', path: 'C:/a.db', reachable: true }],
    })

    // Deferred resolver so we can unmount before the probe returns.
    let resolveProbe: (v: boolean) => void = () => {}
    vi.mocked(ipc.external.checkPath).mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveProbe = resolve }),
    )

    const { unmount } = renderHook(() => useStartupDBCheck())
    unmount()

    // Now resolve the in-flight probe with a value that WOULD flip reachable.
    resolveProbe(false)
    await new Promise((r) => setTimeout(r, 20))

    // The store must not have been mutated, because the effect was cancelled.
    expect(useDBStore.getState().externalDBs[0].reachable).toBe(true)
    expect(ipc.settings.save).not.toHaveBeenCalled()
  })
})

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePolling } from './usePolling'

describe('usePolling', () => {
  it('挂载立即执行一次并按间隔重复；卸载停止', async () => {
    vi.useFakeTimers()
    try {
      const load = vi.fn()
      const { unmount } = renderHook(() => usePolling(load, 5000))
      expect(load).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(load).toHaveBeenCalledTimes(3)
      unmount()
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(load).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('enabled=false 不启动；restartKey 变化重新执行', async () => {
    vi.useFakeTimers()
    try {
      const load = vi.fn()
      const { rerender } = renderHook(
        ({ enabled, key }) => usePolling(load, 5000, enabled, key),
        { initialProps: { enabled: false, key: 'a' } },
      )
      expect(load).not.toHaveBeenCalled()
      rerender({ enabled: true, key: 'a' })
      expect(load).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(load).toHaveBeenCalledTimes(2)
      // 键切换立即重取，不等下一个周期。
      rerender({ enabled: true, key: 'b' })
      expect(load).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('首次执行携带中止信号，周期调用不携带', async () => {
    vi.useFakeTimers()
    try {
      const load = vi.fn()
      renderHook(() => usePolling(load, 1000))
      expect(load.mock.calls[0][0]).toBeInstanceOf(AbortSignal)
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(load.mock.calls[1][0]).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

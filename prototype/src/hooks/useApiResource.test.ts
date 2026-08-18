import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useApiResource } from './useApiResource'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useApiResource', () => {
  it('落位数据后进入 live', async () => {
    const gate = deferred<{ items: number[] }>()
    const onData = vi.fn()
    const { result } = renderHook(() => useApiResource({ load: () => gate.promise, onData }))
    expect(result.current).toBe('loading')
    await act(async () => { gate.resolve({ items: [1] }) })
    expect(result.current).toBe('live')
    expect(onData).toHaveBeenCalledWith({ items: [1] })
  })

  it('失败进入 unavailable 并执行数据清理', async () => {
    const gate = deferred<never>()
    const onUnavailable = vi.fn()
    const { result } = renderHook(() => useApiResource({
      load: () => gate.promise,
      onData: () => {},
      onUnavailable,
    }))
    await act(async () => { gate.reject(new Error('down')) })
    expect(result.current).toBe('unavailable')
    expect(onUnavailable).toHaveBeenCalledOnce()
  })

  it('超时按不可用处理', async () => {
    vi.useFakeTimers()
    try {
      const gate = deferred<never>()
      const { result } = renderHook(() => useApiResource({
        load: (signal) => new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
          void gate
        }),
        onData: () => {},
        timeoutMs: 100,
      }))
      await act(async () => { await vi.advanceTimersByTimeAsync(150) })
      expect(result.current).toBe('unavailable')
    } finally {
      vi.useRealTimers()
    }
  })

  it('卸载时中止在途请求且不进入 unavailable', async () => {
    const gate = deferred<never>()
    const { result, unmount } = renderHook(() => useApiResource({
      load: () => gate.promise,
      onData: () => {},
    }))
    unmount()
    await act(async () => { gate.reject(new Error('aborted after unmount')) })
    expect(result.current).toBe('loading')
  })
})

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useKeyedResource } from './useKeyedResource'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useKeyedResource', () => {
  it('空键保持 idle 且不载入', () => {
    const load = vi.fn()
    const { result, rerender } = renderHook(
      ({ key }) => useKeyedResource({ key, load, onData: () => {} }),
      { initialProps: { key: null as string | null } },
    )
    expect(result.current).toBe('idle')
    rerender({ key: '' })
    expect(result.current).toBe('idle')
    expect(load).not.toHaveBeenCalled()
  })

  it('键就绪后载入进入 ready，切换键先清理旧数据', async () => {
    const gate = deferred<{ id: string }>()
    const onData = vi.fn()
    const onReset = vi.fn()
    const { result, rerender } = renderHook(
      ({ key }) => useKeyedResource({ key, load: () => gate.promise, onData, onReset }),
      { initialProps: { key: 'a' } },
    )
    expect(result.current).toBe('loading')
    await act(async () => { gate.resolve({ id: 'a' }) })
    expect(result.current).toBe('ready')
    expect(onData).toHaveBeenCalledWith({ id: 'a' })
    expect(onReset).toHaveBeenCalledOnce()

    rerender({ key: 'b' })
    expect(onReset).toHaveBeenCalledTimes(2)
    expect(result.current).toBe('loading')
  })

  it('失败进入 error（不塌页的独立错误态）', async () => {
    const gate = deferred<never>()
    const onError = vi.fn()
    const { result } = renderHook(() => useKeyedResource({
      key: 'a', load: () => gate.promise, onData: () => {}, onError,
    }))
    await act(async () => { gate.reject(new Error('down')) })
    expect(result.current).toBe('error')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('切换键中止旧请求：慢的旧载入不覆盖新键的结果', async () => {
    const first = deferred<{ id: string }>()
    const second = deferred<{ id: string }>()
    const gates: Record<string, ReturnType<typeof deferred<{ id: string }>>> = { a: first, b: second }
    const onData = vi.fn()
    const { result, rerender } = renderHook(
      ({ key }) => useKeyedResource({ key, load: () => gates[key].promise, onData }),
      { initialProps: { key: 'a' } },
    )
    rerender({ key: 'b' })
    await act(async () => { first.resolve({ id: 'stale-a' }) })
    expect(result.current).toBe('loading')
    expect(onData).not.toHaveBeenCalled()
    await act(async () => { second.resolve({ id: 'b' }) })
    expect(result.current).toBe('ready')
    expect(onData).toHaveBeenCalledWith({ id: 'b' })
  })
})

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAction } from './useAction'

describe('useAction', () => {
  it('成功后回到空闲，错误为空', async () => {
    const { result } = renderHook(() => useAction())
    await act(async () => {
      await result.current.run('key-1', '兜底错误', async () => {})
    })
    expect(result.current.pendingKey).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('异常归置为 cause.message', async () => {
    const { result } = renderHook(() => useAction())
    await act(async () => {
      await result.current.run('key-1', '兜底错误', async () => {
        throw new Error('控制面拒绝')
      })
    })
    expect(result.current.error).toBe('控制面拒绝')
    expect(result.current.pendingKey).toBeNull()
  })

  it('非 Error 异常归置为兜底文案', async () => {
    const { result } = renderHook(() => useAction())
    await act(async () => {
      await result.current.run('key-1', '兜底错误', async () => {
        throw 'boom'
      })
    })
    expect(result.current.error).toBe('兜底错误')
  })

  it('在途动作互斥：忙时静默返回且错误通道收到消息', async () => {
    const channel = vi.fn()
    let release!: () => void
    const blocker = new Promise<void>((resolve) => { release = resolve })
    const { result } = renderHook(() => useAction(channel))
    let first: Promise<void> | undefined
    await act(async () => {
      first = result.current.run('a', '失败A', () => blocker)
    })
    const skipped = vi.fn()
    await act(async () => {
      await result.current.run('b', '失败B', skipped)
    })
    expect(skipped).not.toHaveBeenCalled()
    release()
    await act(async () => { await first })
    await act(async () => {
      await result.current.run('c', '失败C', async () => { throw new Error('x') })
    })
    expect(channel).toHaveBeenCalledWith('x', expect.anything())
  })

  it('按调用覆写错误通道（固定文案场景）', async () => {
    const override = vi.fn()
    const { result } = renderHook(() => useAction())
    await act(async () => {
      await result.current.run('a', '兜底', async () => { throw new Error('HTTP 503') }, override)
    })
    expect(override).toHaveBeenCalledWith('HTTP 503', expect.anything())
  })
})

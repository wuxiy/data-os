import { useEffect, useRef, useState } from 'react'

export type KeyedResourceState = 'idle' | 'loading' | 'ready' | 'error'

interface KeyedResourceOptions<T> {
  /** 键控资源的键；null/undefined/空串进入 idle（不载入）。变化即中止旧请求重取。 */
  key: string | null | undefined
  /** 载入（含中止信号）。 */
  load: (signal: AbortSignal) => Promise<T>
  /** 数据落位由页面决定；落位后进入 ready。 */
  onData: (data: T) => void
  /** 载入开始（含键切换）时清理旧数据。 */
  onReset?: () => void
  /** 失败订阅；键控资源的错误不塌页，渲染层按 state==='error' 决定呈现。 */
  onError?: () => void
}

/**
 * 键控从属资源加载机（useApiResource 的同族变体）：随 key 变化中止重取，
 * 错误不塌页（独立 error 态而非整页 unavailable）。各页面曾为「选中项详情」
 * 手写 AbortController 效应并各自发明 ready/error/missing 词汇——机械在此。
 */
export function useKeyedResource<T>(options: KeyedResourceOptions<T>): KeyedResourceState {
  // 初始态按键是否存在决定：有键首帧即 loading（不闪 idle 提示），无键 idle。
  const [state, setState] = useState<KeyedResourceState>(
    () => (options.key != null && options.key !== '' ? 'loading' : 'idle'))
  const latest = useRef(options)
  latest.current = options
  const active = options.key != null && options.key !== ''

  useEffect(() => {
    if (!active) {
      setState('idle')
      return
    }
    const controller = new AbortController()
    latest.current.onReset?.()
    setState('loading')
    latest.current.load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        latest.current.onData(data)
        setState('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        latest.current.onError?.()
        setState('error')
      })
    return () => controller.abort()
  }, [active, options.key])

  return state
}

import { useEffect, useRef, useState } from 'react'

export type ApiState = 'loading' | 'live' | 'unavailable'

interface ApiResourceOptions<T> {
  /** 挂载时加载一次（含中止信号）。 */
  load: (signal: AbortSignal) => Promise<T>
  /** 数据落位由页面决定；落位后进入 live。 */
  onData: (data: T) => void
  /** 进入不可用时的数据清理。 */
  onUnavailable?: () => void
  /** 连接超时（毫秒），超时按不可用处理；不设则仅等待失败。 */
  timeoutMs?: number
  /** 变化即中止旧请求并重取；不传则挂载加载一次。 */
  reloadKey?: unknown
}

/**
 * 控制面资源的加载三态机：loading -> live / unavailable。
 * AbortController、超时与失败收敛在此——各页面曾逐字复制这套效应。
 * 挂载即加载一次（或随 reloadKey 变化重取）；回调经 ref 取最新值，
 * 效应不随渲染重启。
 */
export function useApiResource<T>(options: ApiResourceOptions<T>): ApiState {
  const [state, setState] = useState<ApiState>('loading')
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    const controller = new AbortController()
    // 区分两种中止：自身超时按不可用处理；组件卸载/重取的中止静默忽略。
    let timedOut = false
    const timeoutMs = latest.current.timeoutMs
    const timeout = timeoutMs === undefined
      ? null
      : window.setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
    latest.current.load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        latest.current.onData(data)
        setState('live')
      })
      .catch(() => {
        if (controller.signal.aborted && !timedOut) return
        latest.current.onUnavailable?.()
        setState('unavailable')
      })
      .finally(() => {
        if (timeout !== null) window.clearTimeout(timeout)
      })
    return () => {
      if (timeout !== null) window.clearTimeout(timeout)
      controller.abort()
    }
  }, [options.reloadKey])

  return state
}

import { useEffect, useRef } from 'react'

/**
 * 周期刷新机（useApiResource 的同族变体）：挂载（或 enabled/restartKey 变化）
 * 立即执行一次并按间隔重复；卸载时停止计时并中止首次在途请求。
 * 403/错误等业务语义留在页面回调——这里只有计时与清理机械。
 */
export function usePolling(
  load: (signal?: AbortSignal) => void | Promise<void>,
  intervalMs: number,
  enabled = true,
  restartKey?: unknown,
): void {
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void latest.current(controller.signal)
    const timer = window.setInterval(() => void latest.current(), intervalMs)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [enabled, intervalMs, restartKey])
}

import { useRef, useState } from 'react'

export interface ActionRunner {
  /** 在途动作的互斥键；空闲为 null。 */
  pendingKey: string | null
  error: string | null
  setError: (message: string | null) => void
  /**
   * 执行一个互斥动作：忙时静默返回；错误统一归置为
   * `cause.message ?? fallbackError`。
   * @param onError 按调用覆写错误通道（默认走 hook 级通道）。
   */
  run: (key: string, fallbackError: string, task: () => Promise<void>,
        onError?: (message: string, cause: unknown) => void) => Promise<void>
}

/**
 * 动作互斥：同一时刻只允许一个在途动作，busy 键与错误归置统一。
 * 各页面的动作处理器曾以「setBusy/setError/try/catch/finally」逐字复制。
 */
export function useAction(onError?: (message: string, cause: unknown) => void): ActionRunner {
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef(onError)
  channelRef.current = onError

  async function run(key: string, fallbackError: string, task: () => Promise<void>,
                     onErrorOverride?: (message: string, cause: unknown) => void): Promise<void> {
    if (pendingKey !== null) return
    setPendingKey(key)
    setError(null)
    try {
      await task()
    } catch (cause) {
      const message = cause instanceof Error && cause.message ? cause.message : fallbackError
      setError(message)
      const channel = onErrorOverride ?? channelRef.current
      channel?.(message, cause)
    } finally {
      setPendingKey(null)
    }
  }

  return { pendingKey, error, setError, run }
}

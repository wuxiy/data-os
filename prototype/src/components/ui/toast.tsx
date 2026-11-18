import { CheckCircle2, CircleAlert } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type Notify = (message: string, tone?: 'error') => void

const NoticeContext = createContext<Notify>(() => {})

/**
 * 全局动作回执：普通保存/复制/刷新结果走轻量提示，不打断工作区。
 * 提示只承载文案，不承担状态机——业务结果仍由页面数据回读。
 */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)
  const [tone, setTone] = useState<'error' | undefined>()
  const timerRef = useRef<number | null>(null)

  const notify = useCallback<Notify>((next, nextTone) => {
    setMessage(next)
    setTone(nextTone)
    setVisible(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(false), 3700)
  }, [])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const value = useMemo(() => notify, [notify])

  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div
        aria-live={tone === 'error' ? 'assertive' : 'polite'}
        className={`pointer-events-none fixed bottom-[26px] left-1/2 z-[100] max-w-[550px] -translate-x-1/2 rounded-panel border border-[#dce3ed] bg-paper px-[17px] py-[11px] text-body-sm text-ink-soft shadow-[0_7px_28px_-8px_#1f376d40] transition-[opacity,transform] duration-200 ${visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
      >
        {message ? (
          <span className="flex items-center gap-2">
            {tone === 'error' ? <CircleAlert className="size-[15px] text-red" /> : <CheckCircle2 className="size-[15px] text-blue" />}
            {message}
          </span>
        ) : null}
      </div>
    </NoticeContext.Provider>
  )
}

export function useNotice(): Notify {
  return useContext(NoticeContext)
}

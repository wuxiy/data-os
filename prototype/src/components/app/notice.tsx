import { useCallback } from 'react'
import { toastManager } from '@/components/ui/toast'

type Notify = (message: string, tone?: 'error') => void

/**
 * 全局动作回执：普通保存/复制/刷新结果走轻量提示，不打断工作区。
 * 提示只承载文案，不承担状态机——业务结果仍由页面数据回读。
 * 渲染由应用根部的 coss ToastProvider 负责；失败用高优先级（读屏紧急播报）。
 */
export function useNotice(): Notify {
  return useCallback((message, tone) => {
    toastManager.add({
      title: message,
      type: tone === 'error' ? 'error' : 'success',
      priority: tone === 'error' ? 'high' : undefined,
      timeout: 3700,
    })
  }, [])
}

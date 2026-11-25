import { useBlocker } from '@tanstack/react-router'
import { useCallback, useRef } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * 编辑页脏退出守卫（对齐原型 v0.2：离开未保存编辑先询问，拦一切路由离开——
 * 侧栏、顶栏页签、页内返回、浏览器后退都在内；刷新/关闭用浏览器原生提示）。
 * 保存成功后的跳转调 allowNextLeave() 一次性放行，不再询问。
 */
export function useDirtyLeaveGuard(dirty: boolean) {
  const bypass = useRef(false)
  const blocker = useBlocker({
    shouldBlockFn: () => {
      if (bypass.current) {
        bypass.current = false
        return false
      }
      return dirty
    },
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })
  const allowNextLeave = useCallback(() => { bypass.current = true }, [])
  const reset = blocker.reset
  const proceed = blocker.proceed
  const guard = (
    <Dialog open={blocker.status === 'blocked'} onOpenChange={(open: boolean) => { if (!open && blocker.status === 'blocked') reset?.() }}>
      <DialogPopup closeProps={{ 'aria-label': '关闭' }}>
        <DialogHeader>
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>离开后本页未保存的内容会丢失；已保存的内容与运行记录不受影响。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset?.()}>继续编辑</Button>
          <Button variant="destructive" onClick={() => proceed?.()}>放弃修改</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
  return { allowNextLeave, guard }
}

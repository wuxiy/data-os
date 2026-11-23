import { useBlocker } from '@tanstack/react-router'
import { useCallback, useRef } from 'react'
import { Button } from '../components/kit/button'
import { Dialog, DialogFooter } from '../components/kit/overlay'

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
    <Dialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open: boolean) => { if (!open && blocker.status === 'blocked') reset?.() }}
      title="放弃未保存的修改？"
      description="离开后本页未保存的内容会丢失；已保存的内容与运行记录不受影响。"
      width={460}
      footer={
        <DialogFooter>
          <Button onClick={() => reset?.()}>继续编辑</Button>
          <Button variant="danger" onClick={() => proceed?.()}>放弃修改</Button>
        </DialogFooter>
      }
    />
  )
  return { allowNextLeave, guard }
}

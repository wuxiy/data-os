import { TriangleAlert } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * 未保存退出守卫（DESIGN.md §15）：容器内有未保存内容时，关闭请求先在原位询问，
 * 确认放弃后才真正关闭。焦点陷阱、Esc 与焦点归还由 coss Dialog / Drawer 负责。
 */
export function useDiscardGuard(dirty: boolean, onOpenChange: (open: boolean) => void) {
  const allowClose = useRef(false)
  const [discardPrompt, setDiscardPrompt] = useState(false)

  const requestOpenChange = useCallback((next: boolean, details: { cancel: () => void }) => {
    if (!next && dirty && !allowClose.current) {
      details.cancel()
      setDiscardPrompt(true)
      return
    }
    allowClose.current = false
    setDiscardPrompt(false)
    onOpenChange(next)
  }, [dirty, onOpenChange])

  const keepEditing = useCallback(() => setDiscardPrompt(false), [])

  const confirmDiscard = useCallback(() => {
    allowClose.current = true
    setDiscardPrompt(false)
    onOpenChange(false)
  }, [onOpenChange])

  return { requestOpenChange, discardPrompt, keepEditing, confirmDiscard }
}

/** 容器内的未保存提示：继续编辑，或放弃修改后关闭。 */
export function DiscardPrompt({
  onKeepEditing,
  onDiscard,
  children = '当前容器内还有未保存的内容。',
}: {
  onKeepEditing: () => void
  onDiscard: () => void
  children?: ReactNode
}) {
  return (
    <Alert variant="warning" className="mb-4">
      <TriangleAlert />
      <AlertDescription>{children}离开后会丢失这些内容。</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onKeepEditing}>继续编辑</Button>
        <Button variant="destructive" size="sm" onClick={onDiscard}>放弃修改</Button>
      </AlertAction>
    </Alert>
  )
}

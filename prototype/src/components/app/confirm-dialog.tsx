import { TriangleAlert } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export type ConfirmTone = 'default' | 'destructive'

/**
 * 后果确认：在 coss AlertDialog 上承载被操作对象、后果说明与执行中的忙碌态。
 * 点击遮罩不提交；初始焦点在取消；执行中禁止确认与取消。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  object,
  hint,
  confirmLabel,
  cancelLabel = '取消',
  tone = 'default',
  busy = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** 被操作对象：名称/编号/影响，帮助用户确认没有点错。 */
  object?: { name: ReactNode; meta?: ReactNode }
  /** 后果说明。 */
  hint?: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  tone?: ConfirmTone
  busy?: boolean
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <AlertDialogPopup initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {object ? (
          <div className="mx-6 rounded-lg bg-muted px-3 py-2.5">
            <strong className="block text-sm font-medium">{object.name}</strong>
            {object.meta ? <span className="mt-1 block text-xs text-muted-foreground">{object.meta}</span> : null}
          </div>
        ) : null}
        {hint ? (
          <Alert variant="warning" className="mx-6">
            <TriangleAlert />
            <AlertDescription>{hint}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose ref={cancelRef} render={<Button variant="outline" disabled={busy} />}>
            {cancelLabel}
          </AlertDialogClose>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}

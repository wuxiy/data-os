import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './button'

/**
 * 三类容器（DESIGN.md §15 / OVERLAY-GUIDE.md）：
 * - Sheet：右侧对象速览，保留列表上下文；
 * - Dialog：单步短输入或一次性检查；
 * - AlertDialog：明确对象与后果的决策，初始焦点在取消。
 * 焦点陷阱、Esc、遮罩与焦点归还由 Base UI 的原语文语负责，这里只做视觉与
 * 未保存退出的业务拦截（不复制原型手写的 DOM 焦点控制器）。
 */

const backdropClass =
  'fixed inset-0 z-40 bg-[#1a294531] transition-opacity duration-150 [&[data-ending-style]]:opacity-0 [&[data-starting-style]]:opacity-0'

/** 脏数据拦截：关闭请求先在原位询问，不叠第二个业务表单。 */
function useDiscardGuard(dirty: boolean, onOpenChange: (open: boolean) => void) {
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

  const confirmDiscard = useCallback(() => {
    allowClose.current = true
    setDiscardPrompt(false)
    onOpenChange(false)
  }, [onOpenChange])

  return { requestOpenChange, discardPrompt, setDiscardPrompt, confirmDiscard }
}

export function DiscardInline({
  onKeepEditing,
  onDiscard,
  children = '当前容器内还有未保存的内容。',
}: {
  onKeepEditing: () => void
  onDiscard: () => void
  children?: ReactNode
}) {
  return (
    <div role="alert" className="mb-3.5 rounded-control border border-[#ecd9b6] bg-[#fffaf0] px-3 py-[11px] text-label text-amber">
      <div>{children}离开后会丢失这些内容。</div>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" onClick={onKeepEditing}>继续编辑</Button>
        <Button size="sm" variant="danger" onClick={onDiscard}>放弃修改</Button>
      </div>
    </div>
  )
}

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  subtitle?: ReactNode
  /** 详情面板宽度：默认 610，责任链 420（DESIGN.md 历史两档）。 */
  width?: number
  dirty?: boolean
  footer?: ReactNode
  children: ReactNode
}

export function Sheet({ open, onOpenChange, title, subtitle, width = 610, dirty = false, footer, children }: SheetProps) {
  const guard = useDiscardGuard(dirty, onOpenChange)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={guard.requestOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className={backdropClass} />
        <DialogPrimitive.Popup
          aria-label={typeof title === 'string' ? title : undefined}
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col overflow-hidden border-l border-line bg-paper shadow-sheet outline-none transition-[opacity,transform] duration-200 [&[data-ending-style]]:translate-x-2 [&[data-ending-style]]:opacity-0 [&[data-starting-style]]:translate-x-2 [&[data-starting-style]]:opacity-0"
          style={{ width }}
        >
          <header className="shrink-0 border-b border-line px-6 pt-[22px] pb-[17px]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-subject font-semibold">{title}</DialogPrimitive.Title>
                {subtitle ? <p className="mt-[5px] text-label text-muted-foreground">{subtitle}</p> : null}
              </div>
              <DialogPrimitive.Close
                render={<button type="button" aria-label="关闭详情" title="关闭，Esc" className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-chip text-muted-foreground hover:bg-wash hover:text-ink" />}
              >
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {guard.discardPrompt ? (
              <div className="px-6 pt-5">
                <DiscardInline onKeepEditing={() => guard.setDiscardPrompt(false)} onDiscard={guard.confirmDiscard} />
              </div>
            ) : null}
            {children}
          </div>
          {footer ? <footer className="shrink-0 border-t border-line bg-paper px-6 pt-[13px] pb-[15px]">{footer}</footer> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Sheet 内容分区：详情页统一的内边距。 */
export function SheetBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-6 pt-5 pb-6', className)}>{children}</div>
}

/** Sheet 底部动作：提示在左，按钮在右。 */
export function SheetFooterActions({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      {hint ? <div className="text-meta text-muted-foreground">{hint}</div> : null}
      <div className="flex items-center justify-end gap-[9px]">{children}</div>
    </div>
  )
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** 中心弹窗宽度：短表单 540，说明/确认 480/460。 */
  width?: number
  dirty?: boolean
  footer?: ReactNode
  children?: ReactNode
}

export function Dialog({ open, onOpenChange, title, description, width = 540, dirty = false, footer, children }: DialogProps) {
  const guard = useDiscardGuard(dirty, onOpenChange)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={guard.requestOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className={backdropClass} />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-modal border border-line bg-paper shadow-panel outline-none transition-[opacity,transform] duration-150 [&[data-ending-style]]:opacity-0 [&[data-ending-style]]:scale-[0.98] [&[data-starting-style]]:opacity-0 [&[data-starting-style]]:scale-[0.98]"
          style={{ maxWidth: width }}
        >
          <header className="flex items-start justify-between gap-4 px-6 pt-[22px] pb-2">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[16px] font-semibold">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-2 text-body-sm leading-relaxed text-muted-foreground">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close
              render={<button type="button" aria-label="关闭对话框" className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-chip text-muted-foreground hover:bg-wash hover:text-ink" />}
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
            {guard.discardPrompt ? <DiscardInline onKeepEditing={() => guard.setDiscardPrompt(false)} onDiscard={guard.confirmDiscard} /> : null}
            {children}
          </div>
          {footer ? <div className="border-t border-line px-6 py-[17px]">{footer}</div> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Dialog 底部动作：左侧备注，右侧按钮，取消在左。 */
export function DialogFooter({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-meta text-muted-foreground">{note}</div>
      <div className="flex items-center justify-end gap-[9px]">{children}</div>
    </div>
  )
}

export type ConfirmTone = 'default' | 'destructive'

interface ConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** 被操作对象：名称/编号/影响，帮助用户确认没有点错。 */
  object?: { name: ReactNode; meta?: ReactNode }
  /** 保留内容/后果说明。 */
  hint?: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  tone?: ConfirmTone
  busy?: boolean
  onConfirm: () => void
}

/**
 * 后果确认：视觉与动作名称区分于普通表单；点击遮罩不提交，初始焦点在取消，
 * 执行中禁止确认与取消（由 busy 控制）。
 */
export function Confirm({
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
}: ConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop className={backdropClass} />
        <AlertDialogPrimitive.Popup
          initialFocus={cancelRef}
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-32px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-modal border border-line bg-paper shadow-panel outline-none transition-[opacity,transform] duration-150 [&[data-ending-style]]:opacity-0 [&[data-ending-style]]:scale-[0.98] [&[data-starting-style]]:opacity-0 [&[data-starting-style]]:scale-[0.98]"
        >
          <div className="px-[26px] pt-[27px] pb-5">
            <div
              aria-hidden="true"
              className={cn(
                'mb-[17px] inline-flex rounded-panel border p-[9px]',
                tone === 'destructive' ? 'border-[#f0dada] bg-[#fff5f5] text-red' : 'border-[#dfe7f4] bg-[#f1f6fe] text-blue',
              )}
            >
              {tone === 'destructive' ? <TriangleAlert size={21} /> : <Info size={21} />}
            </div>
            <AlertDialogPrimitive.Title className="mb-[11px] text-subject font-semibold">{title}</AlertDialogPrimitive.Title>
            {description ? (
              <AlertDialogPrimitive.Description className="text-body-sm leading-relaxed text-muted-foreground">{description}</AlertDialogPrimitive.Description>
            ) : null}
            {object ? (
              <div className="mt-[17px] rounded-control border border-line bg-[#fafbfc] px-[13px] py-3">
                <strong className="block text-body-sm font-medium text-ink-soft">{object.name}</strong>
                {object.meta ? <span className="mt-1 block text-meta text-muted-foreground">{object.meta}</span> : null}
              </div>
            ) : null}
            {hint ? <p className="mt-[13px] text-label leading-relaxed text-amber">{hint}</p> : null}
          </div>
          <div className="flex justify-end gap-[9px] border-t border-line px-[26px] pt-[15px] pb-[21px]">
            <AlertDialogPrimitive.Close
              ref={cancelRef}
              render={<Button disabled={busy} />}
            >
              {cancelLabel}
            </AlertDialogPrimitive.Close>
            <Button
              variant={tone === 'destructive' ? 'danger' : 'primary'}
              disabled={busy}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

/** 轻量提示图标：用于页内空态与警示行。 */
export const NoticeIcons = { CircleAlert, Info, TriangleAlert }

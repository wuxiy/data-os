import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'

/** 行内加载提示：区块内刷新时保留已有工作面。 */
export function LoadingInline({ children = '正在读取…' }: { children?: ReactNode }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
      <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
      {children}
    </span>
  )
}

/** 独立加载块：首屏读取时占位。 */
export function LoadingBlock({
  children = '正在读取数据…',
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-[220px] flex-col items-center justify-center gap-2.5 text-muted-foreground text-sm',
        className,
      )}
    >
      <Spinner aria-hidden="true" role="presentation" className="size-5" />
      {children}
    </div>
  )
}

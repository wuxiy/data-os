import { LoaderCircle, SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** 空态/不可用态：保留页面位置与恢复入口，不补演示结果。 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  minHeight = 365,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  minHeight?: number
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center bg-paper px-10 text-center', className)} style={{ minHeight }}>
      <div className="mb-[17px] rounded-panel border border-[#e9edf4] bg-[#f6f8fc] p-3.5 text-[#a5b4c9] [&_svg]:size-7">
        {icon ?? <SearchX />}
      </div>
      <h2 className="mb-[7px] text-[15px] font-medium text-ink-soft">{title}</h2>
      {description ? <p className="max-w-[330px] text-body-sm leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/** 骨架屏：表格/面板的首屏加载，不改变布局高度语义。 */
export function Skeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="正在加载数据" className={cn('px-5 py-5', className)}>
      <div className="mb-6 h-[18px] w-[130px] rounded-chip bg-line-soft" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-[30px] border-b border-[#f0f2f5] py-3.5">
          <div className="h-3 flex-2 rounded-chip bg-line-soft" />
          <div className="h-3 flex-1 rounded-chip bg-line-soft" />
          <div className="h-3 flex-1 rounded-chip bg-line-soft" />
          <div className="h-3 flex-1 rounded-chip bg-line-soft" />
        </div>
      ))}
      <p className="mt-5 text-label text-muted">正在读取数据，请稍候…</p>
    </div>
  )
}

/** 行内加载提示：区块内刷新时保留已有工作面。 */
export function LoadingInline({ children = '正在读取…' }: { children?: ReactNode }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-label text-muted">
      <LoaderCircle className="size-3.5 animate-spin" />
      {children}
    </span>
  )
}

/** 独立加载块。 */
export function LoadingBlock({ children = '正在读取数据…', className }: { children?: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn('flex min-h-[220px] flex-col items-center justify-center gap-2.5 text-label text-muted', className)}>
      <LoaderCircle className="size-5 animate-spin text-muted" />
      {children}
    </div>
  )
}

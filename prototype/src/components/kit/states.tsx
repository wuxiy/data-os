import { SearchX } from 'lucide-react'
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
      {description ? <p className="max-w-[330px] text-body-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

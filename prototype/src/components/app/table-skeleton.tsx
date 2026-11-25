import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** 表格首屏骨架：保留表头与行列的形状，数据到位后原位替换，不改变布局高度语义。 */
export function TableSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="正在读取数据" className={cn('px-5 py-5', className)}>
      <Skeleton className="mb-6 h-[18px] w-[130px]" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-[30px] border-b border-line-soft py-3.5">
          <Skeleton className="h-3 flex-2" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
      <p className="mt-5 text-muted-foreground text-sm">正在读取数据，请稍候…</p>
    </div>
  )
}

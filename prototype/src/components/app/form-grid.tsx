import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 两列表单网格：短表单的默认排布，窄容器自动单列。行间与末行之后的间距分别由 gap 与下边距负责。 */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4 grid grid-cols-2 gap-4', className)}>{children}</div>
}

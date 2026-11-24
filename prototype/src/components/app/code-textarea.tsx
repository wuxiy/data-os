import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'

/**
 * 代码 / JSON / SQL 编辑域：等宽字体、固定起始高度、可拖拽调高。
 * coss Textarea 默认随内容增高；这里交给调用方的 min-height 同时约束外层与编辑区。
 */
export function CodeTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn(
        'min-h-[150px] font-mono',
        '[&_[data-slot=textarea]]:field-sizing-fixed [&_[data-slot=textarea]]:min-h-inherit [&_[data-slot=textarea]]:resize-y [&_[data-slot=textarea]]:text-xs',
        className,
      )}
      {...props}
    />
  )
}

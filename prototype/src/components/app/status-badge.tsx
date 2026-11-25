import type { ComponentProps } from 'react'

import { Badge } from '@/components/ui/badge'

const variants = {
  neutral: 'outline',
  good: 'success',
  bad: 'error',
  running: 'info',
} as const

export type StatusTone = keyof typeof variants

/**
 * 状态标签：色点 + 文案，用于运行结果、任务状态等可读状态。
 * 颜色只做辅助——状态本身始终带文字说明。
 */
export function StatusBadge({
  tone = 'neutral',
  children,
  ...props
}: ComponentProps<typeof Badge> & { tone?: StatusTone }) {
  return (
    <Badge {...props} variant={variants[tone]}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </Badge>
  )
}

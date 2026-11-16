import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'

const badgeTones = {
  neutral: 'border-[#e4e8ee] bg-[#f4f6f9] text-[#657181]',
  warn: 'border-amber-line bg-amber-soft text-amber',
  danger: 'border-red-line bg-red-soft text-red',
  success: 'border-green-line bg-green-soft text-green',
  blue: 'border-[#d9e5fb] bg-[#eef4ff] text-[#3162ba]',
} as const

export type BadgeTone = keyof typeof badgeTones

/** 状态标签：10px 小型圆角标签，只在状态确有语义时使用（DESIGN.md §4）。 */
export function Badge({ tone = 'neutral', className, children, ...props }: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-chip border px-1.5 py-px text-meta leading-normal font-normal', badgeTones[tone], className)}
      {...props}
    >
      {children}
    </span>
  )
}

const dotTones = {
  neutral: 'text-[#647180]',
  good: 'text-green',
  bad: 'text-red',
  running: 'text-[#3b6abb]',
} as const

const dotColors = {
  neutral: 'bg-[#929daa]',
  good: 'bg-[#4d8c6e]',
  bad: 'bg-[#c45757]',
  running: 'bg-[#4979cf]',
} as const

export type StatusTone = keyof typeof dotTones

/** 状态点 + 文案：用于任务结果、运行状态等可读状态。 */
export function StatusText({ tone = 'neutral', children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-label', dotTones[tone], className)}>
      <i aria-hidden="true" className={cn('size-[5px] rounded-full', dotColors[tone])} />
      {children}
    </span>
  )
}

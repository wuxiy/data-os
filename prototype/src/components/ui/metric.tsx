import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * 指标卡：批准原型的 28px 数字 + 说明行；可下钻时整卡是按钮。
 * 数值忠于接口，无数据时显示 —，不补演示走势。
 */
export function MetricCard({
  label,
  value,
  unit,
  note,
  tone = 'neutral',
  icon,
  onClick,
}: {
  label: string
  value: ReactNode
  unit?: string
  note?: ReactNode
  tone?: 'neutral' | 'warn' | 'danger' | 'good'
  icon?: ReactNode
  onClick?: () => void
}) {
  const valueTone = tone === 'danger' ? 'text-red' : tone === 'warn' ? 'text-amber' : 'text-ink'
  const className = cn(
    'min-w-0 border-r border-line px-4 py-1 text-left transition-colors last:border-r-0',
    onClick && 'hover:bg-wash',
  )
  const body = (
    <>
      <span className="flex min-h-9 items-start justify-between gap-2 text-label text-muted">
        {label}
        {icon ? <span className="text-muted [&_svg]:size-[15px]">{icon}</span> : null}
      </span>
      <div className={cn('mt-2 text-metric leading-tight font-semibold tracking-[-0.8px]', valueTone)}>
        {value}
        {unit ? <small className="ml-[3px] text-[16px] font-medium">{unit}</small> : null}
      </div>
      {note ? <div className="mt-[5px] flex items-center gap-[5px] text-meta text-muted">{note}</div> : null}
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={className}>{body}</button>
    : <div className={className}>{body}</div>
}

/** 指标横带：用分隔线组织指标，宽度不足时自然换行。 */
export function MetricStrip({ children }: { children: ReactNode }) {
  return <section aria-label="运营摘要" className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,130px),1fr))] gap-y-3 rounded-panel bg-paper px-1 py-4">{children}</section>
}

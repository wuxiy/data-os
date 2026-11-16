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
  const valueTone = tone === 'danger' ? 'text-red' : tone === 'warn' ? 'text-amber' : 'text-[#253044]'
  const className = cn(
    'min-w-0 rounded-panel border border-line bg-paper px-[17px] pt-3.5 pb-3 text-left transition-colors',
    onClick && 'hover:border-[#c7d4e8]',
  )
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-label text-[#6c7786]">
        {label}
        {icon ? <span className="text-[#8b98aa] [&_svg]:size-[15px]">{icon}</span> : null}
      </span>
      <div className={cn('mt-2 text-metric leading-tight font-semibold tracking-[-0.8px]', valueTone)}>
        {value}
        {unit ? <small className="ml-[3px] text-[16px] font-medium">{unit}</small> : null}
      </div>
      {note ? <div className="mt-[5px] flex items-center gap-[5px] text-meta text-[#6b788b]">{note}</div> : null}
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={className}>{body}</button>
    : <div className={className}>{body}</div>
}

/** 指标条：4 列自适应网格。 */
export function MetricStrip({ children }: { children: ReactNode }) {
  return <section aria-label="运营摘要" className="mb-[18px] grid grid-cols-4 gap-3.5 max-[1320px]:grid-cols-3 max-[900px]:grid-cols-2">{children}</section>
}

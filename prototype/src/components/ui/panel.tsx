import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** 白色工作面：标题、筛选、表格、分页在同一容器内连续排列（避免反复嵌套卡片）。 */
export function Panel({ className, children, ...props }: ComponentProps<'section'>) {
  return (
    <section className={cn('min-w-0 overflow-clip rounded-panel border border-line bg-paper', className)} {...props}>
      {children}
    </section>
  )
}

export function PanelHead({
  title,
  description,
  actions,
  count,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  count?: number | string
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-[19px] pt-[15px] pb-2.5', className)}>
      <div className="min-w-0">
        <h2 className="text-title font-semibold tracking-[-0.2px]">
          {title}
          {count !== undefined ? <Count>{count}</Count> : null}
        </h2>
        {description ? <p className="mt-1 text-label text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** 数量角标：跟在标题后的小方框数字。 */
export function Count({ children }: { children: ReactNode }) {
  return <span className="ml-1.5 rounded-chip border border-[#e4e8ed] bg-wash px-1 text-meta font-medium text-[#6b7687]">{children}</span>
}

/** 键值事实表：两列网格，上下细分隔线。 */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-2 gap-x-5 gap-y-4 border-y border-line py-4', className)}>{children}</dl>
}

export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="mb-1 text-meta text-[#8a929e]">{label}</dt>
      <dd className="m-0 text-body-sm text-ink-soft">{children}</dd>
    </div>
  )
}

const noticeTones = {
  info: 'border-[#dae5f8] bg-[#f3f7ff] text-[#536e9b] [&_svg]:text-blue',
  warn: 'border-[#eee2c5] bg-[#fdf9ef] text-[#8e7040] [&_svg]:text-amber',
} as const

/** 页内说明：不阻断操作，用于边界声明、结果提示与恢复入口。 */
export function InlineNotice({
  tone = 'info',
  icon,
  children,
  className,
}: {
  tone?: keyof typeof noticeTones
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-[7px] rounded-control border px-3 py-[11px] text-label leading-relaxed', noticeTones[tone], className)}>
      {icon ? <span className="mt-0.5 [&_svg]:size-3.5">{icon}</span> : null}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** 范围声明行：列表顶部的浅底口径说明。 */
export function ScopeNote({ children }: { children: ReactNode }) {
  return <div className="border-b border-line bg-[#fbfcfe] px-[18px] py-2 text-meta text-[#8f9aa9]">{children}</div>
}

export function Subtle({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-label text-muted', className)}>{children}</span>
}

/** 键盘提示：顶栏搜索与命令面板复用。 */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-chip border border-line bg-canvas px-1 py-px font-sans text-meta text-[#7c8592]">{children}</kbd>
}

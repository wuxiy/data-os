import { ChevronRight, House } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface Crumb {
  label: ReactNode
  href?: string
}

/** 面包屑：首页图标 + 分组 + 当前页；当前页用深一档文字，不做链接。 */
export function Breadcrumb({ items, trailing }: { items: Crumb[]; trailing?: ReactNode }) {
  return (
    <nav aria-label="面包屑" className="mb-[13px] flex items-center gap-2 text-label text-[#697586]">
      <House aria-hidden="true" className="size-[13px] opacity-70" />
      {items.map((item, index) => {
        const last = index === items.length - 1
        return (
          <span key={index} className="flex items-center gap-2">
            {item.href && !last ? (
              <a href={item.href} className="hover:text-blue">
                {item.label}
              </a>
            ) : (
              <span className={last ? 'text-[#414c5c]' : undefined}>{item.label}</span>
            )}
            {!last ? <ChevronRight aria-hidden="true" className="size-3 text-[#a3adb9]" /> : null}
          </span>
        )
      })}
      {trailing ? <div className="ml-auto flex items-center gap-2 text-meta text-[#7b8491]">{trailing}</div> : null}
    </nav>
  )
}

/**
 * 页头：标题、说明与右侧动作。
 * 与旧 PageHeader 的区别是运行模式/时间戳不再由页头重复声明——顶栏横幅统一承载。
 */
export function PageHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-[18px] flex items-center justify-between gap-5', className)}>
      <div className="min-w-0">
        <h1 className="text-heading leading-[1.3] font-semibold tracking-[-0.55px]">{title}</h1>
        {description ? <p className="mt-[7px] text-body-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-[9px]">{actions}</div> : null}
    </div>
  )
}

/** 页脚：样例快照/合成数据边界等口径声明。 */
export function PageFooter({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <footer className="mt-[17px] flex items-center justify-between text-meta text-[#7a8491]">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  )
}

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * 业务页签：下划线式（详情面板、页面内分区）。
 * Base UI Tabs 提供 roving tabindex、方向键与 aria 关联。
 */
export function Tabs({
  value,
  onValueChange,
  items,
  children,
  className,
  listClassName,
}: {
  value: string
  onValueChange: (value: string) => void
  items: { value: string; label: ReactNode; count?: ReactNode }[]
  children?: ReactNode
  className?: string
  listClassName?: string
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(next) => onValueChange(String(next))} className={cn('flex flex-col', className)}>
      <TabsPrimitive.List className={cn('flex items-center gap-[21px] border-b border-line px-[18px]', listClassName)}>
        {items.map((item) => (
          <TabsPrimitive.Tab
            key={item.value}
            value={item.value}
            className="relative -mb-px shrink-0 cursor-pointer border-b-2 border-transparent px-px pt-[13px] pb-3 text-body-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-[-2px] data-[active]:border-blue data-[active]:font-medium data-[active]:text-blue"
          >
            {item.label}
            {item.count !== undefined ? <span className="ml-1.5 rounded-chip border border-line bg-wash px-1 text-meta font-medium text-muted-foreground">{item.count}</span> : null}
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  )
}

export function TabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Panel value={value} className={cn('outline-none', className)}>
      {children}
    </TabsPrimitive.Panel>
  )
}

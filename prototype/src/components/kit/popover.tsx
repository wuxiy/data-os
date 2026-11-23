import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * 轻量浮层：通知预览、日期范围、列设置、用户菜单。不锁整页，Esc/点击外部收起。
 * 定位、焦点返回与关闭行为由 Base UI Popover 负责。
 */
export function Popover({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger render={trigger} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner align={align} side={side} sideOffset={6} className="isolate z-50">
          <PopoverPrimitive.Popup
            className={cn(
              'min-w-[170px] rounded-panel border border-line bg-paper p-2.5 text-label text-ink-soft shadow-panel outline-none transition-[opacity,transform] duration-100 [&[data-ending-style]]:opacity-0 [&[data-starting-style]]:opacity-0',
              className,
            )}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** Popover 内的小标题。 */
export function PopoverTitle({ children }: { children: ReactNode }) {
  return <strong className="block px-1 pb-1.5 pt-0.5 text-label font-semibold text-ink">{children}</strong>
}

/** Popover 内的可选行（复选/单选样式）。 */
export function PopoverOption({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-chip px-1 py-1.5 text-label hover:bg-wash">
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="size-[13px] accent-blue" />
      {children}
    </label>
  )
}

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

/** 分段控件（如近 7 天 / 近 30 天）。 */
export function Segmented({ value, onValueChange, options }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div role="group" className="inline-flex gap-0.5 rounded-control border border-line bg-wash p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onValueChange(option.value)}
          className={cn(
            'rounded-chip px-[9px] py-[3px] text-meta',
            value === option.value ? 'bg-paper text-ink-soft shadow-focus' : 'text-muted-foreground hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

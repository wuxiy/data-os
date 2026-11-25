import type { ComponentProps } from 'react'

import { SidebarMenuButton } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * 主从布局里「选中项」列表的条目。coss 主从布局的列表项写法是 SidebarMenuButton isActive，
 * 这里沿用它的结构、截断与焦点态，只做两处适配：配色从侧栏的深色底换成内容区的浅色底；
 * 高度放开以容纳多行内容。选中态沿用 coss 的 data-active，同时带 aria-pressed 供读屏播报。
 * 依赖 SidebarProvider 上下文：应用里由壳提供，页面单独渲染时用 test-support/render-with-sidebar。
 */
export function SelectionListItem({ className, isActive, ...props }: ComponentProps<typeof SidebarMenuButton>) {
  return (
    <SidebarMenuButton
      type="button"
      isActive={isActive}
      aria-pressed={isActive}
      className={cn(
        'h-auto flex-col items-stretch gap-0 rounded-control px-2.5 py-2 text-body-sm',
        'hover:bg-wash hover:text-foreground active:bg-wash active:text-foreground',
        'data-[active=true]:bg-blue-soft data-[active=true]:text-foreground',
        'ring-ring/50',
        className,
      )}
      {...props}
    />
  )
}

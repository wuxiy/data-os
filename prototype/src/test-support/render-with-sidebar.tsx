import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

import { SidebarProvider } from '../components/ui/sidebar'

/**
 * 渲染带主从选择列表的页面。列表项（SelectionListItem）是 coss SidebarMenuButton，
 * 依赖 SidebarProvider 上下文——应用里由壳提供，页面单独渲染时要补上。
 */
export function renderWithSidebar(ui: ReactElement) {
  return render(<SidebarProvider>{ui}</SidebarProvider>)
}

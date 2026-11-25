import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  Bell,
  ChevronDown,
  CircleHelp,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Waypoints,
  X,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import {
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  Menu as MenuRoot,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from '@/components/ui/menu'
import {
  Popover,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

import { operationsSummaryQuery } from '../../features/overview/queries'
import { cn } from '../../lib/utils'
import { usePortalNavigate } from '../navigate'
import { activeNavKey, governanceChildren, isGovernancePath, navGroups, routeForPath } from '../navigation'
import { useAuth } from '../providers'
import { CommandPalette, useCommandHotkey } from './command-palette'
import { RuntimeStatusBanner } from './runtime-status-banner'
import { useVisitedTabs } from './visited-tabs'

declare module '@tanstack/history' {
  interface HistoryState {
    dataosTabClose?: string
  }
}

/** 侧栏宽度沿用批准原型：256（≤1320 时 232），图标折叠态 68；由 tokens.css 统一给出。 */
const SIDEBAR_WIDTHS = {
  '--sidebar-width': 'var(--shell-sidebar)',
  '--sidebar-width-icon': 'var(--spacing-sidebar-collapsed)',
} as CSSProperties

/** 折叠态下只留图标：文字部分加上这个类，coss Sidebar 会在图标折叠时自动隐藏。 */
const HIDE_WHEN_COLLAPSED = 'group-data-[collapsible=icon]:hidden'

/**
 * 新壳（批准原型 v0.2）：分组侧栏 + 顶栏内页签 + 连续工作面，容器为 coss Sidebar。
 * 壳只消费 styles/tokens.css 的主题与 coss 组件；业务页面按路由懒加载挂载在 Outlet。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const pathname = location.pathname
  const navigate = usePortalNavigate()
  const navigateForTabClose = useNavigate()
  const { snapshot, logout, technicalAccess } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [governanceOpen, setGovernanceOpen] = useState(() => isGovernancePath(pathname))
  const { tabs, closeTab } = useVisitedTabs(pathname)
  const pendingClose = useRef<{ path: string; token: string } | null>(null)
  const closeSequence = useRef(0)

  useEffect(() => {
    const intent = pendingClose.current
    if (!intent || pathname === intent.path) return
    if (location.state.dataosTabClose === intent.token) closeTab(intent.path)
    pendingClose.current = null
  }, [pathname, location.state, closeTab])

  useCommandHotkey(useCallback(() => setPaletteOpen(true), []))

  const route = routeForPath(pathname)
  useEffect(() => {
    document.title = `${route?.tabLabel ?? route?.label ?? '工作区'} · 医数中枢`
  }, [route?.label, route?.tabLabel])

  // 进入治理子页时展开治理分组。
  useEffect(() => {
    if (isGovernancePath(pathname)) setGovernanceOpen(true)
  }, [pathname])

  const activeKey = activeNavKey(pathname)
  const governanceActive = isGovernancePath(pathname)

  function go(path: string) {
    navigate(path)
  }

  function closeVisitedTab(path: string) {
    const index = tabs.findIndex((tab) => tab.path === path)
    if (pathname === path) {
      const fallback = tabs[index - 1]?.path ?? '/'
      // 路由可能被脏数据守卫取消；只在本次导航实际完成后删除页签。
      const token = `${Date.now()}-${++closeSequence.current}`
      pendingClose.current = { path, token }
      const state = { dataosTabClose: token }
      void navigateForTabClose({ href: fallback, state })
    } else {
      closeTab(path)
    }
  }

  return (
    <SidebarProvider open={!collapsed} onOpenChange={(open) => setCollapsed(!open)} style={SIDEBAR_WIDTHS} className="bg-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2.5 focus:left-72 focus:z-[100] focus:rounded-control focus:bg-blue focus:px-[18px] focus:py-2.5 focus:text-white"
      >
        跳到主要内容
      </a>

      <AppNavigation
        activeKey={activeKey}
        governanceOpen={governanceOpen}
        governanceActive={governanceActive}
        pathname={pathname}
        technicalAccess={technicalAccess}
        displayName={snapshot.displayName}
        onNavigate={go}
        onToggleGovernance={() => setGovernanceOpen((open) => !open)}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onLogout={logout}
      />

      <SidebarInset id="main-content" tabIndex={-1} className="min-w-0 bg-shell">
        <WorkspaceHeader
          pathname={pathname}
          tabs={tabs}
          onNavigate={go}
          onCloseTab={closeVisitedTab}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <div className="min-w-0 px-7 pt-5 pb-6 max-[1320px]:px-5">
          <div className="mx-auto max-w-[1600px]">
            <RuntimeStatusBanner />
            {children}
          </div>
        </div>
      </SidebarInset>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  )
}

/** 路由变化后收起移动端侧栏（coss Sidebar 在窄屏是抽屉）。 */
function useCloseMobileSidebarOnNavigate(pathname: string) {
  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])
}

/** 顶栏：侧栏开关、页面搜索、已打开的页面页签与右侧入口。 */
function WorkspaceHeader({
  pathname,
  tabs,
  onNavigate,
  onCloseTab,
  onOpenPalette,
}: {
  pathname: string
  tabs: ReturnType<typeof useVisitedTabs>['tabs']
  onNavigate: (path: string) => void
  onCloseTab: (path: string) => void
  onOpenPalette: () => void
}) {
  const { setOpenMobile } = useSidebar()
  useCloseMobileSidebarOnNavigate(pathname)
  const go = (path: string) => {
    setOpenMobile(false)
    onNavigate(path)
  }

  return (
    <header className="sticky top-0 z-20 flex h-topbar min-w-0 items-center gap-3 border-b bg-canvas px-4">
      <SidebarTrigger aria-label="收起 / 展开导航" />
      <SidebarSeparator orientation="vertical" className="mr-1 h-4" />
      <Button
        variant="outline"
        onClick={onOpenPalette}
        aria-label="搜索页面，Command K"
        className="w-32 shrink-0 justify-start gap-2 px-2.5 font-normal text-muted-foreground sm:w-36"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">搜索页面</span>
        <Kbd className="ml-auto">⌘ K</Kbd>
      </Button>

      <nav aria-label="已打开的页面" className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-control border border-line bg-paper p-0.5">
          {tabs.map((tab) => {
            const current = tab.path === pathname
            return (
              <div
                key={tab.path}
                className={cn(
                  'flex shrink-0 items-center gap-0.5 rounded-chip pl-1 text-label',
                  current ? 'bg-accent font-medium text-primary' : 'text-muted-foreground',
                )}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => go(tab.path)}
                  aria-current={current ? 'page' : undefined}
                  className="h-[27px] px-1.5 text-xs"
                >
                  {tab.path === '/' ? '总览' : tab.label}
                </Button>
                {tab.closable ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`关闭${tab.label}页签`}
                    onClick={() => onCloseTab(tab.path)}
                    className="size-6 opacity-65 hover:opacity-100"
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </nav>

      <div className="flex shrink-0 items-center gap-2.5">
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="使用说明" />}>
            <CircleHelp />
          </PopoverTrigger>
          <PopoverPopup align="end" className="w-80 flex-col gap-2">
            <PopoverTitle className="text-sm">使用说明</PopoverTitle>
            <PopoverDescription className="text-xs leading-relaxed">
              顶栏页签保留本会话打开过的页面。⌘/Ctrl K 可搜索页面；各工作区的检索、筛选与对象深链保存在地址栏。
            </PopoverDescription>
            <PopoverDescription className="text-xs leading-relaxed">
              页面数据来自真实服务；演示数据只在显式演示构建中展示，不会补位真实失败。
            </PopoverDescription>
          </PopoverPopup>
        </Popover>
        <MenuRoot>
          <MenuTrigger render={<Button variant="ghost" size="icon" aria-label="查看待办入口" />}>
            <Bell />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-60">
            <MenuGroup>
              <MenuGroupLabel>待办入口</MenuGroupLabel>
              <MenuItem onClick={() => go('/governance/quality')}>
                质量问题待闭环
                <MenuShortcut>质量工作台</MenuShortcut>
              </MenuItem>
              <MenuItem onClick={() => go('/mpi/review')}>
                主索引人工复核
                <MenuShortcut>复核队列</MenuShortcut>
              </MenuItem>
              <MenuItem onClick={() => go('/operations-center')}>
                跨域待办
                <MenuShortcut>运营中心</MenuShortcut>
              </MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <p className="px-2 py-1 text-xs text-muted-foreground">此处只链接已有待办，不新增已读/未读中心。</p>
          </MenuPopup>
        </MenuRoot>
        <AccountMenu />
      </div>
    </header>
  )
}

/** 账号菜单：登录方式与退出入口（本地直连模式没有退出）。 */
function AccountMenu() {
  const { snapshot, logout } = useAuth()
  return (
    <MenuRoot>
      <MenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full bg-blue-soft text-blue" aria-label="当前账号" />}>
        {(snapshot.displayName ?? '医').slice(0, 1)}
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-52">
        <MenuGroup>
          <MenuGroupLabel className="flex-col items-start gap-0.5 py-2">
            <span className="text-sm text-foreground">{snapshot.displayName ?? '当前会话'}</span>
            <span className="text-xs text-muted-foreground">{snapshot.status === 'disabled' ? '本地直连模式' : '统一身份认证'}</span>
          </MenuGroupLabel>
          {logout ? (
            <MenuItem variant="destructive" onClick={logout}>
              <LogOut />
              退出登录
            </MenuItem>
          ) : null}
        </MenuGroup>
      </MenuPopup>
    </MenuRoot>
  )
}

/** 分组侧栏（coss Sidebar）：品牌、按分组的导航、治理子导航与账号区。 */
function AppNavigation({
  activeKey,
  governanceOpen,
  governanceActive,
  pathname,
  technicalAccess,
  displayName,
  onNavigate,
  onToggleGovernance,
  onToggleCollapse,
  onLogout,
}: {
  activeKey: string
  governanceOpen: boolean
  governanceActive: boolean
  pathname: string
  technicalAccess: boolean
  displayName?: string
  onNavigate: (path: string) => void
  onToggleGovernance: () => void
  onToggleCollapse: () => void
  onLogout?: () => void
}) {
  const { state, isMobile, setOpenMobile } = useSidebar()
  // 图标折叠态放不下子导航：此时点击「数据治理」直接进入驾驶舱。
  const collapsed = state === 'collapsed' && !isMobile
  // 待复核计数（原型 nav-count 徽标）：复用总览的运营投影查询，读取失败只是不显示徽标。
  const reviewPending = useQuery(operationsSummaryQuery()).data?.domains.mpi.reviewPending ?? 0
  const go = (path: string) => {
    setOpenMobile(false)
    onNavigate(path)
  }
  useCloseMobileSidebarOnNavigate(pathname)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <span aria-hidden="true" className="grid shrink-0 grid-cols-2 gap-[3px]">
                <i className="size-2.5 rounded-[3px] bg-sidebar-primary" /><i className="size-2.5 rounded-[3px] bg-sidebar-primary" />
                <i className="size-2.5 rounded-[3px] bg-sidebar-primary" /><i className="size-2.5 rounded-[3px] bg-sidebar-primary" />
              </span>
              <div className={cn('flex flex-1 items-center gap-2.5', HIDE_WHEN_COLLAPSED)}>
                <strong className="text-[19px] leading-none font-semibold tracking-[-0.5px]">医数中枢</strong>
                <Badge variant="outline" className="ml-auto font-mono text-meta">DATA OS</Badge>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* 地标放在导航内容上：coss Sidebar 在窄屏是抽屉，外层容器不渲染带语义的元素。 */}
        <nav aria-label="主导航" className="flex flex-col gap-2">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => item.key !== 'operations' || technicalAccess)
          if (items.length === 0) return null
          return (
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const Icon = item.icon
                    if (item.key === 'governance') {
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            isActive={governanceActive}
                            tooltip={item.label}
                            aria-current={governanceActive ? 'page' : undefined}
                            aria-expanded={collapsed ? undefined : governanceOpen}
                            onClick={() => (collapsed ? go(item.path) : onToggleGovernance())}
                          >
                            <Icon />
                            <span>{item.label}</span>
                            <ChevronDown className={cn('ml-auto transition-transform', governanceOpen && !collapsed && 'rotate-180')} />
                          </SidebarMenuButton>
                          {governanceOpen && !collapsed ? (
                            <SidebarMenuSub>
                              {governanceChildren.map((child) => {
                                const active = child.match(pathname)
                                return (
                                  <SidebarMenuSubItem key={child.path + child.label}>
                                    <SidebarMenuSubButton
                                      className="no-underline"
                                      isActive={active}
                                      aria-current={active ? 'page' : undefined}
                                      render={<a href={child.path} />}
                                      onClick={(event) => { event.preventDefault(); go(child.path) }}
                                    >
                                      {child.label}
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )
                              })}
                            </SidebarMenuSub>
                          ) : null}
                        </SidebarMenuItem>
                      )
                    }
                    const active = activeKey === item.key
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          className="no-underline"
                          isActive={active}
                          tooltip={item.label}
                          aria-current={active ? 'page' : undefined}
                          render={<a href={item.path} />}
                          onClick={(event) => { event.preventDefault(); go(item.path) }}
                        >
                          <Icon />
                          <span>{item.label}</span>
                          {item.key === 'mpi' && reviewPending > 0 ? <SidebarMenuBadge>{reviewPending}</SidebarMenuBadge> : null}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
        </nav>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-body-sm font-medium text-sidebar-primary-foreground">
                {(displayName ?? '医').slice(0, 1)}
              </span>
              <div className={cn('grid flex-1 text-left text-sm leading-tight', HIDE_WHEN_COLLAPSED)}>
                <span className="truncate font-medium">{displayName ?? '当前会话'}</span>
                <span className="truncate text-xs text-muted-foreground">数据运营门户</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {onLogout ? (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="退出登录" onClick={onLogout}>
                <LogOut />
                <span>退出登录</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-label={collapsed ? '展开主导航' : '收起主导航'}
              aria-expanded={!collapsed}
              tooltip={collapsed ? '展开主导航' : '收起主导航'}
              onClick={onToggleCollapse}
              className="hidden md:flex"
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              <span>收起导航</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** 品牌块（移动端页头复用）。 */
export function BrandMark() {
  return <Waypoints size={22} strokeWidth={1.35} aria-hidden="true" />
}

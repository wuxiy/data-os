import { useLocation } from '@tanstack/react-router'
import {
  Bell,
  ChevronDown,
  CircleHelp,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Waypoints,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RuntimeStatusBanner } from '../../components/ui/RuntimeStatusBanner'
import { Kbd } from '../../components/ui/panel'
import { Popover } from '../../components/ui/popover'
import { cn } from '../../lib/utils'
import { activeNavKey, governanceChildren, isGovernancePath, navGroups, routeForPath } from '../navigation'
import { usePortalNavigate } from '../navigate'
import { useAuth } from '../providers'
import { CommandPalette, useCommandHotkey } from './command-palette'
import { useVisitedTabs } from './visited-tabs'

/**
 * 新壳（批准原型 v0.2）：分组侧栏 + 48px 顶栏内页签 + 连续工作面。
 * 壳只消费 styles/tokens.css 的主题与自研组件；业务页面按路由懒加载挂载在 Outlet。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const pathname = location.pathname
  const navigate = usePortalNavigate()
  const { snapshot, logout, technicalAccess } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [governanceOpen, setGovernanceOpen] = useState(() => isGovernancePath(pathname))
  const { tabs, closeTab } = useVisitedTabs(pathname)

  useCommandHotkey(useCallback(() => setPaletteOpen(true), []))

  const route = routeForPath(pathname)
  useEffect(() => {
    document.title = `${route?.tabLabel ?? route?.label ?? '工作区'} · 医数中枢`
  }, [route?.label, route?.tabLabel])

  useEffect(() => {
    if (isGovernancePath(pathname)) setGovernanceOpen(true)
    setMobileOpen(false)
  }, [pathname])

  // 收起/展开与移动端抽屉不改变路由；Esc 只关移动端导航。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const activeKey = activeNavKey(pathname)
  const governanceActive = isGovernancePath(pathname)

  function go(path: string) {
    setMobileOpen(false)
    navigate(path)
  }

  function closeVisitedTab(path: string) {
    const index = tabs.findIndex((tab) => tab.path === path)
    closeTab(path)
    if (pathname === path) {
      const fallback = tabs[index - 1]?.path ?? '/'
      navigate(fallback)
    }
  }

  return (
    <div className="min-h-dvh" data-shell-collapsed={collapsed ? 'true' : 'false'}>
      <a
        href="#main-content"
        className="fixed top-[-100px] left-[280px] z-[100] rounded-control bg-blue px-[18px] py-2.5 text-white focus:top-2.5"
      >
        跳到主要内容
      </a>

      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        activeKey={activeKey}
        governanceOpen={governanceOpen}
        governanceActive={governanceActive}
        pathname={pathname}
        technicalAccess={technicalAccess}
        displayName={snapshot.displayName}
        onNavigate={go}
        onToggleGovernance={() => setGovernanceOpen((open) => !open)}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onCloseMobile={() => setMobileOpen(false)}
        onLogout={logout}
      />

      <div className="ml-0 min-h-[calc(100dvh-16px)] overflow-clip rounded-shell border border-[#e1e5eb] bg-paper m-2 lg:ml-[var(--shell-sidebar)]">
        <header className="sticky top-0 z-20 flex h-topbar items-center gap-3 border-b border-line bg-paper px-5">
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="打开主导航"
              onClick={() => setMobileOpen(true)}
              className="inline-flex size-8 items-center justify-center rounded-control text-[#67717f] hover:bg-[#f0f3f7] lg:hidden"
            >
              <Menu size={18} />
            </button>
            <button
              type="button"
              aria-label={collapsed ? '展开主导航' : '收起主导航'}
              aria-expanded={!collapsed}
              title="收起 / 展开导航"
              onClick={() => setCollapsed((value) => !value)}
              className="hidden size-8 items-center justify-center rounded-control text-[#67717f] hover:bg-[#f0f3f7] lg:inline-flex"
            >
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            <span aria-hidden="true" className="my-0.5 h-[17px] w-px bg-line" />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="搜索页面，Command K"
              className="flex items-center gap-2.5 rounded-control px-1 py-1 text-label text-[#77818d] hover:bg-wash"
            >
              <Search size={14} />
              <span className="hidden sm:inline">搜索页面</span>
              <Kbd>⌘ K</Kbd>
            </button>
          </div>

          <nav aria-label="已打开的页面" className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
            <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-control border border-line bg-wash p-0.5">
              {tabs.map((tab) => {
                const current = tab.path === pathname
                return (
                  <div
                    key={tab.path}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-chip px-1 pl-2.5 text-label',
                      current ? 'bg-paper text-blue shadow-focus' : 'text-[#727b88]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => go(tab.path)}
                      aria-current={current ? 'page' : undefined}
                      className="h-[27px] whitespace-nowrap"
                    >
                      {tab.path === '/' ? '总览' : tab.label}
                    </button>
                    {tab.closable ? (
                      <button
                        type="button"
                        aria-label={`关闭${tab.label}页签`}
                        onClick={() => closeVisitedTab(tab.path)}
                        className="inline-flex size-[18px] items-center justify-center rounded-chip opacity-65 hover:bg-[#e9edf2] hover:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </nav>

          <div className="flex shrink-0 items-center gap-2.5">
            <Popover
              align="end"
              trigger={<button type="button" aria-label="使用说明" title="使用说明" className="inline-flex size-8 items-center justify-center rounded-control text-[#67717f] hover:bg-[#f0f3f7]"><CircleHelp size={16} /></button>}
            >
              <p className="px-1 pb-1 text-label leading-relaxed text-[#5b6b80]">
                顶栏页签保留本会话打开过的页面。⌘/Ctrl K 可搜索页面；各工作区的检索、筛选与对象深链保存在地址栏。
              </p>
              <p className="px-1 pt-1 text-meta leading-relaxed text-[#8b94a1]">
                页面数据来自真实服务；演示数据只在显式演示构建中展示，不会补位真实失败。
              </p>
            </Popover>
            <Popover
              align="end"
              trigger={<button type="button" aria-label="查看待办入口" title="待办入口" className="relative inline-flex size-8 items-center justify-center rounded-control text-[#67717f] hover:bg-[#f0f3f7]"><Bell size={16} /><i aria-hidden="true" className="absolute top-1.5 right-1.5 size-[5px] rounded-full border border-paper bg-red" /></button>}
            >
              <strong className="block px-1 pb-1.5 text-label font-semibold text-ink">待办入口</strong>
              <button type="button" onClick={() => go('/governance/quality')} className="flex w-full items-center gap-2 rounded-chip px-1 py-1.5 text-left text-label hover:bg-wash">质量问题待闭环<span className="ml-auto text-meta text-[#8e98a8]">质量工作台</span></button>
              <button type="button" onClick={() => go('/mpi/review')} className="flex w-full items-center gap-2 rounded-chip px-1 py-1.5 text-left text-label hover:bg-wash">主索引人工复核<span className="ml-auto text-meta text-[#8e98a8]">复核队列</span></button>
              <button type="button" onClick={() => go('/operations-center')} className="flex w-full items-center gap-2 rounded-chip px-1 py-1.5 text-left text-label hover:bg-wash">跨域待办<span className="ml-auto text-meta text-[#8e98a8]">运营中心</span></button>
              <p className="px-1 pt-1.5 text-meta text-[#98a2ae]">此处只链接已有待办，不新增已读/未读中心。</p>
            </Popover>
            <Popover
              align="end"
              trigger={
                <button type="button" aria-label="当前账号" className="inline-flex size-[30px] items-center justify-center rounded-full bg-[#e2eafa] text-body-sm text-[#3761ad]">
                  {(snapshot.displayName ?? '医').slice(0, 1)}
                </button>
              }
            >
              <div className="px-1 pb-2">
                <strong className="block text-body-sm font-medium text-ink">{snapshot.displayName ?? '当前会话'}</strong>
                <span className="mt-0.5 block text-meta text-[#8b94a1]">{snapshot.status === 'disabled' ? '本地直连模式' : '统一身份认证'}</span>
              </div>
              {logout ? (
                <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-chip px-1 py-1.5 text-left text-label text-[#b44848] hover:bg-red-soft">
                  <LogOut size={14} />退出登录
                </button>
              ) : null}
            </Popover>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-h-[calc(100dvh-66px)] bg-shell px-6 pt-[17px] pb-3 max-[1320px]:px-5">
          <RuntimeStatusBanner />
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {mobileOpen ? <div aria-hidden="true" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-[#1a294531] lg:hidden" /> : null}
    </div>
  )
}

function Sidebar({
  collapsed,
  mobileOpen,
  activeKey,
  governanceOpen,
  governanceActive,
  pathname,
  technicalAccess,
  displayName,
  onNavigate,
  onToggleGovernance,
  onToggleCollapse,
  onCloseMobile,
  onLogout,
}: {
  collapsed: boolean
  mobileOpen: boolean
  activeKey: string
  governanceOpen: boolean
  governanceActive: boolean
  pathname: string
  technicalAccess: boolean
  displayName?: string
  onNavigate: (path: string) => void
  onToggleGovernance: () => void
  onToggleCollapse: () => void
  onCloseMobile: () => void
  onLogout?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <aside
      aria-label="主导航"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col bg-canvas px-3.5 pb-3 transition-transform duration-200 lg:z-30 lg:w-[var(--shell-sidebar)] lg:translate-x-0',
        collapsed ? 'lg:px-2.5' : '',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className={cn('flex h-16 shrink-0 items-center gap-[11px] px-2.5', collapsed && 'lg:justify-center lg:px-0')}>
        <span aria-hidden="true" className="grid grid-cols-2 gap-[3px]">
          <i className="size-2.5 rounded-[3px] bg-blue" /><i className="size-2.5 rounded-[3px] bg-blue" />
          <i className="size-2.5 rounded-[3px] bg-blue" /><i className="size-2.5 rounded-[3px] bg-blue" />
        </span>
        <strong className={cn('text-[19px] leading-none font-semibold tracking-[-0.5px]', collapsed && 'lg:hidden')}>医数中枢</strong>
        <small className={cn('ml-auto rounded-chip border border-line px-1 py-px text-[9px] font-medium text-muted', collapsed && 'lg:hidden')}>DATA OS</small>
        <button type="button" aria-label="关闭主导航" onClick={onCloseMobile} className="ml-auto inline-flex size-7 items-center justify-center rounded-control text-muted hover:bg-[#e9edf2] lg:hidden">
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => item.key !== 'operations' || technicalAccess)
          if (items.length === 0) return null
          return (
            <div key={group.title} className="pb-3.5">
              <div className={cn('px-[11px] pt-2.5 pb-[7px] text-label font-medium text-[#78818e]', collapsed && 'lg:hidden')}>{group.title}</div>
              {items.map((item) => {
                const Icon = item.icon
                if (item.key === 'governance') {
                  return (
                    <div key={item.key}>
                      <button
                        type="button"
                        onClick={onToggleGovernance}
                        aria-expanded={governanceOpen}
                        aria-current={governanceActive ? 'page' : undefined}
                        title={item.label}
                        className={cn(
                          'mb-[3px] flex min-h-9 w-full items-center gap-[11px] rounded-control px-[11px] py-[7px] text-left text-[#525b69] transition-colors hover:bg-[#e9edf2] hover:text-ink',
                          governanceActive && 'bg-[#e5edfc] font-semibold text-[#285fca]',
                          collapsed && 'lg:justify-center lg:px-2.5 lg:py-2.5',
                        )}
                      >
                        <Icon size={17} />
                        <span className={cn('min-w-0 flex-1 truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                        <ChevronDown size={14} className={cn('ml-auto shrink-0 transition-transform', governanceOpen && 'rotate-180', collapsed && 'lg:hidden')} />
                      </button>
                      {governanceOpen ? (
                        <div className={cn('mb-1 ml-[19px] border-l border-[#dce1e8] pl-3.5', collapsed && 'lg:hidden')}>
                          {governanceChildren.map((child) => {
                            const active = child.match(pathname)
                            return (
                              <a
                                key={child.path + child.label}
                                href={child.path}
                                onClick={(event) => { event.preventDefault(); onNavigate(child.path) }}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                  'mb-0.5 flex min-h-[30px] items-center rounded-control px-[9px] py-1 text-body-sm text-[#525b69] hover:bg-[#e9edf2]',
                                  active && 'bg-[#e5edfc] font-medium text-[#285fca]',
                                )}
                              >
                                {child.label}
                              </a>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                }
                const active = activeKey === item.key
                return (
                  <a
                    key={item.key}
                    href={item.path}
                    onClick={(event) => { event.preventDefault(); onNavigate(item.path) }}
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                    className={cn(
                      'mb-[3px] flex min-h-9 w-full items-center gap-[11px] rounded-control px-[11px] py-[7px] text-left text-[#525b69] transition-colors hover:bg-[#e9edf2] hover:text-ink',
                      active && 'bg-[#e5edfc] font-semibold text-[#285fca]',
                      collapsed && 'lg:justify-center lg:px-2.5 lg:py-2.5',
                    )}
                  >
                    <Icon size={17} />
                    <span className={cn('min-w-0 flex-1 truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                  </a>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className={cn('border-t border-[#e0e5ec] px-[7px] pb-1 pt-2.5', collapsed && 'lg:px-0')}>
        <div className={cn('flex items-center gap-2.5 px-2 pt-2', collapsed && 'lg:justify-center lg:px-0')}>
          <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#e2eafa] text-body-sm text-[#3761ad]">
            {(displayName ?? '医').slice(0, 1)}
          </span>
          <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}>
            <strong className="block truncate text-body-sm font-medium text-ink">{displayName ?? '当前会话'}</strong>
            <small className="block text-meta text-muted">数据运营门户</small>
          </div>
          {onLogout ? (
            <button type="button" onClick={onLogout} aria-label="退出登录" title="退出登录" className={cn('inline-flex size-7 items-center justify-center rounded-control text-muted hover:bg-[#e9edf2]', collapsed && 'lg:hidden')}>
              <LogOut size={15} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? '展开主导航' : '收起主导航'}
          aria-expanded={!collapsed}
          className={cn('mt-2 hidden w-full items-center gap-[11px] rounded-control px-[11px] py-[7px] text-left text-[#525b69] hover:bg-[#e9edf2] lg:flex', collapsed && 'justify-center px-2.5 py-2.5')}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          <span className={cn(collapsed && 'lg:hidden')}>收起导航</span>
        </button>
      </div>
    </aside>
  )
}

/** 品牌块（移动端页头复用）。 */
export function BrandMark() {
  return <Waypoints size={22} strokeWidth={1.35} aria-hidden="true" />
}

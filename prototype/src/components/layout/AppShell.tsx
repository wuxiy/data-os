import {
  Boxes,
  BrainCircuit,
  Cable,
  ChartNoAxesCombined,
  Database,
  Fingerprint,
  House,
  Landmark,
  Menu,
  MessageSquareText,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ServerCog,
  Waypoints,
  Workflow,
  X,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Tooltip } from 'antd'
import type { RouteKey } from '../../types'
import { RuntimeStatusBanner } from '../ui/RuntimeStatusBanner'
import styles from './AppShell.module.css'

interface NavItem {
  label: string
  icon: LucideIcon
  route?: RouteKey
  governanceGroup?: boolean
  group: string
}

const navItems: NavItem[] = [
  { label: '首页', icon: House, route: 'management', group: '工作概览' },
  { label: '运营中心', icon: Workflow, route: 'operationsCenter', group: '工作概览' },
  { label: '交付中心', icon: PackageCheck, route: 'deliveryCenter', group: '工作概览' },
  { label: '数据接入', icon: Cable, route: 'ingestion', group: '数据管理' },
  { label: '数据资产', icon: Database, route: 'assets', group: '数据管理' },
  { label: '数据治理', icon: Landmark, route: 'governance', governanceGroup: true, group: '数据管理' },
  { label: '主索引与主数据', icon: Fingerprint, route: 'mpi', group: '数据管理' },
  { label: '数据服务', icon: Boxes, route: 'dataServices', group: '数据应用' },
  { label: '分析看板', icon: ChartNoAxesCombined, route: 'analytics', group: '数据应用' },
  { label: 'AI Data', icon: BrainCircuit, route: 'aiData', group: '数据应用' },
  { label: '智能问数', icon: MessageSquareText, route: 'assistant', group: '数据应用' },
  { label: '平台运维', icon: ServerCog, route: 'operations', group: '平台管理' },
]

interface AppShellProps {
  route: RouteKey
  children: ReactNode
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  authDisplayName?: string
  onLogout?: () => void
  technicalAccess?: boolean
  onOpenCommand: () => void
}

export function AppShell({ route, children, onNavigate, onUnavailable, authDisplayName, onLogout, technicalAccess = false, onOpenCommand }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  const governanceActive = ['governance', 'standards', 'mapping', 'quality'].includes(route)
  const visibleItems = navItems.filter(item => item.route !== 'operations' || technicalAccess)
  const groups = [...new Set(visibleItems.map(item => item.group))]

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setNarrow(media.matches)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    media.addEventListener('change', update)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  function selectItem(item: NavItem) {
    setMobileOpen(false)
    if (item.route) {
      onNavigate(item.route)
      return
    }
    onUnavailable(item.label)
  }

  return (
    <div className={`${styles.shell} ${collapsed && !narrow ? styles.shellCollapsed : ''}`}>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>
      <header className={styles.mobileHeader}>
        <button className={styles.mobileMenu} onClick={() => setMobileOpen(true)} aria-label="打开主导航">
          <Menu size={22} />
        </button>
        <Brand />
      </header>

      <div
        className={`${styles.backdrop} ${mobileOpen ? styles.backdropVisible : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`} aria-label="主导航" inert={narrow && !mobileOpen}>
        <div className={styles.sidebarTop}>
          <Brand />
          <button className={styles.closeMobile} onClick={() => setMobileOpen(false)} aria-label="关闭主导航">
            <X size={20} />
          </button>
        </div>
        <Tooltip title={collapsed && !narrow ? '搜索页面' : undefined} placement="right" trigger={['hover', 'focus']}>
          <button className={styles.commandButton} onClick={onOpenCommand} aria-label="搜索页面">
            <Search size={17} strokeWidth={1.7} />
            <span>搜索页面</span><kbd>⌘ / Ctrl K</kbd>
          </button>
        </Tooltip>
        <nav className={styles.nav} aria-label="工作区">
          {groups.map(group => <div className={styles.navGroup} key={group}>
          <div className={styles.groupLabel}>{group}</div>
          {visibleItems.filter(item => item.group === group).map((item) => {
            const Icon = item.icon
            const isActive = item.governanceGroup
              ? governanceActive
              : item.route === 'assets'
                ? ['assets', 'assetTechnical'].includes(route)
                : item.route === 'assistant'
                  ? ['assistant', 'assistantWorkspace'].includes(route)
                  : item.route === route
            const content = <><Icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{!item.route ? <em className={styles.plannedLabel}>规划中</em> : null}</>
            return item.route ? (
              <Tooltip key={item.label} title={collapsed && !narrow ? item.label : undefined} placement="right" trigger={['hover', 'focus']}>
              <button
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                onClick={() => selectItem(item)}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
              >
                {content}
              </button>
              </Tooltip>
            ) : (
              <div
                key={item.label}
                className={`${styles.navItem} ${styles.navItemPlanned}`}
                aria-disabled="true"
                title={`${item.label} · 规划中`}
              >
                {content}
              </div>
            )
          })}
          </div>)}
        </nav>
        <div className={styles.sidebarBottom}>
          {authDisplayName && onLogout ? <div className={styles.authPanel}>
            <span className={styles.authName} title={authDisplayName}>{authDisplayName}</span>
            <button className={styles.logoutButton} onClick={onLogout} title="退出登录">
              <LogOut size={16} strokeWidth={1.7} />
              <span>退出登录</span>
            </button>
          </div> : null}
          <button className={styles.collapseButton} onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? '展开主导航' : '收起主导航'} aria-expanded={!collapsed}>
            {collapsed ? <PanelLeftOpen size={19} strokeWidth={1.7} /> : <PanelLeftClose size={19} strokeWidth={1.7} />}
            <span>收起导航</span>
          </button>
        </div>
      </aside>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <RuntimeStatusBanner />
        {children}
      </main>
    </div>
  )
}

function Brand() {
  return (
    <div className={styles.brand} aria-label="医数中枢">
      <Waypoints size={30} strokeWidth={1.7} aria-hidden="true" />
      <span>医数中枢</span>
    </div>
  )
}

import {
  Boxes,
  Cable,
  ChartNoAxesCombined,
  Database,
  Fingerprint,
  House,
  Landmark,
  Menu,
  MessageSquareText,
  PackageCheck,
  Settings,
  Waypoints,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { RouteKey } from '../../types'
import styles from './AppShell.module.css'

interface NavItem {
  label: string
  icon: LucideIcon
  route?: RouteKey
  governanceGroup?: boolean
}

const navItems: NavItem[] = [
  { label: '首页', icon: House, route: 'management' },
  { label: '数据接入', icon: Cable, route: 'ingestion' },
  { label: '数据资产', icon: Database, route: 'assets' },
  { label: '数据治理', icon: Landmark, route: 'governance', governanceGroup: true },
  { label: '主索引与主数据', icon: Fingerprint, route: 'mpi' },
  { label: '数据服务', icon: Boxes },
  { label: '分析看板', icon: ChartNoAxesCombined, route: 'analytics' },
  { label: '智能问数', icon: MessageSquareText, route: 'assistant' },
  { label: '运营中心', icon: Workflow },
  { label: '交付中心', icon: PackageCheck },
]

interface AppShellProps {
  route: RouteKey
  children: ReactNode
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
}

export function AppShell({ route, children, onNavigate, onUnavailable }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const governanceActive = ['governance', 'standards', 'mapping', 'quality'].includes(route)

  function selectItem(item: NavItem) {
    setMobileOpen(false)
    if (item.route) {
      onNavigate(item.route)
      return
    }
    onUnavailable(item.label)
  }

  return (
    <div className={styles.shell}>
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
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`} aria-label="主导航">
        <div className={styles.sidebarTop}>
          <Brand />
          <button className={styles.closeMobile} onClick={() => setMobileOpen(false)} aria-label="关闭主导航">
            <X size={20} />
          </button>
        </div>
        <nav className={styles.nav}>
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.governanceGroup ? governanceActive : item.route === route
            return (
              <button
                key={item.label}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                onClick={() => selectItem(item)}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
              >
                <Icon size={19} strokeWidth={1.5} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <button className={styles.settings} onClick={() => onUnavailable('系统设置')} title="系统设置">
          <Settings size={19} strokeWidth={1.5} />
          <span>系统设置</span>
        </button>
      </aside>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}

function Brand() {
  return (
    <div className={styles.brand} aria-label="医数中枢">
      <Waypoints size={30} strokeWidth={1.65} aria-hidden="true" />
      <span>医数中枢</span>
    </div>
  )
}

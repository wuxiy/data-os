import type { RouteKey } from '../../types'
import styles from './GovernanceTabs.module.css'

const tabs: { label: string; route?: RouteKey }[] = [
  { label: '治理驾驶舱', route: 'governance' },
  { label: '数据标准', route: 'standards' },
  { label: '标准映射', route: 'mapping' },
  { label: '数据质量', route: 'quality' },
  { label: '血缘与影响' },
  { label: '问题闭环' },
  { label: '数据合同' },
]

export function GovernanceTabs({ route, onNavigate, onUnavailable }: {
  route: RouteKey
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
}) {
  return (
    <nav className={styles.tabs} aria-label="数据治理子导航">
      {tabs.map((tab) => {
        const active = tab.route === route
        return tab.route ? (
          <button
            key={tab.label}
            className={active ? styles.active : ''}
            onClick={() => onNavigate(tab.route!)}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ) : (
          <span key={tab.label} className={`${styles.tab} ${styles.unavailable}`} aria-disabled="true" title="下一轮接入">
            {tab.label}<small>规划中</small>
          </span>
        )
      })}
    </nav>
  )
}

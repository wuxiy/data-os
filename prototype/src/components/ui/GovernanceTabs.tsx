import type { RouteKey } from '../../types'
import styles from './GovernanceTabs.module.css'

const tabs: { label: string; route: RouteKey }[] = [
  { label: '治理驾驶舱', route: 'governance' },
  { label: '数据标准', route: 'standards' },
  { label: '标准映射', route: 'mapping' },
  { label: '数据质量', route: 'quality' },
  // G23 治理工作台三入口：进入既有真实能力（资产技术视图自带资产筛选、
  // 质量问题工作台、数据服务合同视图），本导航不复制任何状态机
  { label: '血缘与影响', route: 'assetTechnical' },
  { label: '问题闭环', route: 'quality' },
  { label: '数据合同', route: 'dataServices' },
]

export function GovernanceTabs({ route, onNavigate }: {
  route: RouteKey
  onNavigate: (route: RouteKey) => void
  onUnavailable?: (label: string) => void
}) {
  return (
    <nav className={styles.tabs} aria-label="数据治理子导航">
      {tabs.map((tab) => {
        const active = tab.route === route
        return (
          <button
            key={tab.label}
            className={active ? styles.active : ''}
            onClick={() => onNavigate(tab.route)}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}

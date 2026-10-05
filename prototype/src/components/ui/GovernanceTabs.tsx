import type { RouteKey } from '../../types'
import styles from './GovernanceTabs.module.css'

const tabs: { label: string; route: RouteKey }[] = [
  { label: '治理驾驶舱', route: 'governance' },
  { label: '数据标准', route: 'standards' },
  { label: '标准映射', route: 'mapping' },
  // G23 治理工作台三入口：进入既有真实能力（资产技术视图自带资产筛选、
  // 质量问题工作台、数据服务合同视图），本导航不复制任何状态机。
  // 「问题闭环」入口曾与「数据质量」同指 quality 路由致双 aria-current
  // 高亮（2026-10-05 critique P1-4），收敛为单一入口。
  { label: '数据质量', route: 'quality' },
  { label: '血缘与影响', route: 'assetTechnical' },
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

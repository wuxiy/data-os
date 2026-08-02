import { ChevronRight } from 'lucide-react'
import { TrendChart } from '../components/charts/TrendChart'
import { ResponsibilityChain } from '../components/governance/ResponsibilityChain'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricStrip, StatusTag } from '../components/ui/Primitives'
import { governanceMetrics, riskRanking } from '../data/mock'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'

interface Props {
  onOpenChain: () => void
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

export function GovernanceDashboardPage({ onOpenChain, onNavigate, onUnavailable, onNotice }: Props) {
  return (
    <div className={styles.page}>
      <PageHeader title="治理驾驶舱" onFilterNotice={onNotice} />
      <GovernanceTabs route="governance" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <MetricStrip metrics={governanceMetrics} onSelect={onOpenChain} />
      <div className={styles.content}>
        <ResponsibilityChain onOpen={onOpenChain} />
        <div className={styles.twoColumns}>
          <TrendChart />
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>高风险系统排行</h2><p>按逾期与高危问题综合排序</p></div><button className={styles.textButton} onClick={() => onNavigate('quality')}>查看全部 <ChevronRight size={13} /></button></div>
            <ol className={styles.ranking}>
              {riskRanking.map(({ system, owner, value }, index) => <li key={system}><span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><div className={styles.rankBody}><strong>{system}</strong><span>{owner}</span></div><span className={styles.rankValue}>{value}</span></li>)}
            </ol>
          </section>
        </div>
        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}><div><h2>今日治理待办</h2><p>按 SLA 与影响范围排序</p></div><button className={styles.textButton} onClick={() => onNavigate('quality')}>进入质量闭环 <ChevronRight size={13} /></button></div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>问题</th><th>影响范围</th><th>责任部门</th><th>SLA</th><th>状态</th></tr></thead>
              <tbody>
                <tr className={styles.clickableRow} onClick={onOpenChain}><td>LIS 检验结果及时率下降</td><td>检验主题 / 38 张表</td><td>检验科</td><td>08-02 18:00</td><td><StatusTag tone="danger">逾期</StatusTag></td></tr>
                <tr><td>EMR 病历诊断规范映射缺失</td><td>病历主题 / 21 张表</td><td>病案室</td><td>08-02 18:00</td><td><StatusTag tone="danger">逾期</StatusTag></td></tr>
                <tr><td>手麻系统手术记录字段缺失</td><td>手术主题 / 12 张表</td><td>麻醉科</td><td>08-03 18:00</td><td><StatusTag tone="warning">即将到期</StatusTag></td></tr>
                <tr><td>病案首页关键字段值域不符</td><td>病案首页 / 9 张表</td><td>病案室</td><td>08-04 18:00</td><td><StatusTag tone="healthy">进行中</StatusTag></td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

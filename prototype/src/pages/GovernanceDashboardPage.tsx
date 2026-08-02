import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TrendChart } from '../components/charts/TrendChart'
import { ResponsibilityChain } from '../components/governance/ResponsibilityChain'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricStrip, StatusTag } from '../components/ui/Primitives'
import { fetchGovernanceSummary, type GovernanceApiIssue } from '../data/controlPlane'
import { governanceMetrics, riskRanking } from '../data/mock'
import type { Metric } from '../types'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'

interface Props {
  onOpenChain: () => void
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

export function GovernanceDashboardPage({ onOpenChain, onNavigate, onUnavailable, onNotice }: Props) {
  const [metrics, setMetrics] = useState<Metric[]>(governanceMetrics)
  const [issues, setIssues] = useState<GovernanceApiIssue[]>([])
  const [apiState, setApiState] = useState<'loading' | 'live' | 'fallback'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 2500)
    fetchGovernanceSummary(controller.signal)
      .then((summary) => {
        setMetrics(summary.metrics.map((metric) => ({
          label: metric.label,
          value: formatMetricValue(metric.value),
          unit: metric.unit,
          detail: metric.detail,
          tone: metric.tone,
        })))
        setIssues(summary.issues)
        setApiState('live')
      })
      .catch(() => setApiState('fallback'))
      .finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  return (
    <div className={styles.page}>
      <PageHeader title="治理驾驶舱" onFilterNotice={onNotice} />
      <GovernanceTabs route="governance" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <div className={styles.apiStatus} role="status" aria-live="polite">
        <span className={`${styles.apiDot} ${apiState === 'live' ? styles.apiDotLive : ''}`} />
        {apiState === 'loading' ? '正在连接治理控制面…' : apiState === 'live' ? '控制面已连接 · 指标与问题来自 PostgreSQL' : '演示数据 · 控制面暂不可用'}
      </div>
      <MetricStrip metrics={metrics} onSelect={onOpenChain} />
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
                {(issues.length > 0 ? issues : fallbackIssues).slice(0, 5).map((issue, index) => (
                  <tr className={index === 0 ? styles.clickableRow : undefined} onClick={index === 0 ? onOpenChain : undefined} key={issue.id}>
                    <td>{issue.title}</td>
                    <td>{issue.impact}</td>
                    <td>{issue.ownerDepartment}</td>
                    <td>{formatDueAt(issue.dueAt)}</td>
                    <td><StatusTag tone={issueTone(issue.status)}>{issueStatus(issue.status)}</StatusTag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

const fallbackIssues: GovernanceApiIssue[] = [
  { id: 'fallback-1', title: 'LIS 检验结果及时率下降', severity: 'HIGH', status: 'OVERDUE', datasetId: 'asset-lis', ruleId: 'rule-time', ownerDepartment: '检验科', ownerName: '检验科数据管理员', ticketId: 'TICKET-1', impact: '检验主题 / 38 张表', dueAt: '2026-08-02T18:00:00+08:00' },
  { id: 'fallback-2', title: 'EMR 病历诊断规范映射缺失', severity: 'HIGH', status: 'OVERDUE', datasetId: 'asset-emr', ruleId: 'rule-code', ownerDepartment: '病案室', ownerName: '病案室数据管理员', ticketId: 'TICKET-2', impact: '病历主题 / 21 张表', dueAt: '2026-08-02T18:00:00+08:00' },
  { id: 'fallback-3', title: '手麻系统手术记录字段缺失', severity: 'MEDIUM', status: 'IN_PROGRESS', datasetId: 'asset-surgery', ruleId: 'rule-fields', ownerDepartment: '麻醉科', ownerName: '麻醉科数据管理员', ticketId: 'TICKET-3', impact: '手术主题 / 12 张表', dueAt: '2026-08-03T18:00:00+08:00' },
  { id: 'fallback-4', title: '病案首页关键字段值域不符', severity: 'MEDIUM', status: 'IN_PROGRESS', datasetId: 'asset-home', ruleId: 'rule-domain', ownerDepartment: '病案室', ownerName: '病案室数据管理员', ticketId: 'TICKET-4', impact: '病案首页 / 9 张表', dueAt: '2026-08-04T18:00:00+08:00' },
]

function formatMetricValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatDueAt(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace('/', '-').replace('/', ' ')
}

function issueTone(status: string): 'danger' | 'warning' | 'healthy' | 'neutral' {
  if (status === 'OVERDUE') return 'danger'
  if (status === 'IN_PROGRESS' || status === 'PENDING') return 'warning'
  if (status === 'CLOSED') return 'healthy'
  return 'neutral'
}

function issueStatus(status: string) {
  return { OVERDUE: '逾期', IN_PROGRESS: '进行中', PENDING: '待处理', CLOSED: '已关闭' }[status] ?? status
}

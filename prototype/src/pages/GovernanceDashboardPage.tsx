import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TrendChart } from '../components/charts/TrendChart'
import { ResponsibilityChain } from '../components/governance/ResponsibilityChain'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricStrip, StatusTag } from '../components/ui/Primitives'
import { fetchGovernanceSummary, type GovernanceApiIssue } from '../data/controlPlane'
import { formatDateTime, issueStatusLabel, issueStatusTone } from '../data/domain'
import { frontendDemoMode, showStaticSamples } from '../data/runtimeMode'
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
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [issues, setIssues] = useState<GovernanceApiIssue[]>([])
  const [asOf, setAsOf] = useState<string | null>(null)
  const [apiState, setApiState] = useState<'loading' | 'live' | 'unavailable'>('loading')

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
        setAsOf(formatDateTime(summary.asOf))
        setApiState('live')
      })
      .catch(() => {
        setAsOf(null)
        setApiState('unavailable')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  return (
    <div className={styles.page}>
      <PageHeader title="治理驾驶舱" asOf={apiState === 'live' ? asOf : null} />
      <GovernanceTabs route="governance" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <div className={styles.apiStatus} role="status" aria-live="polite">
        <span className={`${styles.apiDot} ${apiState === 'live' ? styles.apiDotLive : ''}`} />
        {apiState === 'loading' ? '正在连接治理控制面…' : apiState === 'live' ? '控制面已连接 · 指标与问题来自 PostgreSQL' : '控制面暂不可用 · 未加载真实治理指标或问题'}
      </div>
      {apiState === 'unavailable' ? <div className={styles.connectionNotice} role="alert"><div><strong>治理控制面不可用</strong><span>为避免误导，当前没有展示本地演示指标或问题。请恢复控制面后重新连接。</span></div><button className={styles.secondaryButton} onClick={() => window.location.reload()}>重新连接</button></div> : null}
      <MetricStrip metrics={metrics} onSelect={showStaticSamples(apiState) ? onOpenChain : undefined} />
      <div className={styles.content}>
        {showStaticSamples(apiState) ? <ResponsibilityChain onOpen={onOpenChain} /> : <div className={styles.connectionNotice} role="status"><div><strong>{apiState === 'unavailable' ? '责任链暂不可用' : '责任链详情待接入真实溯源服务'}</strong><span>{apiState === 'unavailable' ? '控制面未返回真实治理数据，静态责任链样例已关闭。' : '当前仅展示控制面真实指标和问题队列；静态责任链样例已关闭。'}</span></div></div>}
        <div className={styles.twoColumns}>
          {showStaticSamples(apiState) ? <TrendChart /> : <section className={styles.panel}><div className={styles.panelHeader}><div><h2>治理趋势</h2><p>等待指标时序 API 接入</p></div></div><div className={styles.emptyRow}>{apiState === 'unavailable' ? '控制面不可用，未加载趋势数据' : '当前版本不展示静态趋势样例'}</div></section>}
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>高风险系统排行</h2><p>按逾期与高危问题综合排序</p></div><button className={styles.textButton} onClick={() => onNavigate('quality')}>查看全部 <ChevronRight size={13} /></button></div>
            <ol className={styles.ranking}>
              {riskRankingFromIssues(issues).map(({ system, owner, value }, index) => <li key={system}><span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><div className={styles.rankBody}><strong>{system}</strong><span>{owner}</span></div><span className={styles.rankValue}>{value}</span></li>)}
              {apiState === 'live' && issues.length === 0 ? <li className={styles.emptyRow}>当前机构暂无高风险问题</li> : null}
            </ol>
          </section>
        </div>
        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}><div><h2>今日治理待办</h2><p>按 SLA 与影响范围排序</p></div><button className={styles.textButton} onClick={() => onNavigate('quality')}>进入质量闭环 <ChevronRight size={13} /></button></div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>问题</th><th>影响范围</th><th>责任部门</th><th>SLA</th><th>状态</th></tr></thead>
              <tbody>
                {issues.slice(0, 5).map((issue, index) => (
                  <tr className={index === 0 && frontendDemoMode ? styles.clickableRow : undefined} onClick={index === 0 && frontendDemoMode ? onOpenChain : undefined} key={issue.id}>
                    <td>{issue.title}</td>
                    <td>{issue.impact}</td>
                    <td>{issue.ownerDepartment}</td>
                    <td>{formatDateTime(issue.dueAt)}</td>
                    <td><StatusTag tone={issueStatusTone(issue.status)}>{issueStatusLabel(issue.status)}</StatusTag></td>
                  </tr>
                ))}
                {apiState === 'live' && issues.length === 0 ? <tr><td colSpan={5} className={styles.emptyRow}>当前机构暂无待办问题</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function formatMetricValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function riskRankingFromIssues(issues: GovernanceApiIssue[]) {
  return issues.slice(0, 4).map((issue) => ({
    system: issue.datasetId,
    owner: issue.ownerDepartment,
    value: issue.status === 'OVERDUE' ? '逾期' : '1',
  }))
}


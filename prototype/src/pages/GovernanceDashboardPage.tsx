import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useApiResource } from '../hooks/useApiResource'
import { TrendChart } from '../components/charts/TrendChart'
import { ResponsibilityChain } from '../components/governance/ResponsibilityChain'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricStrip, StatusTag } from '../components/ui/Primitives'
import { fetchGovernanceSummary, type GovernanceApiIssue } from '../data/controlPlane'
import { QualityScorePanel } from './QualityScorePanel'
import { formatDateTime, issueStatusLabel, issueStatusTone } from '../data/domain'
import { routePaths } from '../data/routes'
import { frontendDemoMode, showStaticSamples } from '../data/runtimeMode'
import type { Metric } from '../types'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'
import pageStyles from './GovernanceDashboardPage.module.css'

interface Props {
  onOpenChain: () => void
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

export function GovernanceDashboardPage({ onOpenChain, onNavigate, onUnavailable, onNotice }: Props) {
  // 待办行整行可点（critique P1-3）：真实模式深链到质量闭环并预选问题；
  // 演示模式维持打开责任链样例。pushState + popstate 与 App 既有路由监听同源。
  function openIssue(issue: GovernanceApiIssue) {
    if (frontendDemoMode) {
      onOpenChain()
      return
    }
    window.history.pushState({}, '', `${routePaths.quality}?issue=${encodeURIComponent(issue.id)}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  // 指标卡深链（2026-10-05 复评）：真实模式下有详情的指标直接进入对应工作台。
  const openMetricTarget = (metric: Metric) => {
    const route = METRIC_ROUTES[metric.label]
    if (route) onNavigate(route)
  }
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [issues, setIssues] = useState<GovernanceApiIssue[]>([])
  const [asOf, setAsOf] = useState<string | null>(null)
  const chainTodo = todaysIssues(issues)[0] ?? null
  const apiState = useApiResource({
    timeoutMs: 2500,
    load: (signal) => fetchGovernanceSummary(signal),
    onData: (summary) => {
      setMetrics(summary.metrics.map((metric) => ({
        label: metric.label,
        value: formatMetricValue(metric.value),
        unit: metric.unit,
        detail: metric.detail,
        tone: metric.tone,
      })))
      setIssues(summary.issues)
      setAsOf(formatDateTime(summary.asOf))
    },
    onUnavailable: () => setAsOf(null),
  })

  return (
    <div className={styles.page}>
      <PageHeader title="治理驾驶舱" asOf={apiState === 'live' ? asOf : null} />
      <GovernanceTabs route="governance" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <div className={styles.apiStatus} role="status" aria-live="polite">
        <span className={`${styles.apiDot} ${apiState === 'live' ? styles.apiDotLive : ''}`} />
        {apiState === 'loading' ? '正在连接治理控制面…' : apiState === 'live' ? '控制面已连接 · 数据来自治理控制面' : '控制面暂不可用 · 未加载真实治理指标或问题'}
      </div>
      {apiState === 'unavailable' ? <div className={styles.connectionNotice} role="alert"><div><strong>治理控制面不可用</strong><span>为避免误导，当前没有展示本地演示指标、问题或责任链样例。请恢复控制面后重新连接。</span></div><button className={styles.secondaryButton} onClick={() => window.location.reload()}>重新连接</button></div> : null}
      <div className={styles.content}>
        {/* 指标带收进 .content（2026-10-06 对齐收敛）：原挂在 content 外导致满宽出血、
            左缘与下方 24px 内边距内容不齐。 */}
        <MetricStrip metrics={metrics} onSelect={showStaticSamples(apiState) ? onOpenChain : apiState === 'live' ? openMetricTarget : undefined} />
        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}><div><h2>治理待办</h2><p>未闭环问题按 SLA 截止时间排序</p></div><button className={styles.textButton} onClick={() => onNavigate('quality')}>进入质量闭环 <ChevronRight size={13} /></button></div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>问题</th><th>影响范围</th><th>责任部门</th><th>SLA</th><th>状态</th></tr></thead>
              <tbody>
                {todaysIssues(issues).map((issue) => (
                  <tr
                    key={issue.id}
                    className={styles.clickableRow}
                    onClick={() => openIssue(issue)}
                    tabIndex={0}
                    role="button"
                    aria-label={`打开问题：${issue.title}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openIssue(issue)
                      }
                    }}
                  >
                    <td>{issue.title}{isIssueOverdue(issue) ? <span className={styles.overdueMark}>SLA 逾期</span> : null}</td>
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
        {/* 责任链全宽置于待办之下（2026-10-06 对齐收敛）：责任链是视觉记忆点，
            不再压进 0.85fr 窄列；真实模式认领质量工作台证据链，副题不重复正文，
            深链收进 panelHeader 右侧。 */}
        {showStaticSamples(apiState) ? <ResponsibilityChain onOpen={onOpenChain} /> : (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><h2>治理责任链 · v1</h2><p>影响范围 → 规则证据 → 复检批次 → 责任人通知 → 责任归属</p></div>
              {chainTodo
                ? <button className={styles.textButton} onClick={() => openIssue(chainTodo)}>打开 {chainTodo.id} 的责任链 <ChevronRight size={13} /></button>
                : <button className={styles.textButton} onClick={() => onNavigate('quality')}>前往质量问题工作台 <ChevronRight size={13} /></button>}
            </div>
          </section>
        )}
        <div className={styles.twoColumns}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>高风险系统排行</h2><p>按逾期与高危问题综合排序</p></div><button className={styles.textButton} onClick={() => onNavigate('quality')}>查看全部 <ChevronRight size={13} /></button></div>
            <ol className={styles.ranking}>
              {riskRankingFromIssues(issues).map(({ system, owner, value, overdue }, index) => <li key={system}><span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><div className={styles.rankBody}><strong>{system}</strong><span>{owner}</span></div><span className={`${styles.rankValue} ${overdue > 0 ? pageStyles.overdueValue : ''}`}>{value}</span></li>)}
              {apiState === 'live' && issues.length === 0 ? <li className={styles.emptyRow}>当前机构暂无高风险问题</li> : null}
            </ol>
          </section>
          {/* 真实模式趋势是死面板（只渲染一句「不展示静态样例」），未接入时整块不渲染；
              双栏在真实模式退化为排行 + 质量评分，演示模式为排行 + 趋势图。 */}
          {showStaticSamples(apiState) ? <TrendChart /> : <QualityScorePanel onNotice={onNotice} />}
        </div>
        {showStaticSamples(apiState) ? <QualityScorePanel onNotice={onNotice} /> : null}
      </div>
    </div>
  )
}

/** 指标卡 → 工作台路由：标签来自治理摘要 API（2026-10-05 复评，以 dev 实际标签为准）。 */
const METRIC_ROUTES: Record<string, RouteKey> = {
  标准覆盖率: 'standards',
  质量规则通过率: 'quality',
  问题按时闭环率: 'quality',
  血缘完整率: 'assetTechnical',
  标准映射覆盖: 'mapping',
  有效数据合同: 'dataServices',
}

function formatMetricValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** SLA 逾期按截止时间判定（critique P1-3）：状态机里 slaOverdueAt 已逾期但
 * 状态仍是 RETURNED/PENDING 的行，此前永远不被计入。 */
function isIssueOverdue(issue: GovernanceApiIssue, now = Date.now()): boolean {
  if (issue.status === 'CLOSED' || !issue.dueAt) return false
  const due = new Date(issue.dueAt).getTime()
  return !Number.isNaN(due) && due < now
}

/** 治理待办：过滤已闭环，按 SLA 截止时间升序（最紧急在前），最多 5 条。 */
function todaysIssues(issues: GovernanceApiIssue[]) {
  return issues
    .filter((issue) => issue.status !== 'CLOSED')
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
    .slice(0, 5)
}

/** 数据集业务口径：取影响范围的「主题」段（如「检验主题 / 38 张表」→ 检验主题），
 * 没有主题信息时回落 datasetId——不再把工程标识当系统名直出（critique P1-3）。 */
function datasetDisplay(issue: GovernanceApiIssue): string {
  const topic = (issue.impact || '').split('/')[0]?.trim()
  return topic || issue.datasetId || '未标注数据集'
}

/** 高风险系统排行：按数据集聚合未闭环问题计数（逾期优先），不展示无来源的占位值。 */
function riskRankingFromIssues(issues: GovernanceApiIssue[]) {
  const bySystem = new Map<string, { system: string; owner: string; count: number; overdue: number }>()
  for (const issue of issues) {
    if (issue.status === 'CLOSED') continue
    const entry = bySystem.get(issue.datasetId) ?? { system: datasetDisplay(issue), owner: issue.ownerDepartment, count: 0, overdue: 0 }
    entry.count += 1
    if (isIssueOverdue(issue)) entry.overdue += 1
    bySystem.set(issue.datasetId, entry)
  }
  return Array.from(bySystem.values())
    .sort((a, b) => (b.overdue - a.overdue) || (b.count - a.count))
    .slice(0, 4)
    .map(({ system, owner, count, overdue }) => ({
      system,
      owner,
      overdue,
      value: overdue > 0 ? `${count} 项 · ${overdue} 逾期` : `${count} 项`,
    }))
}


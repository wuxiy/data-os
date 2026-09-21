import { Activity, ChevronRight, CloudCog, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, MetricStrip, StatusTag } from '../components/ui/Primitives'
import type { Metric, Tone } from '../types'
import {
  fetchOperationsEvents,
  fetchOperationsSummary,
  fetchWorkItems,
  type OperationsEventItem,
  type OperationsSummary,
  type OperationsWorkItem,
} from '../data/operationsApi'
import { useApiResource } from '../hooks/useApiResource'
import styles from './Pages.module.css'

/**
 * 管理驾驶舱（G24 真实链路）：指标全部来自运营只读投影（/api/v1/operations），
 * 每项可下钻到责任工作台；组件覆盖数（ready/total）如实展示，不再以三个探针
 * 代表全平台。API 不可用时显示真实不可用态，不回静态样例。
 */

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

const DEEP_LINK_ROUTES: Record<string, 'ingestion' | 'governance' | 'mpi' | 'aiData' | 'dataServices'> = {
  '/ingestion': 'ingestion',
  '/governance': 'governance',
  '/mpi': 'mpi',
  '/ai-data': 'aiData',
  '/data-services': 'dataServices',
}

function severityTone(severity: string): Tone {
  if (severity === 'CRITICAL') return 'danger' as const
  if (severity === 'HIGH') return 'warning' as const
  return 'neutral' as const
}

function countTone(value: number, warnAt: number, dangerAt = Number.POSITIVE_INFINITY): Tone | undefined {
  if (value >= dangerAt) return 'danger'
  if (value >= warnAt) return 'warning'
  return undefined
}

export function ManagementDashboardLive(
  { onNotice, onNavigate }: { onNotice: (message: string) => void; onNavigate: (route: 'ingestion' | 'governance' | 'mpi' | 'aiData' | 'dataServices') => void },
) {
  const [summary, setSummary] = useState<OperationsSummary | null>(null)
  const [workItems, setWorkItems] = useState<OperationsWorkItem[]>([])
  const [events, setEvents] = useState<OperationsEventItem[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  const summaryState = useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchOperationsSummary(signal),
    onData: setSummary,
    onUnavailable: () => setSummary(null),
  })
  const workItemsState = useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchWorkItems(signal, ''),
    onData: setWorkItems,
    onUnavailable: () => setWorkItems([]),
  })
  const eventsState = useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchOperationsEvents(signal),
    onData: setEvents,
    onUnavailable: () => setEvents([]),
  })

  const metrics: Metric[] = useMemo(() => {
    if (!summary) return []
    const domains = summary.domains
    return [
      { label: '采集失败（24h）', value: String(domains.ingestion.failedRuns), detail: `停滞运行 ${domains.ingestion.stalledRuns} 个`, tone: countTone(domains.ingestion.failedRuns, 1) },
      { label: '治理待办', value: String(domains.governance.openIssues), detail: `SLA 逾期 ${domains.governance.slaOverdue} 项`, tone: countTone(domains.governance.openIssues, 1, 5) },
      { label: '通知积压', value: String(domains.notifications.backlog), detail: '发件箱待投递/失败', tone: countTone(domains.notifications.backlog, 1) },
      { label: '合同投递积压', value: String(domains.contracts.deliveryBacklog), detail: '调用方 webhook 待投递', tone: countTone(domains.contracts.deliveryBacklog, 1) },
      domains.mpi.availability === 'UP'
        ? { label: 'MPI 待复核', value: String(domains.mpi.reviewPending), detail: '患者主索引候选对', tone: countTone(domains.mpi.reviewPending, 1, 20) }
        : { label: 'MPI 待复核', value: '—', detail: `依赖状态：${domains.mpi.availability}`, tone: 'neutral' as Tone },
      { label: '数据服务调用失败（24h）', value: String(domains.dataApi.failedCalls24h), detail: 'HTTP ≥ 400 的调用', tone: countTone(domains.dataApi.failedCalls24h, 1, 20) },
      { label: 'AI 构建任务', value: String(domains.aiData.activeBuilds), detail: `24h 失败 ${domains.aiData.failedBuilds24h} 个`, tone: countTone(domains.aiData.failedBuilds24h, 1) },
    ]
  }, [summary])

  const topItems = useMemo(
    () => [...workItems].sort((left, right) =>
      (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9)).slice(0, 8),
    [workItems])

  if (summaryState === 'unavailable') {
    return (
      <div className={styles.page}>
        <PageHeader title="医院数据运营总览" eyebrow="管理驾驶舱" subtitle="以结果、风险和交付进展为中心" />
        <div className={styles.content}>
          <section className={styles.panel} role="status">
            <div className={styles.panelHeader}><h2>运营投影暂不可用</h2></div>
            <p className={styles.emptyState}>控制面运营摘要不可达，暂无法展示真实指标；本页不显示静态回退。</p>
            <Button onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />重试</Button>
          </section>
        </div>
      </div>
    )
  }

  const components = summary?.components

  return (
    <div className={styles.page}>
      <PageHeader
        title="医院数据运营总览" eyebrow="管理驾驶舱" subtitle="以结果、风险和交付进展为中心"
        asOf={summary?.asOf}
      />
      <div className={styles.content}>
        {metrics.length > 0 ? <MetricStrip metrics={metrics} /> : <p className={styles.emptyState}>正在加载运营指标…</p>}

        <section className={styles.attention}>
          <div className={styles.attentionText}>
            <Activity size={21} />
            <div>
              <h2>组件覆盖 {components ? `${components.ready}/${components.total}` : '—'} · {components?.state === 'READY' ? '全部就绪' : components?.state === 'DEGRADED' ? '存在降级' : '状态未知'}</h2>
              <p>覆盖 {components ? `${components.ready} 就绪 / ${components.degraded} 降级 / ${components.unknown} 未知` : '…'}；平台组件明细在「平台运维」。</p>
            </div>
          </div>
          <div className={styles.panelHeaderActions}>
            <StatusTag tone={components?.state === 'READY' ? 'healthy' : components?.state === 'DEGRADED' ? 'warning' : 'neutral'}>
              {components?.state ?? 'UNKNOWN'}
            </StatusTag>
            <Button variant="quiet" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />刷新</Button>
          </div>
        </section>

        <div className={styles.twoColumns}>
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}>
              <div><h2>优先处理</h2><p>共 {workItems.length} 项跨域待办 · 按严重度排序 · 完整清单在运营中心</p></div>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead><tr><th>严重度</th><th>待办</th><th>来源</th><th>更新时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {workItemsState === 'loading' ? <tr className={styles.emptyRow}><td colSpan={5}>正在加载待办…</td></tr> : null}
                  {workItemsState === 'live' && topItems.length === 0 ? <tr className={styles.emptyRow}><td colSpan={5}>当前没有待处理的跨域事项。</td></tr> : null}
                  {topItems.map((item) => (
                    <tr key={`${item.sourceType}-${item.sourceId}`}>
                      <td><StatusTag tone={severityTone(item.severity)}>{item.severity}</StatusTag></td>
                      <td>{item.title}</td>
                      <td className={styles.inlineCode}>{item.sourceType}:{item.sourceId.slice(0, 12)}</td>
                      <td><small>{item.asOf}</small></td>
                      <td>
                        <Button variant="quiet" onClick={() => {
                          const route = DEEP_LINK_ROUTES[item.deepLink]
                          if (route) {
                            onNavigate(route)
                          } else {
                            onNotice(`暂无门户路由对应 ${item.deepLink}`)
                          }
                        }}>进入工作台 <ChevronRight size={13} /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>最近事件</h2><p>跨域操作留痕</p></div>
            <ul className={styles.timelineBody}>
              {eventsState === 'loading' ? <li className={styles.emptyState}>正在加载事件…</li> : null}
              {events.slice(0, 10).map((event, index) => (
                <li key={`${event.domain}-${index}`}>
                  <div className={styles.timelineTitle}><strong>{event.domain} · {event.type}</strong><span>{event.asOf}</span></div>
                  <p>{event.detail}</p>
                </li>
              ))}
              {eventsState === 'live' && events.length === 0 ? <li className={styles.emptyState}>近 48 小时无跨域事件。</li> : null}
            </ul>
            <p className={styles.emptyState}><CloudCog size={13} /> 事件与待办同源于运营投影，两处口径一致。</p>
          </section>
        </div>
      </div>
    </div>
  )
}

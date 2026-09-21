import { ChevronRight, ClipboardList, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  fetchOperationsEvents,
  fetchOperationsSummary,
  fetchWorkItems,
  WORK_ITEM_TYPES,
  type OperationsEventItem,
  type OperationsSummary,
  type OperationsWorkItem,
} from '../data/operationsApi'
import { frontendDemoMode } from '../data/runtimeMode'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import styles from './Pages.module.css'

/**
 * 运营中心（G24）：面向治理负责人的跨域待办与事件流，与管理驾驶舱共用
 * 运营投影事实源（每项带来源与深链）；「平台运维」继续面向技术角色看组件
 * 探针，两者不合并。演示构建保留显式样例；真实构建不回静态数据。
 */

const DEEP_LINK_ROUTES: Record<string, 'ingestion' | 'governance' | 'mpi' | 'aiData' | 'dataServices'> = {
  '/ingestion': 'ingestion',
  '/governance': 'governance',
  '/mpi': 'mpi',
  '/ai-data': 'aiData',
  '/data-services': 'dataServices',
}

const TYPE_LABEL: Record<string, string> = {
  INGESTION_FAILED_RUN: '采集失败',
  INGESTION_STALLED_RUN: '采集停滞',
  GOVERNANCE_ISSUE: '治理问题',
  NOTIFICATION_BACKLOG: '通知积压',
  CONTRACT_DELIVERY_BACKLOG: '合同投递积压',
  DATA_API_FAILURES: '数据服务失败',
  AI_BUILD_FAILED: 'AI 构建失败',
  MPI_REVIEW_PENDING: 'MPI 待复核',
}

function severityTone(severity: string) {
  if (severity === 'CRITICAL') return 'danger' as const
  if (severity === 'HIGH') return 'warning' as const
  return 'neutral' as const
}

export function OperationsCenterPage(
  { onNotice, onNavigate }: { onNotice: (message: string) => void; onNavigate: (route: 'ingestion' | 'governance' | 'mpi' | 'aiData' | 'dataServices') => void },
) {
  if (frontendDemoMode) {
    return (
      <div className={styles.page}>
        <PageHeader title="运营中心" eyebrow="跨域运营" subtitle="治理负责人的跨域待办与事件流" />
        <div className={styles.content}>
          <DemoDataBoundary moduleName="运营中心">
            <section className={styles.panel}>
              <div className={styles.panelHeader}><h2>演示样例</h2><p>真实构建将展示采集/治理/通知/合同/MPI/数据服务/AI 构建的跨域待办</p></div>
              <p className={styles.emptyState}>接入运营投影后，此处按类型筛选展示全部待办并支持深链下钻。</p>
            </section>
          </DemoDataBoundary>
        </div>
      </div>
    )
  }
  return <OperationsCenterLive onNotice={onNotice} onNavigate={onNavigate} />
}

function OperationsCenterLive(
  { onNotice, onNavigate }: { onNotice: (message: string) => void; onNavigate: (route: 'ingestion' | 'governance' | 'mpi' | 'aiData' | 'dataServices') => void },
) {
  const [typeFilter, setTypeFilter] = useState('')
  const [summary, setSummary] = useState<OperationsSummary | null>(null)
  const [workItems, setWorkItems] = useState<OperationsWorkItem[]>([])
  const [events, setEvents] = useState<OperationsEventItem[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchOperationsSummary(signal),
    onData: setSummary,
    onUnavailable: () => setSummary(null),
  })
  const workItemsState = useApiResource({
    timeoutMs: 15000,
    reloadKey: `${typeFilter}|${reloadKey}`,
    load: (signal) => fetchWorkItems(signal, typeFilter),
    onData: setWorkItems,
    onUnavailable: () => setWorkItems([]),
  })
  useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchOperationsEvents(signal),
    onData: setEvents,
    onUnavailable: () => setEvents([]),
  })

  const paged = usePaged(workItems, 12)
  const presentTypes = useMemo(
    () => WORK_ITEM_TYPES.filter((type) => workItems.some((item) => item.type === type)),
    [workItems])

  if (workItemsState === 'unavailable' && !summary) {
    return (
      <div className={styles.page}>
        <PageHeader title="运营中心" eyebrow="跨域运营" subtitle="治理负责人的跨域待办与事件流" />
        <div className={styles.content}>
          <section className={styles.panel} role="status">
            <div className={styles.panelHeader}><h2>运营投影暂不可用</h2></div>
            <p className={styles.emptyState}>控制面运营待办不可达；本页不显示静态回退。</p>
            <Button onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />重试</Button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="运营中心" eyebrow="跨域运营" subtitle="治理负责人的跨域待办与事件流（组件探针在平台运维）"
        asOf={summary?.asOf}
      />
      <div className={styles.content}>
        <div className={styles.listTools}>
          <label>
            类型筛选
            <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); paged.setPage(0) }} aria-label="按待办类型筛选">
              <option value="">全部类型</option>
              {WORK_ITEM_TYPES.map((type) => (
                <option key={type} value={type}>{TYPE_LABEL[type] ?? type}</option>
              ))}
            </select>
          </label>
          <span className={styles.pagerInfo}>共 {workItems.length} 项{presentTypes.length > 0 ? ` · 当前数据含 ${presentTypes.length} 类` : ''}</span>
          <Button variant="quiet" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />刷新</Button>
        </div>

        <div className={styles.twoColumns}>
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}>
              <div><h2>跨域待办</h2><p>每项可下钻到责任工作台 · 与管理驾驶舱同源</p></div>
              <ClipboardList size={16} aria-hidden="true" />
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead><tr><th>类型</th><th>严重度</th><th>待办</th><th>来源</th><th>更新时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {workItemsState === 'loading' ? <tr className={styles.emptyRow}><td colSpan={6}>正在加载待办…</td></tr> : null}
                  {workItemsState === 'live' && paged.paged.length === 0 ? <tr className={styles.emptyRow}><td colSpan={6}>该筛选下暂无待办。</td></tr> : null}
                  {paged.paged.map((item) => (
                    <tr key={`${item.sourceType}-${item.sourceId}`}>
                      <td>{TYPE_LABEL[item.type] ?? item.type}</td>
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
                        }}>下钻 <ChevronRight size={13} /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paged.pageCount > 1 ? (
              <div className={styles.pagerControls}>
                <Button variant="quiet" disabled={paged.page === 0} onClick={() => paged.setPage(paged.page - 1)}>上一页</Button>
                <span className={styles.pagerInfo}>{paged.page + 1} / {paged.pageCount}</span>
                <Button variant="quiet" disabled={paged.page >= paged.pageCount - 1} onClick={() => paged.setPage(paged.page + 1)}>下一页</Button>
              </div>
            ) : null}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>事件流</h2><p>标准/合同/AI 构建/通知留痕</p></div>
            <ul className={styles.timelineBody}>
              {events.length === 0 ? <li className={styles.emptyState}>近 48 小时无跨域事件。</li> : null}
              {events.map((event, index) => (
                <li key={`${event.domain}-${index}`}>
                  <div className={styles.timelineTitle}><strong>{event.domain} · {event.type}</strong><span>{event.asOf}</span></div>
                  <p>{event.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

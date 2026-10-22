import { ChevronRight, ClipboardList, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Select, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { PageHeader } from '../components/ui/PageHeader'
import {
  fetchOperationsEvents,
  fetchOperationsSummary,
  fetchWorkItems,
  WORK_ITEM_TYPES,
  type OperationsEventItem,
  type OperationsSummary,
  type OperationsWorkItem,
} from '../data/operationsApi'
import { formatDateTime } from '../data/domain'
import { frontendDemoMode } from '../data/runtimeMode'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import styles from './Pages.module.css'
import local from './OperationsCenterPage.module.css'

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

// 状态语义映射：自研 tone → antd Tag 语义色。
const SEVERITY_COLOR: Record<string, string> = {
  danger: 'error',
  warning: 'warning',
  neutral: 'default',
}

/** 严重度中文口径：CRITICAL 即「阻断」（SLA 逾期/不可交付语义）。 */
const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: '阻断',
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
}

/** 来源域中文名（对齐控制面 OperationsProjection 的 sourceType）；uuid 片段不展示。 */
const SOURCE_TYPE_LABEL: Record<string, string> = {
  run: '数据接入',
  issue: '治理问题',
  notification: '通知投递',
  delivery: '合同投递',
  dataService: '数据服务',
  aiBuildJob: 'AI 构建',
  mpiMetrics: '患者主索引',
}

const WORK_ITEM_PAGE_SIZE = 12
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

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
  const eventsState = useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchOperationsEvents(signal),
    onData: setEvents,
    onUnavailable: () => setEvents([]),
  })

  const sortedWorkItems = useMemo(() => [...workItems].sort((left, right) =>
    (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9)), [workItems])
  const paged = usePaged(sortedWorkItems, WORK_ITEM_PAGE_SIZE)
  const urgentCount = workItems.filter((item) => item.severity === 'CRITICAL' || item.severity === 'HIGH').length
  const presentTypes = useMemo(
    () => WORK_ITEM_TYPES.filter((type) => workItems.some((item) => item.type === type)),
    [workItems])

  const workItemColumns: ColumnsType<OperationsWorkItem> = [
    { title: '类型', key: 'type', width: 104, render: (_, item) => TYPE_LABEL[item.type] ?? item.type },
    {
      title: '严重度',
      key: 'severity',
      width: 84,
      render: (_, item) => <Tag color={SEVERITY_COLOR[severityTone(item.severity)]}>{SEVERITY_LABEL[item.severity] ?? item.severity}</Tag>,
    },
    { title: '待办', key: 'title', render: (_, item) => item.title },
    { title: '来源', key: 'source', width: 104, render: (_, item) => SOURCE_TYPE_LABEL[item.sourceType] ?? item.sourceType },
    {
      title: '更新时间',
      key: 'asOf',
      align: 'right',
      width: 104,
      render: (_, item) => <small className={local.timestamp}>{formatDateTime(item.asOf)}</small>,
    },
    {
      title: '',
      key: 'actions',
      render: (_, item) => (
        <Button size="small" type="link" onClick={() => {
          const route = DEEP_LINK_ROUTES[item.deepLink]
          if (route) {
            onNavigate(route)
          } else {
            onNotice(`暂无门户路由对应 ${item.deepLink}`)
          }
        }}>下钻 <ChevronRight size={13} /></Button>
      ),
    },
  ]

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
            <Select
              size="small"
              className={local.typeFilter}
              value={typeFilter}
              onChange={(value) => { setTypeFilter(value); paged.setPage(0) }}
              aria-label="按待办类型筛选"
              options={[
                { value: '', label: '全部类型' },
                ...WORK_ITEM_TYPES.map((type) => ({ value: type, label: TYPE_LABEL[type] ?? type })),
              ]}
            />
          </label>
          <span className={styles.pagerInfo}>共 {workItems.length} 项{presentTypes.length > 0 ? ` · 当前数据含 ${presentTypes.length} 类` : ''}</span>
          <Button size="small" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={13} />刷新</Button>
        </div>

        <div className={local.prioritySummary} aria-label="当前筛选待办摘要">
          <div><span>当前待办</span><strong>{workItemsState !== 'live' ? '—' : workItems.length}<small>项</small></strong></div>
          <div><span>阻断与高优先级</span><strong className={urgentCount > 0 ? local.urgent : undefined}>{workItemsState !== 'live' ? '—' : urgentCount}<small>项</small></strong></div>
          <p>先处理阻断与高优先级事项，再进入对应工作台核查来源与处置结果。</p>
        </div>
        <div className={`${styles.twoColumns} ${local.workspace}`}>
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}>
              <div><h2>跨域待办</h2><p>按严重度排序 · 每项可进入责任工作台</p></div>
              <ClipboardList size={16} aria-hidden="true" />
            </div>
            <Table<OperationsWorkItem>
              rowKey={(item) => `${item.sourceType}-${item.sourceId}`}
              columns={workItemColumns}
              scroll={{ x: 700 }}
              dataSource={paged.paged}
              loading={workItemsState === 'loading'}
              pagination={{
                current: paged.page + 1,
                pageSize: WORK_ITEM_PAGE_SIZE,
                total: workItems.length,
                showSizeChanger: false,
                onChange: (page) => paged.setPage(page - 1),
              }}
              locale={{
                emptyText: workItemsState === 'loading'
                  ? '正在加载待办…'
                  : workItemsState === 'live'
                    ? '该筛选下暂无待办。'
                    : '运营待办暂不可用。',
              }}
            />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>事件流</h2><p>标准/合同/AI 构建/通知留痕</p></div>
            <ul className={`${styles.timelineBody} ${local.eventList}`} aria-busy={eventsState === 'loading'}>
              {eventsState === 'loading' ? <li><Skeleton active title={false} paragraph={{ rows: 4 }} /></li> : null}
              {eventsState === 'unavailable' ? <li className={local.eventUnavailable}><strong>事件暂不可用</strong><p>暂时无法读取操作留痕，恢复后可重新加载。</p><Button size="small" onClick={() => setReloadKey((key) => key + 1)}>重新加载</Button></li> : null}
              {eventsState === 'live' && events.length === 0 ? <li className={styles.emptyState}>近 48 小时无跨域事件。</li> : null}
              {events.map((event, index) => (
                <li key={`${event.domain}-${index}`}>
                  <div className={styles.timelineTitle}><strong>{event.domain} · {event.type}</strong><span>{formatDateTime(event.asOf)}</span></div>
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

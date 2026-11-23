import { useQuery } from '@tanstack/react-query'
import { Activity, ChevronRight, CloudCog, Inbox, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '../../components/kit/badge'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { MetricCard, MetricStrip } from '../../components/app/metric'
import { Count, Panel, PanelHead } from '../../components/kit/panel'
import { LoadingBlock, Skeleton } from '../../components/kit/states'
import { Button } from '../../components/kit/button'
import { DataTable, listColumnHelper } from '../../components/table/data-table'
import { EmptyState } from '../../components/kit/states'
import { formatDateTime } from '../../data/domain'
import {
  EVENT_DOMAIN_LABEL,
  EVENT_TYPE_LABEL,
  WORK_ITEM_SOURCE_LABEL,
  type OperationsWorkItem,
} from '../../data/operationsApi'
import { usePortalNavigate } from '../../app/navigate'
import { useNotice } from '../../components/kit/toast'
import { operationsEventsQuery, operationsSummaryQuery, operationsWorkItemsQuery } from './queries'

/**
 * 总览（批准原型主线第一页）：真实运营指标、跨域待办与最近事件。
 * 指标全部来自运营只读投影；某项不可用时该项显示 —，不补演示走势，
 * 组件覆盖数与「未读中心」都不在这里虚构。
 */
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
const SEVERITY_LABEL: Record<string, string> = { CRITICAL: '阻断', HIGH: '高', MEDIUM: '中', LOW: '低' }

const METRIC_ROUTES: Record<string, string> = {
  '采集失败（24h）': '/ingestion',
  治理待办: '/governance',
  通知积压: '/operations-center',
  合同投递积压: '/data-services',
  'MPI 待复核': '/mpi/review',
  '数据服务调用失败（24h）': '/data-services',
  'AI 构建任务': '/ai-data',
}

const DEEP_LINK_ROUTES: Record<string, string> = {
  '/ingestion': '/ingestion',
  '/governance': '/governance',
  '/mpi': '/mpi/review',
  '/ai-data': '/ai-data',
  '/data-services': '/data-services',
  '/operations-center': '/operations-center',
}

function countTone(value: number, warnAt: number, dangerAt = Number.POSITIVE_INFINITY): 'warn' | 'danger' | 'neutral' {
  if (value >= dangerAt) return 'danger'
  if (value >= warnAt) return 'warn'
  return 'neutral'
}

const helper = listColumnHelper<OperationsWorkItem>()
const workItemColumns = helper.columns([
  helper.display({
    id: 'severity',
    header: '严重度',
    size: 84,
    cell: ({ row }) => {
      const severity = row.original.severity
      return <Badge tone={severity === 'CRITICAL' || severity === 'HIGH' ? 'danger' : severity === 'MEDIUM' ? 'warn' : 'neutral'}>{SEVERITY_LABEL[severity] ?? severity}</Badge>
    },
  }),
  helper.accessor('title', { header: '待办' }),
  helper.display({
    id: 'source',
    header: '来源',
    size: 170,
    cell: ({ row }) => <code className="font-mono text-label text-muted">{WORK_ITEM_SOURCE_LABEL[row.original.sourceType] ?? row.original.sourceType}</code>,
  }),
  helper.display({
    id: 'asOf',
    header: '更新时间',
    size: 120,
    cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.asOf)}</span>,
  }),
  helper.display({
    id: 'action',
    header: '操作',
    size: 110,
    cell: ({ row }) => <span className="inline-flex items-center gap-0.5 text-label text-blue">进入工作台<ChevronRight size={12} /></span>,
  }),
])

export function OverviewPage() {
  const navigate = usePortalNavigate()
  const notify = useNotice()
  const summaryQuery = useQuery(operationsSummaryQuery())
  const workItemsQuery = useQuery(operationsWorkItemsQuery(''))
  const eventsQuery = useQuery(operationsEventsQuery())

  const summary = summaryQuery.data
  const metrics = useMemo(() => {
    if (!summary) return []
    const domains = summary.domains
    return [
      { label: '采集失败（24h）', value: String(domains.ingestion.failedRuns), note: `停滞运行 ${domains.ingestion.stalledRuns} 个`, tone: countTone(domains.ingestion.failedRuns, 1) },
      { label: '治理待办', value: String(domains.governance.openIssues), note: `SLA 逾期 ${domains.governance.slaOverdue} 项`, tone: countTone(domains.governance.openIssues, 1, 5) },
      { label: '通知积压', value: String(domains.notifications.backlog), note: '发件箱待投递/失败', tone: countTone(domains.notifications.backlog, 1) },
      { label: '合同投递积压', value: String(domains.contracts.deliveryBacklog), note: '调用方 webhook 待投递', tone: countTone(domains.contracts.deliveryBacklog, 1) },
      domains.mpi.availability === 'UP'
        ? { label: 'MPI 待复核', value: String(domains.mpi.reviewPending), note: '患者主索引候选对', tone: countTone(domains.mpi.reviewPending, 1, 20) }
        : { label: 'MPI 待复核', value: '—', note: `依赖状态：${domains.mpi.availability}`, tone: 'neutral' as const },
      { label: '数据服务调用失败（24h）', value: String(domains.dataApi.failedCalls24h), note: 'HTTP ≥ 400 的调用', tone: countTone(domains.dataApi.failedCalls24h, 1, 20) },
      { label: 'AI 构建任务', value: String(domains.aiData.activeBuilds), note: `24h 失败 ${domains.aiData.failedBuilds24h} 个`, tone: countTone(domains.aiData.failedBuilds24h, 1) },
    ]
  }, [summary])

  const topItems = useMemo(
    () => [...(workItemsQuery.data ?? [])]
      .sort((left, right) => (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9))
      .slice(0, 8),
    [workItemsQuery.data],
  )

  const components = summary?.components
  const refreshing = summaryQuery.isFetching || workItemsQuery.isFetching || eventsQuery.isFetching

  function refresh() {
    void summaryQuery.refetch()
    void workItemsQuery.refetch()
    void eventsQuery.refetch()
  }

  function openWorkItem(item: OperationsWorkItem) {
    const path = DEEP_LINK_ROUTES[item.deepLink]
    if (path) navigate(path)
    else notify(`暂无门户路由对应 ${item.deepLink}`)
  }

  return (
    <div>
      <Breadcrumb items={[{ label: '工作概览' }, { label: '总览' }]} trailing={<span>真实服务指标 · 运营投影</span>} />
      <PageHeading
        title="医院数据运营总览"
        description="从数据接入到可信使用，掌握每一条数据链路。"
        actions={
          <>
            <Button onClick={refresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />刷新
            </Button>
            <Button variant="primary" onClick={() => navigate('/governance')}>查看待办</Button>
          </>
        }
      />

      {summaryQuery.isPending ? (
        <MetricStrip>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="min-h-[104px] rounded-panel border border-line bg-paper px-4 py-3"><Skeleton rows={1} className="px-0 py-0" /></div>
          ))}
        </MetricStrip>
      ) : summaryQuery.isError ? (
        <section role="status" className="mb-[18px] flex items-start gap-3 rounded-panel border border-amber-line bg-amber-soft px-4 py-4">
          <CloudCog size={19} className="mt-0.5 text-amber" />
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-ink">运营投影暂不可用</h2>
            <p className="mt-1 text-body-sm text-ink-soft">控制面运营摘要不可达，暂无法展示真实指标；请恢复连接后重新读取。</p>
          </div>
          <Button onClick={() => void summaryQuery.refetch()}>重新加载</Button>
        </section>
      ) : (
        <MetricStrip>
          {metrics.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              note={metric.note}
              tone={metric.tone}
              onClick={() => navigate(METRIC_ROUTES[metric.label] ?? '/ingestion')}
            />
          ))}
        </MetricStrip>
      )}

      <section className={`mb-3.5 flex items-center justify-between gap-4 rounded-panel border px-[21px] py-3.5 ${components?.state === 'DEGRADED' ? 'border-amber-line bg-amber-soft' : 'border-line bg-paper'}`}>
        <div className="flex items-center gap-3">
          <Activity size={21} className={components?.state === 'DEGRADED' ? 'text-amber' : 'text-blue'} />
          <div>
            <h2 className="text-body-sm font-semibold text-ink">
              组件覆盖 {components ? `${components.ready}/${components.total}` : '—'} · {components?.state === 'READY' ? '全部就绪' : components?.state === 'DEGRADED' ? '存在降级' : '状态未知'}
            </h2>
            <p className="mt-1 text-label text-muted">
              覆盖 {components ? `${components.ready} 就绪 / ${components.degraded} 降级 / ${components.unknown} 未知` : '…'}；平台组件明细在「平台运维」。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge tone={components?.state === 'READY' ? 'success' : components?.state === 'DEGRADED' ? 'warn' : 'neutral'}>
            {components?.state === 'READY' ? '全部就绪' : components?.state === 'DEGRADED' ? '存在降级' : '状态未知'}
          </Badge>
          <Button size="sm" onClick={refresh}>刷新</Button>
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)] gap-[18px] max-[1100px]:grid-cols-1">
        <Panel>
          <PanelHead
            title="优先处理"
            count={workItemsQuery.data?.length}
            description="按严重度排序 · 完整清单在运营中心"
            actions={<Button variant="text" onClick={() => navigate('/operations-center')}>查看全部<ChevronRight size={13} /></Button>}
          />
          <DataTable
            columns={workItemColumns}
            data={topItems}
            getRowId={(item) => `${item.sourceType}-${item.sourceId}`}
            rowLabel={(item) => item.title}
            loading={workItemsQuery.isPending}
            onRowClick={openWorkItem}
            empty={workItemsQuery.isError
              ? <EmptyState minHeight={220} icon={<CloudCog />} title="运营待办投影暂不可用" description="可以重新加载；本页不显示静态回退。" action={<Button onClick={() => void workItemsQuery.refetch()}>重新加载</Button>} />
              : <EmptyState minHeight={220} icon={<Inbox />} title="当前没有待处理的跨域事项" description="待办来自各业务域的真实记录。" />}
          />
        </Panel>

        <Panel>
          <PanelHead title="最近事件" description="跨域操作留痕" actions={<span className="text-label text-muted">近 48 小时</span>} />
          <div className="px-5 pb-5" aria-busy={eventsQuery.isPending}>
            {eventsQuery.isPending ? <LoadingBlock className="min-h-[160px]">正在读取事件…</LoadingBlock> : null}
            {eventsQuery.isError ? (
              <div className="space-y-2 py-6 text-center">
                <p className="text-body-sm font-medium text-ink-soft">事件暂不可用</p>
                <p className="text-label text-muted">无法读取近期事件，可重新加载。</p>
                <Button size="sm" onClick={() => void eventsQuery.refetch()}>重新加载</Button>
              </div>
            ) : null}
            {eventsQuery.isSuccess && (eventsQuery.data?.length ?? 0) === 0 ? <p className="py-8 text-center text-label text-muted">近 48 小时无跨域事件。</p> : null}
            <ol className="m-0 list-none p-0">
              {(eventsQuery.data ?? []).slice(0, 10).map((event, index) => (
                <li key={`${event.domain}-${index}`} className="border-b border-line-soft py-2.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-label font-medium text-ink-soft">{EVENT_DOMAIN_LABEL[event.domain] ?? event.domain} · {EVENT_TYPE_LABEL[event.type] ?? event.type}</strong>
                    <span className="shrink-0 text-meta text-muted">{formatDateTime(event.asOf)}</span>
                  </div>
                  <p className="mt-1 text-label leading-relaxed text-muted">{event.detail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-meta text-muted"><CloudCog size={13} />事件与待办同源于运营投影，两处口径一致。</p>
          </div>
        </Panel>
      </div>
    </div>
  )
}

/** 数量角标导出供面板标题复用（保留命名一致性）。 */
export { Count }

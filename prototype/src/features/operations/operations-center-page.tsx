import { LoadingBlock } from '@/components/app/loading'
import { Badge } from '@/components/ui/badge'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQuery } from '@tanstack/react-query'
import { Inbox, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel, PanelHead } from '../../components/kit/panel'
import { EmptyState } from '@/components/app/empty-state'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { formatDateTime } from '../../data/domain'
import {
  EVENT_DOMAIN_LABEL,
  EVENT_TYPE_LABEL,
  WORK_ITEM_SOURCE_LABEL,
  WORK_ITEM_TYPES,
  type OperationsWorkItem,
} from '../../data/operationsApi'
import { usePortalNavigate } from '../../app/navigate'
import { operationsEventsQuery, operationsSummaryQuery, operationsWorkItemsQuery } from './queries'

const PAGE_SIZE = 12
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
const SEVERITY_LABEL: Record<string, string> = { CRITICAL: '阻断', HIGH: '高', MEDIUM: '中', LOW: '低' }

const DEEP_LINK_ROUTES: Record<string, string> = {
  '/ingestion': '/ingestion',
  '/governance': '/governance',
  '/mpi': '/mpi/review',
  '/ai-data': '/ai-data',
  '/data-services': '/data-services',
}

const helper = listColumnHelper<OperationsWorkItem>()

const TYPE_ITEMS = [
  { value: '', label: '全部类型' },
  ...WORK_ITEM_TYPES.map((item) => ({ value: item, label: item })),
]

/**
 * 运营中心：面向治理负责人的跨域待办与事件流，与总览共用运营投影事实源。
 * 「平台运维」继续面向技术角色看组件探针，两者不合并。
 */
export function OperationsCenterPage() {
  const navigate = usePortalNavigate()
  const [type, setType] = useState('')
  const [page, setPage] = useState(0)

  const summaryRequest = useQuery(operationsSummaryQuery())
  const workItemsRequest = useQuery(operationsWorkItemsQuery(type))
  const eventsRequest = useQuery(operationsEventsQuery())

  const sorted = useMemo(() => [...(workItemsRequest.data ?? [])].sort((left, right) => (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9)), [workItemsRequest.data])
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const summary = summaryRequest.data

  const columns = helper.columns([
    helper.display({
      id: 'severity',
      header: '严重度',
      size: 90,
      cell: ({ row }) => <Badge variant={row.original.severity === 'CRITICAL' || row.original.severity === 'HIGH' ? 'error' : row.original.severity === 'MEDIUM' ? 'warning' : 'outline'}>{SEVERITY_LABEL[row.original.severity] ?? row.original.severity}</Badge>,
    }),
    helper.display({
      id: 'title',
      header: '待办',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm text-ink">{row.original.title}</div>
          <div className="text-meta text-muted-foreground">{row.original.type}</div>
        </div>
      ),
    }),
    helper.display({ id: 'source', header: '来源', size: 140, cell: ({ row }) => <span className="text-label">{WORK_ITEM_SOURCE_LABEL[row.original.sourceType] ?? row.original.sourceType}</span> }),
    helper.display({ id: 'asOf', header: '更新时间', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.asOf)}</span> }),
    helper.display({
      id: 'action',
      header: '操作',
      size: 120,
      cell: ({ row }) => <span className="text-label text-blue">进入工作台</span>,
    }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '工作概览' }, { label: '运营中心' }]} trailing={summary ? <span>共 {summary.workItemsOpen} 项跨域待办</span> : null} />
      <PageHeading
        title="运营中心"
        description="跨域待办与事件流；每项待办带来源与深链，可直接进入对应工作台。"
        actions={<Button variant="outline" onClick={() => { void workItemsRequest.refetch(); void eventsRequest.refetch(); void summaryRequest.refetch() }} disabled={workItemsRequest.isFetching}><RefreshCw size={14} className={workItemsRequest.isFetching ? 'animate-spin' : undefined} />刷新</Button>}
      />

      {workItemsRequest.isPending ? <LoadingBlock>正在读取运营待办…</LoadingBlock> : null}
      {workItemsRequest.isError ? (
        <Panel>
          <EmptyState minHeight={240} icon={<Inbox />} title="运营待办投影暂不可用" description="控制面运营投影不可达；本页不显示静态回退。" action={<Button variant="outline" onClick={() => void workItemsRequest.refetch()}>重试</Button>} />
        </Panel>
      ) : null}

      {workItemsRequest.isSuccess ? (
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
          <Panel>
            <PanelHead
              title="跨域待办"
              count={sorted.length}
              description="按严重度排序；筛选按待办类型"
              actions={
                <Select
                  items={TYPE_ITEMS}
                  value={type}
                  onValueChange={(next) => { setType(next ?? ''); setPage(0) }}
                >
                  <SelectTrigger aria-label="按类型筛选" className="w-auto min-w-none" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {TYPE_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            <DataTable
              columns={columns}
              data={sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)}
              getRowId={(item) => `${item.sourceType}-${item.sourceId}`}
              rowLabel={(item) => item.title}
              onRowClick={(item) => {
                const path = DEEP_LINK_ROUTES[item.deepLink]
                if (path) navigate(path)
                else navigate('/operations-center')
              }}
              empty={<EmptyState minHeight={220} icon={<Inbox />} title="当前没有待处理的跨域事项" description="待办来自各业务域的真实记录。" />}
              footer={<TablePagination page={currentPage} pageSize={PAGE_SIZE} total={sorted.length} onPageChange={setPage} label="运营待办分页" />}
            />
          </Panel>

          <Panel>
            <PanelHead title="最近事件" description="跨域操作留痕（近 48 小时）" />
            <div className="px-5 pb-5">
              {eventsRequest.isPending ? <LoadingBlock className="min-h-[160px]">正在读取事件…</LoadingBlock> : null}
              {eventsRequest.isError ? <p className="py-4 text-center text-label text-amber">事件暂不可用，可重新加载。</p> : null}
              <ol className="m-0 list-none p-0">
                {(eventsRequest.data ?? []).slice(0, 12).map((event, index) => (
                  <li key={`${event.domain}-${index}`} className="border-b border-line-soft py-2 last:border-b-0">
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-label font-medium text-ink-soft">{EVENT_DOMAIN_LABEL[event.domain] ?? event.domain} · {EVENT_TYPE_LABEL[event.type] ?? event.type}</strong>
                      <span className="shrink-0 text-meta text-muted-foreground">{formatDateTime(event.asOf)}</span>
                    </div>
                    <p className="mt-0.5 text-meta leading-relaxed text-muted-foreground">{event.detail}</p>
                  </li>
                ))}
                {eventsRequest.isSuccess && (eventsRequest.data?.length ?? 0) === 0 ? <li className="py-6 text-center text-label text-muted-foreground">近 48 小时无跨域事件。</li> : null}
              </ol>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

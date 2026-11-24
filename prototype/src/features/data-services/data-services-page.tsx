import { TableSkeleton } from '@/components/app/table-skeleton'
import { LoadingBlock } from '@/components/app/loading'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { NativeSelect, SearchField } from '../../components/kit/input'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel, PanelHead } from '../../components/kit/panel'
import { Tabs, TabPanel } from '../../components/kit/popover'
import { Confirm } from '../../components/kit/overlay'
import { EmptyState } from '../../components/kit/states'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  dataServiceStatusLabel,
  deprecateDataService,
  issueDataServiceKey,
  publishDataService,
  revokeDataServiceKey,
  type DataService,
  type DataServiceCallItem,
  type DataServiceContractEventItem,
  type DataServiceExportItem,
  type DataServiceSubscriptionItem,
} from '../../data/dataServicesApi'
import { formatDateTime } from '../../data/domain'
import { workLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import {
  dataServiceCallsQuery,
  dataServiceContractEventsQuery,
  dataServiceDetailQuery,
  dataServiceExportsQuery,
  dataServiceKeys,
  dataServiceOverviewQuery,
  dataServiceSubscriptionsQuery,
  dataServicesQuery,
} from './queries'

const PAGE_SIZE = 8

function statusTone(status: string): 'success' | 'warning' | 'outline' {
  if (status === 'PUBLISHED') return 'success'
  if (status === 'DEPRECATED') return 'outline'
  return 'warning'
}

/**
 * 数据服务：定义 → 发布 → Key 发放 → 调用审计。
 * 短表单只在授权与吊销；服务定义走独立编辑页（SQL/参数/列/限额）。
 * Key 明文只回显一次，页面刷新即不可再取。
 */
export function DataServicesPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [deprecateTarget, setDeprecateTarget] = useState<DataService | null>(null)
  const [tab, setTab] = useState<'keys' | 'calls' | 'exports' | 'contract' | 'subscriptions'>('keys')

  const listRequest = useQuery(dataServicesQuery())
  const overviewRequest = useQuery(dataServiceOverviewQuery())
  const services = listRequest.data ?? []

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return services.filter((service) => (!statusFilter || service.status === statusFilter)
      && `${service.name}${service.code}${service.owner}`.toLowerCase().includes(text))
  }, [services, keyword, statusFilter])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const selected = services.find((service) => service.id === selectedId) ?? visible[currentPage * PAGE_SIZE] ?? services[0] ?? null
  const detailRequest = useQuery(dataServiceDetailQuery(selected?.id ?? ''))
  const callsRequest = useQuery({ ...dataServiceCallsQuery(selected?.id ?? ''), enabled: Boolean(selected) && tab === 'calls' })
  const exportsRequest = useQuery({ ...dataServiceExportsQuery(selected?.id ?? ''), enabled: Boolean(selected) && tab === 'exports' })
  const contractRequest = useQuery({ ...dataServiceContractEventsQuery(selected?.id ?? ''), enabled: Boolean(selected) && tab === 'contract' })
  const subscriptionsRequest = useQuery({ ...dataServiceSubscriptionsQuery(selected?.id ?? ''), enabled: Boolean(selected) && tab === 'subscriptions' })

  const publish = useMutation({
    mutationFn: (service: DataService) => publishDataService(service.id),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: dataServiceKeys.all })
      notify(`${updated.code} 已发布（执行面 30s 内生效）`)
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '发布失败'),
  })

  const deprecate = useMutation({
    mutationFn: (service: DataService) => deprecateDataService(service.id),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: dataServiceKeys.all })
      setDeprecateTarget(null)
      notify(`${updated.code} 已下线`)
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '下线失败'),
  })

  const serviceHelper = listColumnHelper<DataService>()
  const serviceColumns = serviceHelper.columns([
    serviceHelper.display({
      id: 'name',
      header: '数据服务',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm font-medium text-ink">{row.original.name}</div>
          <div className="font-mono text-meta text-muted-foreground">{row.original.code} · v{row.original.versionSn}</div>
        </div>
      ),
    }),
    serviceHelper.display({ id: 'status', header: '状态', size: 90, cell: ({ row }) => <Badge variant={statusTone(row.original.status)}>{dataServiceStatusLabel[row.original.status] ?? row.original.status}</Badge> }),
    serviceHelper.display({ id: 'owner', header: '负责人', size: 110, cell: ({ row }) => row.original.owner }),
    serviceHelper.display({ id: 'limits', header: '限额', size: 130, cell: ({ row }) => <span className="text-label text-muted-foreground">{row.original.maxRows} 行 / {row.original.timeoutSeconds}s</span> }),
    serviceHelper.display({ id: 'updated', header: '更新', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.updatedAt)}</span> }),
  ])

  const callHelper = listColumnHelper<DataServiceCallItem>()
  const callColumns = callHelper.columns([
    callHelper.display({ id: 'at', header: '调用时间', size: 150, cell: ({ row }) => <span className="text-label">{formatDateTime(row.original.calledAt)}</span> }),
    callHelper.display({ id: 'status', header: 'HTTP', size: 90, cell: ({ row }) => <Badge variant={row.original.statusCode < 400 ? 'success' : 'error'}>{row.original.statusCode}</Badge> }),
    callHelper.display({ id: 'rows', header: '行数', size: 90, cell: ({ row }) => <span className="tabular-nums text-label">{row.original.rowCount}{row.original.truncated ? '（截断）' : ''}</span> }),
    callHelper.display({ id: 'elapsed', header: '耗时', size: 90, cell: ({ row }) => <span className="tabular-nums text-label">{row.original.elapsedMs} ms</span> }),
    callHelper.display({ id: 'key', header: 'Key', size: 140, cell: ({ row }) => <span className="font-mono text-meta text-muted-foreground">{row.original.keyId.slice(0, 8)}</span> }),
  ])

  const exportHelper = listColumnHelper<DataServiceExportItem>()
  const exportColumns = exportHelper.columns([
    exportHelper.display({ id: 'at', header: '创建时间', size: 150, cell: ({ row }) => <span className="text-label">{formatDateTime(row.original.createdAt)}</span> }),
    exportHelper.display({ id: 'status', header: '状态', size: 100, cell: ({ row }) => <Badge variant={row.original.status === 'SUCCEEDED' ? 'success' : row.original.status === 'FAILED' ? 'error' : 'warning'}>{row.original.status}</Badge> }),
    exportHelper.display({ id: 'rows', header: '行数', size: 90, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-label">{row.original.rowCount}</span> }),
    exportHelper.display({ id: 'bytes', header: '大小', size: 100, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-label">{(row.original.fileBytes / 1024).toFixed(1)} KB</span> }),
    exportHelper.display({ id: 'error', header: '错误', cell: ({ row }) => <span className="text-label text-red">{row.original.error || '—'}</span> }),
  ])

  const contractHelper = listColumnHelper<DataServiceContractEventItem>()
  const contractColumns = contractHelper.columns([
    contractHelper.display({ id: 'at', header: '时间', size: 150, cell: ({ row }) => <span className="text-label">{formatDateTime(row.original.occurredAt)}</span> }),
    contractHelper.display({ id: 'type', header: '变更', size: 110, cell: ({ row }) => <Badge variant={row.original.changeType === 'DEPRECATED' ? 'outline' : 'info'}>{row.original.changeType}</Badge> }),
    contractHelper.display({ id: 'version', header: '版本', size: 130, cell: ({ row }) => <span className="font-mono text-label">{row.original.fromVersion} → {row.original.toVersion}</span> }),
    contractHelper.display({ id: 'diff', header: '差异', cell: ({ row }) => <span className="text-label text-muted-foreground">{row.original.diff || '—'}</span> }),
  ])

  const subscriptionHelper = listColumnHelper<DataServiceSubscriptionItem>()
  const subscriptionColumns = subscriptionHelper.columns([
    subscriptionHelper.display({ id: 'caller', header: '订阅方', size: 160, cell: ({ row }) => row.original.callerName }),
    subscriptionHelper.display({ id: 'webhook', header: 'Webhook', cell: ({ row }) => <span className="font-mono text-meta text-muted-foreground">{row.original.webhookUrl}</span> }),
    subscriptionHelper.display({ id: 'status', header: '状态', size: 90, cell: ({ row }) => <Badge variant={row.original.status === 'ACTIVE' ? 'success' : 'outline'}>{row.original.status === 'ACTIVE' ? '生效' : '已撤销'}</Badge> }),
    subscriptionHelper.display({ id: 'at', header: '创建', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.createdAt)}</span> }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '数据应用' }, { label: '数据服务' }]} trailing={overviewRequest.data ? <span>{overviewRequest.data.published} 已发布 / {overviewRequest.data.draft} 草稿 · 今日 {overviewRequest.data.callsToday} 调用</span> : null} />
      <PageHeading
        title="数据服务"
        description="ToB 数据 API 的定义、Key 与调用审计工作台。"
        actions={
          <>
            <Button variant="outline" onClick={() => { void listRequest.refetch(); void detailRequest.refetch() }} disabled={listRequest.isFetching}><RefreshCw size={14} className={listRequest.isFetching ? 'animate-spin' : undefined} />刷新</Button>
            <Button onClick={() => navigate(workLinks.dataServiceNew())}><Plus size={14} />新建数据服务</Button>
          </>
        }
      />

      {listRequest.isPending ? <LoadingBlock>正在读取数据服务…</LoadingBlock> : null}
      {listRequest.isError ? (
        <Panel>
          <EmptyState minHeight={220} icon={<ShieldCheck />} title="数据服务目录暂不可用" description="暂时无法读取服务目录。请重新读取，持续失败时联系平台运维核对服务连接。" action={<Button variant="outline" onClick={() => void listRequest.refetch()}>重新读取</Button>} />
        </Panel>
      ) : null}

      {listRequest.isSuccess ? (
        <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
          <Panel className="flex flex-col">
            <div className="flex items-center justify-between px-[18px] pt-3 pb-2">
              <h2 className="text-title font-semibold">服务目录<Badge variant="outline">{visible.length}</Badge></h2>
            </div>
            <div className="flex items-center gap-2 px-[18px] pb-2">
              <SearchField value={keyword} onValueChange={(value) => { setKeyword(value); setPage(0) }} placeholder="搜索名称/代码/负责人" className="w-full" />
            </div>
            <div className="px-[18px] pb-2">
              <NativeSelect aria-label="状态筛选" className="w-auto" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0) }}>
                <option value="">全部状态</option>
                {Object.entries(dataServiceStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </div>
            <ul className="m-0 min-h-0 flex-1 list-none px-2 pb-2">
              {visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((service) => {
                const active = service.id === selected?.id
                return (
                  <li key={service.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setSelectedId(service.id); setTab('keys') }}
                      className={`mb-1 w-full rounded-control px-2.5 py-2 text-left ${active ? 'bg-blue-soft' : 'hover:bg-wash'}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-body-sm text-ink-soft">{service.name}</span>
                        <Badge variant={statusTone(service.status)}>{dataServiceStatusLabel[service.status] ?? service.status}</Badge>
                      </span>
                      <span className="mt-0.5 block font-mono text-meta text-muted-foreground">{service.code} · v{service.versionSn}</span>
                    </button>
                  </li>
                )
              })}
              {visible.length === 0 ? <li className="px-3 py-6 text-center text-label text-muted-foreground">当前过滤下没有数据服务。</li> : null}
            </ul>
            <div className="border-t border-line px-2">
              <TablePagination compact page={currentPage} pageSize={PAGE_SIZE} total={visible.length} onPageChange={setPage} label="数据服务分页" className="border-t-0 px-1" />
            </div>
          </Panel>

          <Panel>
            {!selected ? (
              <EmptyState minHeight={320} icon={<ShieldCheck />} title="还没有数据服务" description="创建服务定义并发布后，才能给调用方发放 Key。" action={<Button variant="outline" onClick={() => navigate(workLinks.dataServiceNew())}>新建数据服务</Button>} />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusTone(selected.status)}>{dataServiceStatusLabel[selected.status] ?? selected.status}</Badge>
                      <span className="font-mono text-meta text-muted-foreground">{selected.code} · v{selected.versionSn}</span>
                    </div>
                    <h2 className="mt-1.5 text-subject font-semibold text-ink">{selected.name}</h2>
                    <p className="mt-1 text-label text-muted-foreground">{selected.description || '暂无服务描述。'} · 负责人 {selected.owner}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selected.status === 'DRAFT' ? <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate(selected)}>发布</Button> : null}
                    {selected.status === 'PUBLISHED' ? <Button size="sm" variant="destructive-outline" onClick={() => setDeprecateTarget(selected)}>下线</Button> : null}
                    <Button variant="outline" size="sm" onClick={() => navigate(workLinks.dataServiceNew())}>定义参考</Button>
                  </div>
                </div>

                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as typeof tab)}
                  items={[
                    { value: 'keys', label: 'Key 与授权', count: detailRequest.data?.keys.length },
                    { value: 'calls', label: '调用记录', count: detailRequest.data?.totalCalls },
                    { value: 'exports', label: '导出任务' },
                    { value: 'contract', label: '合同事件' },
                    { value: 'subscriptions', label: '订阅' },
                  ]}
                >
                  <TabPanel value="keys" className="px-5 py-4">
                    <KeyPanel service={selected} />
                  </TabPanel>
                  <TabPanel value="calls" className="px-0 py-2">
                    <DataTable columns={callColumns} data={callsRequest.data ?? []} getRowId={(call) => call.id} loading={callsRequest.isPending} empty={<EmptyState minHeight={180} title="暂无调用记录" description="调用方使用 Key 请求后在这里留痕。" />} />
                  </TabPanel>
                  <TabPanel value="exports" className="px-0 py-2">
                    <DataTable columns={exportColumns} data={exportsRequest.data ?? []} getRowId={(item) => item.id} loading={exportsRequest.isPending} empty={<EmptyState minHeight={180} title="暂无导出任务" description="大结果集导出会在这里显示进度与保留期。" />} />
                  </TabPanel>
                  <TabPanel value="contract" className="px-0 py-2">
                    <DataTable columns={contractColumns} data={contractRequest.data ?? []} getRowId={(event) => event.eventId} loading={contractRequest.isPending} empty={<EmptyState minHeight={180} title="暂无合同事件" description="定义发布、更新与下线都会形成合同事件。" />} />
                  </TabPanel>
                  <TabPanel value="subscriptions" className="px-0 py-2">
                    <DataTable columns={subscriptionColumns} data={subscriptionsRequest.data ?? []} getRowId={(item) => item.id} loading={subscriptionsRequest.isPending} empty={<EmptyState minHeight={180} title="暂无订阅" description="调用方可订阅合同变更通知。" />} />
                  </TabPanel>
                </Tabs>

                <div className="border-t border-line px-5 py-3">
                  <DefinitionFacts service={selected} />
                </div>
              </>
            )}
          </Panel>
        </div>
      ) : null}

      <Confirm
        open={deprecateTarget !== null}
        onOpenChange={(open) => { if (!open) setDeprecateTarget(null) }}
        title={`下线 ${deprecateTarget?.code ?? ''}`}
        description="服务将停止对外提供调用，已发放的 Key 不再可用；历史调用与合同事件保留。如需恢复，需要重新发布。"
        object={deprecateTarget ? { name: deprecateTarget.name, meta: `${deprecateTarget.code} · v${deprecateTarget.versionSn}` } : undefined}
        hint="下线影响调用方现有集成，请先确认订阅与合同通知已覆盖。"
        confirmLabel="下线服务"
        tone="destructive"
        busy={deprecate.isPending}
        onConfirm={() => deprecateTarget && deprecate.mutate(deprecateTarget)}
      />
    </div>
  )
}

/** Key 授权：明文只回显一次；吊销需确认。 */
function KeyPanel({ service }: { service: DataService }) {
  const queryClient = useQueryClient()
  const notify = useNotice()
  const detailRequest = useQuery(dataServiceDetailQuery(service.id))
  const [issuedKey, setIssuedKey] = useState('')
  const [callerName, setCallerName] = useState('')
  const [quota, setQuota] = useState('100')
  const [hospitals, setHospitals] = useState('*')
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)

  const issue = useMutation({
    mutationFn: () => issueDataServiceKey(service.id, callerName.trim(), hospitals === '*' ? [] : hospitals.split(',').map((item) => item.trim()).filter(Boolean), Number(quota) || 100),
    onSuccess: (result) => {
      setIssuedKey(result.apiKey)
      setCallerName('')
      void queryClient.invalidateQueries({ queryKey: dataServiceKeys.detail(service.id) })
      notify('Key 已发放：明文只显示这一次，请立即转交调用方')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Key 发放失败'),
  })

  const revoke = useMutation({
    mutationFn: (keyId: string) => revokeDataServiceKey(service.id, keyId),
    onSuccess: () => {
      setRevokeTarget(null)
      void queryClient.invalidateQueries({ queryKey: dataServiceKeys.detail(service.id) })
      notify('Key 已吊销')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Key 吊销失败'),
  })

  const keys = detailRequest.data?.keys ?? []

  return (
    <div>
      {issuedKey ? (
        <div className="mb-3 rounded-control border border-amber-line bg-amber-soft px-3 py-2.5">
          <strong className="block text-body-sm text-amber">新 Key（只显示这一次）</strong>
          <code className="mt-1 block break-all rounded-chip bg-paper px-2 py-1.5 font-mono text-label text-ink-soft">{issuedKey}</code>
          <p className="mt-1 text-meta text-amber">离开本页后无法再次查看；请立即转交调用方并妥善保管。</p>
          <div className="mt-1.5 flex justify-end"><Button variant="outline" size="sm" onClick={() => setIssuedKey('')}>我已保存</Button></div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-control border border-line bg-wash px-3 py-2.5">
        <label className="min-w-[150px]">
          <span className="mb-1 block text-meta text-muted-foreground">调用方名称</span>
          <Input className="block" aria-label="调用方名称" value={callerName} onChange={(event) => setCallerName(event.target.value)} placeholder="例如：医联体平台" />
        </label>
        <label className="min-w-[110px]">
          <span className="mb-1 block text-meta text-muted-foreground">每日配额</span>
          <Input className="block" aria-label="每日配额" type="number" min={1} value={quota} onChange={(event) => setQuota(event.target.value)} />
        </label>
        <label className="min-w-[150px]">
          <span className="mb-1 block text-meta text-muted-foreground">允许机构（* 或逗号分隔）</span>
          <Input className="block" aria-label="允许机构" value={hospitals} onChange={(event) => setHospitals(event.target.value)} />
        </label>
        <Button size="sm" disabled={!callerName.trim() || issue.isPending} onClick={() => issue.mutate()}>
          {issue.isPending ? '发放中…' : '发放 Key'}
        </Button>
      </div>

      {detailRequest.isPending ? <TableSkeleton rows={3} /> : null}
      {detailRequest.isError ? <p className="text-label text-red">Key 清单读取失败</p> : null}
      <table className="w-full border-collapse text-left text-label">
        <thead className="bg-wash text-muted-foreground">
          <tr>
            <th className="h-9 border-y border-line px-3 font-normal">调用方</th>
            <th className="h-9 border-y border-line px-3 font-normal">Key 前缀</th>
            <th className="h-9 border-y border-line px-3 font-normal">配额</th>
            <th className="h-9 border-y border-line px-3 font-normal">状态</th>
            <th className="h-9 border-y border-line px-3 font-normal">最近使用</th>
            <th className="h-9 border-y border-line px-3 font-normal">操作</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.id} className="border-b border-line-soft last:border-b-0">
              <td className="px-3 py-2">{key.callerName}</td>
              <td className="px-3 py-2 font-mono text-meta">{key.keyPrefix}…</td>
              <td className="px-3 py-2 tabular-nums">{key.dailyQuota} / 日</td>
              <td className="px-3 py-2"><Badge variant={key.status === 'ACTIVE' ? 'success' : 'outline'}>{key.status === 'ACTIVE' ? '生效' : '已吊销'}</Badge></td>
              <td className="px-3 py-2 text-faint">{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : '—'}</td>
              <td className="px-3 py-2">
                {key.status === 'ACTIVE' ? <Button size="sm" variant="link" className="text-red" onClick={() => setRevokeTarget(key.id)}>吊销</Button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {keys.length === 0 && detailRequest.isSuccess ? <p className="py-3 text-label text-muted-foreground">还没有发放过 Key。</p> : null}

      <Confirm
        open={revokeTarget !== null}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}
        title="吊销调用 Key"
        description="吊销后该 Key 立即不可用；调用记录与合同事件保留。如需恢复，请重新发放。"
        object={{ name: keys.find((key) => key.id === revokeTarget)?.callerName ?? '', meta: revokeTarget?.slice(0, 8) }}
        confirmLabel="吊销 Key"
        tone="destructive"
        busy={revoke.isPending}
        onConfirm={() => { if (revokeTarget) revoke.mutate(revokeTarget) }}
      />
    </div>
  )
}

function DefinitionFacts({ service }: { service: DataService }) {
  return (
    <dl className="grid grid-cols-4 gap-4 text-label max-[1100px]:grid-cols-2">
      <div><dt className="text-meta text-muted-foreground">行数上限</dt><dd className="m-0 text-ink-soft">{service.maxRows} 行</dd></div>
      <div><dt className="text-meta text-muted-foreground">超时</dt><dd className="m-0 text-ink-soft">{service.timeoutSeconds} 秒</dd></div>
      <div><dt className="text-meta text-muted-foreground">参数契约</dt><dd className="m-0 truncate font-mono text-meta text-muted-foreground" title={service.parametersJson}>{service.parametersJson}</dd></div>
      <div><dt className="text-meta text-muted-foreground">列契约</dt><dd className="m-0 truncate font-mono text-meta text-muted-foreground" title={service.columnsJson}>{service.columnsJson}</dd></div>
      <div className="col-span-4 max-[1100px]:col-span-2"><dt className="text-meta text-muted-foreground">SQL 模板</dt><dd className="m-0 whitespace-pre-wrap font-mono text-meta text-ink-soft">{service.sqlTemplate}</dd></div>
    </dl>
  )
}

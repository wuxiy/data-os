import { useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { ChartNoAxesCombined, Database, Download, RefreshCw, Search, Table2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/app/empty-state'
import { LoadingBlock } from '@/components/app/loading'
import { SearchField } from '@/components/app/search-field'
import { SelectionListItem } from '@/components/app/selection-list-item'
import { TableSkeleton } from '@/components/app/table-skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FramePanel } from '@/components/ui/frame'
import { RadioGroupPrimitive, RadioPrimitive } from '@/components/ui/radio-group'
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control'
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

import { usePortalNavigate } from '../../app/navigate'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { DataTable, listColumnHelper, TablePagination } from '../../components/table/data-table'
import { formatDateTime } from '../../data/domain'
import {
  type AssetQualityTest,
  instanceServiceLabel,
  type LineageAssetColumn,
  lineageNodeKindLabel,
  type LineageNodeView,
  lineageSchemaLabel,
  shortNodeName,
} from '../../data/lineageApi'
import { deepLinks } from '../../data/routes'
import {
  assetCatalogQuery,
  assetDetailQuery,
  assetLineageQuery,
  assetQualityTestsQuery,
  lineageSummaryQuery,
} from './queries'

const columnHelper = listColumnHelper<LineageAssetColumn>()
const qualityHelper = listColumnHelper<AssetQualityTest>()

const NODE_ICONS: Record<string, string> = { table: '数据表', dataModel: '数据模型', dashboard: '仪表盘', chart: '图表' }

/**
 * 资产目录（主从工作区）：左栏按库浏览与检索，右栏在同一资产上下文中查看
 * 字段结构、质量测试与上下游影响。质量测试为从属资源，失败只降级该 Tab。
 */
export function AssetCatalogPage() {
  const navigate = usePortalNavigate()
  const search = useSearch({ strict: false }) as { db?: string; asset?: string }
  const requestedFqn = search.asset ?? ''
  // 资产全限定名的倒数第二段是库名；无 db 的深链也必须定位到同一库。
  const requestedSchema = search.db ?? (requestedFqn.includes('.') ? requestedFqn.split('.').at(-2) : '') ?? ''

  const [schema, setSchema] = useState(requestedSchema || 'ods_ep')
  const [fqn, setFqn] = useState(requestedFqn.includes('.') ? requestedFqn : '')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)
  const [tab, setTab] = useState<'fields' | 'quality' | 'lineage' | 'evidence'>('fields')

  const summaryRequest = useQuery(lineageSummaryQuery())
  const catalogRequest = useQuery(assetCatalogQuery(schema))
  const assets = catalogRequest.data?.assets ?? []

  const effectiveFqn = useMemo(() => {
    if (fqn) return assets.some((asset) => asset.fullyQualifiedName === fqn) ? fqn : ''
    return assets[0]?.fullyQualifiedName ?? ''
  }, [assets, fqn])

  const detailRequest = useQuery(assetDetailQuery(effectiveFqn))
  const lineageRequest = useQuery(assetLineageQuery(effectiveFqn))
  const qualityRequest = useQuery(assetQualityTestsQuery(effectiveFqn))

  useEffect(() => {
    // 选中资产进 URL（可分享/可刷新）；库与资产同时保留。
    if (!effectiveFqn) return
    const params = new URLSearchParams()
    params.set('db', schema)
    params.set('asset', effectiveFqn)
    const next = `/assets?${params.toString()}`
    if (`${window.location.pathname}${window.location.search}` !== next) navigate(next, { replace: true })
  }, [effectiveFqn, navigate, schema])

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return assets
    return assets.filter((asset) => `${asset.name}${asset.fullyQualifiedName}${asset.displayName}`.toLowerCase().includes(text))
  }, [assets, keyword])

  const pageCount = Math.max(1, Math.ceil(visible.length / 8))
  const currentPage = Math.min(page, pageCount - 1)

  // 导出目录（原型「导出目录」按钮）：当前库、当前过滤口径下的已读取清单；
  // 结构元数据由元数据中心摄取，导出不补业务口径（与页面同一来源）。
  function exportCatalog() {
    const header = ['资产名称', '全限定名', '物理表名', '列数', '最近更新', '更新来源']
    const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
    const rows = visible.map((asset) => [
      escape(asset.displayName || asset.name),
      escape(asset.fullyQualifiedName),
      escape(asset.name),
      String(asset.columnCount),
      asset.updatedAt,
      escape(asset.updatedBy),
    ])
    const csv = `\uFEFF${[header, ...rows].map((row) => row.join(',')).join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `asset-catalog-${schema}-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const detail = detailRequest.data
  const lineage = lineageRequest.data
  const selected = assets.find((asset) => asset.fullyQualifiedName === effectiveFqn) ?? null
  const summary = summaryRequest.data
  const schemas = summary?.schemas ?? [schema]

  const columnColumns = columnHelper.columns([
    columnHelper.accessor('name', { header: '物理字段', cell: ({ row }) => <code className="font-mono text-label text-muted-foreground">{row.original.name}</code> }),
    columnHelper.accessor('dataType', { header: '类型', size: 160 }),
    columnHelper.display({ id: 'description', header: '说明', cell: ({ row }) => <span className="text-label text-muted-foreground">{row.original.description || '—'}</span> }),
  ])

  const qualityColumns = qualityHelper.columns([
    qualityHelper.accessor('ruleId', { header: '规则' }),
    qualityHelper.accessor('datasetId', { header: '数据集' }),
    qualityHelper.display({
      id: 'result',
      header: '最近结论',
      size: 110,
      cell: ({ row }) => {
        const run = row.original.lastRun
        if (!run) return <Badge variant="outline">未运行</Badge>
        if (run.status === 'FAILED') return <Badge variant="error">执行失败</Badge>
        if (run.status !== 'SUCCEEDED') return <Badge variant="outline">状态未知</Badge>
        return <Badge variant={run.passed ? 'success' : 'warning'}>{run.passed ? '通过' : '未通过'}</Badge>
      },
    }),
    qualityHelper.display({ id: 'finishedAt', header: '完成时间', size: 140, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.lastRun?.finishedAt)}</span> }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '数据管理' }, { label: '数据资产' }]} trailing={summary ? <span>{summary.tableCount} 表 · {summary.columnCount} 列</span> : null} />
      <PageHeading
        title="数据资产"
        description="围绕同一资产查看业务定义、字段结构、质量结果与消费影响。"
        actions={
          <>
            <Button variant="outline" onClick={exportCatalog} disabled={visible.length === 0 || catalogRequest.isFetching}>
              <Download size={14} />导出目录
            </Button>
            <Button variant="outline" onClick={() => { void catalogRequest.refetch(); void detailRequest.refetch() }} disabled={catalogRequest.isFetching}>
              <RefreshCw size={14} className={catalogRequest.isFetching ? 'animate-spin' : undefined} />刷新目录
            </Button>
            <Button variant="outline" onClick={() => { if (effectiveFqn) navigate(deepLinks.technicalAsset(effectiveFqn)) }} disabled={!effectiveFqn}>技术视图</Button>
          </>
        }
      />

      {catalogRequest.isPending ? <LoadingBlock>正在读取资产目录…</LoadingBlock> : null}
      {catalogRequest.isError ? (
        <FramePanel className="p-0 overflow-clip">
          <EmptyState
            minHeight={240}
            icon={<Database />}
            title="资产目录暂不可用"
            description="暂时无法读取当前库的资产。可重新读取；持续不可用时请联系平台运维核对元数据接入。"
            action={<Button variant="outline" onClick={() => void catalogRequest.refetch()}>重新读取</Button>}
          />
        </FramePanel>
      ) : null}

      {catalogRequest.isSuccess ? (
        <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
          <FramePanel className="flex flex-col p-0 overflow-clip">
            {schemas.length > 1 ? (
              <SegmentedControl
                size="sm"
                className="px-3 py-2"
                render={<RadioGroupPrimitive aria-label="资产库切换" value={schema} onValueChange={(next) => { setSchema(next); setFqn(''); setPage(0) }} />}
              >
                {schemas.map((item) => (
                  <SegmentedControlItem key={item} className="min-h-[26px]" render={<RadioPrimitive.Root value={item} />}>
                    {lineageSchemaLabel(item)}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            ) : null}
            <div className="flex items-center justify-between px-[18px] pt-3 pb-2">
              <h2 className="text-title font-semibold">{instanceServiceLabel(catalogRequest.data.service)} · {lineageSchemaLabel(catalogRequest.data.schema)}<Badge variant="outline">{visible.length}</Badge></h2>
            </div>
            <div className="px-[18px] pb-2">
              <SearchField value={keyword} onValueChange={(value) => { setKeyword(value); setPage(0) }} placeholder="搜索表名或全限定名" className="w-full" />
            </div>
            <SidebarMenu className="m-0 min-h-0 flex-1 px-2 pb-2">
              {visible.slice(currentPage * 8, (currentPage + 1) * 8).map((asset) => {
                const active = asset.fullyQualifiedName === effectiveFqn
                return (
                  <SidebarMenuItem key={asset.fullyQualifiedName}>
                    <SelectionListItem
                      isActive={active}
                      onClick={() => { setFqn(asset.fullyQualifiedName); setTab('fields') }}
                    >
                      <span className="block truncate text-body-sm text-ink-soft">{asset.displayName || asset.name}</span>
                      <span className="block truncate font-mono text-meta text-muted-foreground">{asset.name}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-meta text-muted-foreground">
                        <em className="not-italic">{asset.columnCount} 列</em>
                        <i className="not-italic text-green">已摄取</i>
                      </span>
                    </SelectionListItem>
                  </SidebarMenuItem>
                )
              })}
              {visible.length === 0 ? (
                <li className="px-3 py-6 text-center text-label text-muted-foreground">
                  {assets.length ? '没有匹配的数据资产。' : '当前库暂无已摄取的资产，可切换资产库查看。'}
                  {keyword ? <Button variant="link" size="sm" className="ml-1" onClick={() => { setKeyword(''); setPage(0) }}>清空搜索</Button> : null}
                </li>
              ) : null}
            </SidebarMenu>
            <div className="border-t border-line px-2">
              <TablePagination page={currentPage} pageSize={8} total={visible.length} onPageChange={setPage} label="资产目录分页" compact className="border-t-0 px-1" />
            </div>
            {summary ? <div className="border-t border-line px-3 py-2 text-meta text-muted-foreground">{summary.tableCount} 表 · {summary.columnCount} 列 · {summary.dashboards.length} 个仪表盘消费</div> : null}
          </FramePanel>

          <FramePanel className="p-0 overflow-clip">
            {!selected ? (
              <EmptyState
                minHeight={320}
                icon={<Table2 />}
                title={fqn ? '未找到指定资产' : '当前库暂无资产'}
                description={fqn ? `当前库中没有 ${fqn}，请核对深链或从目录选择资产。` : '资产完成结构元数据摄取后，会在这里显示字段、质量与血缘证据。'}
                action={<Button variant="outline" onClick={() => void catalogRequest.refetch()}>刷新资产目录</Button>}
              />
            ) : (
              <>
                <div className="border-b border-line px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-chip bg-wash px-1.5 py-0.5 text-meta text-muted-foreground">{instanceServiceLabel(catalogRequest.data.service)}</span>
                    <Badge variant="success">元数据已摄取</Badge>
                  </div>
                  <h2 className="mt-1.5 text-subject font-semibold text-ink">{detail?.displayName || selected.displayName || selected.name}</h2>
                  <p className="mt-1 font-mono text-meta text-muted-foreground">{effectiveFqn}</p>
                </div>
                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as typeof tab)}
                >
                  <TabsList variant="underline">
                    <TabsTab key="fields" value="fields">字段结构
                      <Badge variant="outline">{detail?.columns.length}</Badge>
                    </TabsTab>
                    <TabsTab key="quality" value="quality">质量测试
                      <Badge variant="outline">{qualityRequest.data?.length}</Badge>
                    </TabsTab>
                    <TabsTab key="lineage" value="lineage">血缘与消费</TabsTab>
                    <TabsTab key="evidence" value="evidence">资产证据</TabsTab>
                  </TabsList>
                  <TabsPanel value="fields" className="px-5 py-4">
                    {detailRequest.isPending ? <TableSkeleton rows={4} /> : null}
                    {detailRequest.isError ? (
                      <div className="py-6 text-center">
                        <p className="text-body-sm text-ink-soft">字段结构暂不可读</p>
                        <p className="mt-1 text-label text-muted-foreground">目录仍可切换；可以重新读取当前资产。</p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => void detailRequest.refetch()}>重新读取当前资产</Button>
                      </div>
                    ) : null}
                    {detail ? (
                      <>
                        <p className="mb-3 rounded-control border border-line bg-wash px-3 py-2 text-label leading-relaxed text-muted-foreground">
                          {detail.description || '暂无业务描述：结构元数据由元数据中心摄取，业务定义在资产治理流程中补充。'}
                        </p>
                        <DataTable
                          columns={columnColumns}
                          data={detail.columns}
                          getRowId={(column) => column.name}
                          empty={<p className="py-3 text-label text-muted-foreground">暂无字段结构。</p>}
                        />
                        <p className="mt-2 text-meta text-muted-foreground">{detail.columns.length} 列 · 最近更新 {formatDateTime(detail.updatedAt)}</p>
                      </>
                    ) : null}
                  </TabsPanel>

                  <TabsPanel value="quality" className="px-5 py-4">
                    {qualityRequest.isPending ? <TableSkeleton rows={3} /> : null}
                    {qualityRequest.isError ? (
                      <div className="py-6 text-center">
                        <p className="text-body-sm text-ink-soft">质量结果暂不可读</p>
                        <p className="mt-1 text-label text-muted-foreground">不能据此判断当前资产的质量状态。</p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => void qualityRequest.refetch()}>重新读取质量证据</Button>
                      </div>
                    ) : null}
                    {qualityRequest.isSuccess ? (
                      (qualityRequest.data?.length ?? 0) > 0 ? (
                        <>
                          <p className="mb-2 text-label text-muted-foreground">{qualityRequest.data!.length} 条规则 · 来自控制面质量域（规则注册表 + 最近运行）</p>
                          <DataTable columns={qualityColumns} data={qualityRequest.data!} getRowId={(test) => test.ruleId} />
                        </>
                      ) : (
                        <EmptyState minHeight={200} icon={<Database />} title="当前资产尚未关联质量规则" description="质量结论来自独立的规则运行；目录已摄取不代表质量通过。" />
                      )
                    ) : null}
                  </TabsPanel>

                  <TabsPanel value="lineage" className="px-5 py-4">
                    {lineageRequest.isPending ? <TableSkeleton rows={3} /> : null}
                    {lineageRequest.isError ? (
                      <div className="py-6 text-center">
                        <p className="text-body-sm text-ink-soft">血缘暂不可读</p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => void lineageRequest.refetch()}>重新读取血缘</Button>
                      </div>
                    ) : null}
                    {lineage ? (
                      <>
                        <p className="mb-3 text-label text-muted-foreground">上游是数据来源，下游是产出与消费；列级映射随节点展示。</p>
                        <div className="flex flex-wrap items-stretch gap-2">
                          {lineage.upstreams.map((node) => <LineageNode key={node.fullyQualifiedName} node={node} direction="up" />)}
                          <div className="min-w-[150px] flex-1 rounded-control border border-blue-line bg-blue-soft px-3 py-2 text-center">
                            <span className="block text-meta text-muted-foreground">当前资产</span>
                            <strong className="mt-1 block text-label text-blue">{selected.name}</strong>
                            <small className="block text-meta text-muted-foreground">{instanceServiceLabel(catalogRequest.data.service)}</small>
                          </div>
                          {lineage.downstreams.map((node) => <LineageNode key={node.fullyQualifiedName} node={node} direction="down" />)}
                        </div>
                        {lineage.upstreams.length + lineage.downstreams.length === 0 ? (
                          <p className="mt-3 rounded-control border border-line bg-wash px-3 py-2 text-label text-muted-foreground">暂无已登记的上下游（单源资产，消费链待建立）。</p>
                        ) : (
                          <dl className="mt-3 grid grid-cols-3 gap-4 rounded-control border border-line bg-wash px-3 py-2.5 max-[900px]:grid-cols-1">
                            <div><dt className="text-meta text-muted-foreground">上游来源</dt><dd className="m-0 text-body-sm text-ink-soft">{lineage.upstreams.length} 个对象</dd></div>
                            <div><dt className="text-meta text-muted-foreground">下游产出</dt><dd className="m-0 text-body-sm text-ink-soft">{lineage.downstreams.length} 个对象</dd></div>
                            <div><dt className="text-meta text-muted-foreground">消费仪表盘</dt><dd className="m-0 text-body-sm text-ink-soft">{lineage.downstreams.filter((node) => node.type === 'dashboard' || node.type === 'dataModel').length} 个关联</dd></div>
                          </dl>
                        )}
                      </>
                    ) : null}
                  </TabsPanel>

                  <TabsPanel value="evidence" className="px-5 py-4">
                    <dl className="grid grid-cols-2 gap-4">
                      <div><dt className="text-meta text-muted-foreground">元数据服务</dt><dd className="m-0 text-body-sm text-ink-soft">{instanceServiceLabel(catalogRequest.data.service)}</dd></div>
                      <div><dt className="text-meta text-muted-foreground">摄取范围</dt><dd className="m-0 text-body-sm text-ink-soft">{schemas.map(lineageSchemaLabel).join('、')}（只读结构元数据，无数据采样）</dd></div>
                      <div><dt className="text-meta text-muted-foreground">资产数量</dt><dd className="m-0 text-body-sm text-ink-soft">{summary ? `${summary.tableCount} 表 · ${summary.columnCount} 列` : '汇总暂不可用'}</dd></div>
                      <div><dt className="text-meta text-muted-foreground">读取时间</dt><dd className="m-0 text-body-sm text-ink-soft">{formatDateTime(catalogRequest.data.fetchedAt)}</dd></div>
                    </dl>
                    {summary && summary.dashboards.length > 0 ? (
                      <div className="mt-4">
                        <h3 className="mb-1.5 text-label font-medium text-ink-soft">消费仪表盘（{instanceServiceLabel(summary.dashboardService)}）</h3>
                        <ul className="m-0 list-none space-y-1 p-0">
                          {summary.dashboards.map((dashboard) => (
                            <li key={dashboard.fullyQualifiedName} className="flex items-center gap-2 text-label text-muted-foreground">
                              <ChartNoAxesCombined size={14} />{dashboard.displayName || dashboard.fullyQualifiedName}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </TabsPanel>
                </Tabs>
                {detailRequest.isSuccess && detail ? <p className="border-t border-line px-5 py-2 text-meta text-muted-foreground">结构元数据只读；业务定义、质量结论与血缘证据各自独立来源，不互相替代。</p> : null}
              </>
            )}
          </FramePanel>
        </div>
      ) : null}
    </div>
  )
}

function LineageNode({ node, direction }: { node: LineageNodeView; direction: 'up' | 'down' }) {
  return (
    <div className="min-w-[150px] flex-1 rounded-control border border-line bg-wash px-3 py-2 text-center">
      <span className="block text-meta text-muted-foreground">{lineageNodeKindLabel[node.type] ?? NODE_ICONS[node.type] ?? '对象'}{direction === 'up' ? ' · 上游' : ' · 下游'}</span>
      <Tooltip>
        <TooltipTrigger render={<strong className="mt-1 block truncate text-label text-ink-soft" />}>{node.displayName || shortNodeName(node)}</TooltipTrigger>
        <TooltipPopup>{node.fullyQualifiedName}</TooltipPopup>
      </Tooltip>
      <small className="block text-meta text-muted-foreground">{node.fullyQualifiedName.split('.')[0]}</small>
      {node.columnMappings.length > 0 ? (
        <small className="mt-1 block text-meta text-muted-foreground">{node.columnMappings.length} 条列级映射</small>
      ) : null}
    </div>
  )
}

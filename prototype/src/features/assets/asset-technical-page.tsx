import { useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { ArrowLeft, Database, Rows3, TableProperties } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { SearchField } from '../../components/ui/input'
import { Breadcrumb, PageHeading } from '../../components/ui/page-heading'
import { Panel, PanelHead } from '../../components/ui/panel'
import { EmptyState, LoadingBlock } from '../../components/ui/states'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { formatDateTime } from '../../data/domain'
import {
  lineageNodeKindLabel,
  lineageSchemaLabel,
  shortNodeName,
  type LineageAssetColumn,
} from '../../data/lineageApi'
import { deepLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { assetCatalogQuery, assetDetailQuery, assetLineageQuery, lineageSummaryQuery } from './queries'

const columnHelper = listColumnHelper<LineageAssetColumn>()

/**
 * 资产技术视图：以全限定名定位（?asset=doris-dataos.ods_ep.ep_order），
 * 面向数据开发与运维；业务定义仍在资产详情。无参数时提供资产选择器，
 * 不停留在死提示（旧页同口径）。
 */
export function AssetTechnicalPage() {
  const navigate = usePortalNavigate()
  const search = useSearch({ strict: false }) as { asset?: string; db?: string }
  const fqn = search.asset ?? ''
  const [page, setPage] = useState(0)
  const [keyword, setKeyword] = useState('')

  const detailRequest = useQuery(assetDetailQuery(fqn))
  const lineageRequest = useQuery(assetLineageQuery(fqn))
  const summaryRequest = useQuery({ ...lineageSummaryQuery(), enabled: !fqn })
  const pickerSchema = search.db ?? summaryRequest.data?.schemas?.[0] ?? 'ods_ep'
  const catalogRequest = useQuery({ ...assetCatalogQuery(pickerSchema), enabled: !fqn })

  const detail = detailRequest.data
  const lineage = lineageRequest.data
  const backPath = deepLinks.asset(detail?.fullyQualifiedName || fqn)

  const columns = columnHelper.columns([
    columnHelper.accessor('name', { header: '物理字段', cell: ({ row }) => <code className="font-mono text-label text-[#6b778a]">{row.original.name}</code> }),
    columnHelper.accessor('dataType', { header: '类型', size: 180 }),
    columnHelper.display({ id: 'description', header: '说明', cell: ({ row }) => <span className="text-label text-[#6b7789]">{row.original.description || '—'}</span> }),
  ])

  const pickerAssets = (catalogRequest.data?.assets ?? []).filter((asset) => {
    const text = keyword.trim().toLowerCase()
    return !text || `${asset.name}${asset.fullyQualifiedName}${asset.displayName}`.toLowerCase().includes(text)
  })
  const pageCount = Math.max(1, Math.ceil(pickerAssets.length / 10))
  const currentPage = Math.min(page, pageCount - 1)

  if (!fqn) {
    return (
      <div>
        <Breadcrumb items={[{ label: '数据管理' }, { label: '数据资产' }, { label: '技术视图' }]} />
        <PageHeading
          title="技术视图"
          description="面向数据开发与运维人员的结构、血缘和同步证据；业务定义仍以资产详情为准。"
          actions={<Button onClick={() => navigate('/assets')}>返回资产目录</Button>}
        />
        <Panel>
          <PanelHead title="选择资产" description={catalogRequest.data ? `${lineageSchemaLabel(catalogRequest.data.schema)} · ${pickerAssets.length} 项` : '按库浏览已摄取资产'} />
          <div className="px-[18px] pb-3">
            <SearchField value={keyword} onValueChange={(value) => { setKeyword(value); setPage(0) }} placeholder="搜索表名或全限定名" />
          </div>
          {catalogRequest.isPending ? <LoadingBlock>正在读取资产目录…</LoadingBlock> : null}
          {catalogRequest.isError ? <EmptyState minHeight={200} icon={<Database />} title="资产目录暂不可用" description="恢复元数据接入后即可选择资产。" action={<Button onClick={() => void catalogRequest.refetch()}>重新读取</Button>} /> : null}
          {catalogRequest.isSuccess ? (
            <>
              <ul className="m-0 list-none px-4 pb-2">
                {pickerAssets.slice(currentPage * 10, (currentPage + 1) * 10).map((asset) => (
                  <li key={asset.fullyQualifiedName}>
                    <button
                      type="button"
                      onClick={() => navigate(deepLinks.technicalAsset(asset.fullyQualifiedName))}
                      className="flex w-full items-center justify-between gap-3 rounded-control px-2 py-2 text-left hover:bg-wash"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-body-sm text-[#43546e]">{asset.displayName || asset.name}</span>
                        <span className="block truncate font-mono text-meta text-[#8b94a1]">{asset.fullyQualifiedName}</span>
                      </span>
                      <span className="shrink-0 text-meta text-[#6c798c]">{asset.columnCount} 列</span>
                    </button>
                  </li>
                ))}
                {pickerAssets.length === 0 ? <li className="py-6 text-center text-label text-muted">当前库没有匹配的资产。</li> : null}
              </ul>
              <TablePagination page={currentPage} pageSize={10} total={pickerAssets.length} onPageChange={setPage} label="资产选择分页" />
            </>
          ) : null}
        </Panel>
      </div>
    )
  }

  return (
    <div>
      <Breadcrumb items={[{ label: '数据管理' }, { label: '数据资产' }, { label: '技术视图' }]} trailing={<span className="font-mono">{fqn}</span>} />
      <PageHeading
        title={detail?.displayName || detail?.name || '技术视图'}
        description="技术元数据快照 · 只读结构元数据与已登记链路。"
        actions={
          <>
            <Button onClick={() => navigate(backPath)}><ArrowLeft size={14} />返回资产详情</Button>
          </>
        }
      />

      {detailRequest.isPending ? <LoadingBlock>正在读取技术元数据…</LoadingBlock> : null}
      {detailRequest.isError ? (
        <Panel>
          <EmptyState
            minHeight={220}
            icon={<TableProperties />}
            title="技术元数据暂不可读"
            description="当前资产的结构或血缘读取失败。可重新读取，或返回资产目录确认当前资产。"
            action={<div className="flex gap-2"><Button onClick={() => void detailRequest.refetch()}>重新读取</Button><Button onClick={() => navigate('/assets')}>返回资产目录</Button></div>}
          />
        </Panel>
      ) : null}

      {detail ? (
        <div className="space-y-3.5">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 items-center justify-center rounded-panel border border-line bg-wash text-[#8098bc]"><TableProperties size={18} /></span>
                <div>
                  <span className="font-mono text-meta text-[#8b94a1]">{detail.fullyQualifiedName}</span>
                  <h2 className="mt-0.5 text-title font-semibold text-[#2c3a4d]">{detail.displayName || detail.name}</h2>
                  <p className="mt-0.5 text-meta text-[#98a2ae]">技术元数据快照 · 元数据中心摄取</p>
                </div>
              </div>
              <Badge tone="success">元数据已摄取</Badge>
            </div>
            <dl className="grid grid-cols-4 gap-4 border-t border-line bg-wash px-5 py-3 max-[1100px]:grid-cols-2">
              <Fact label="实体类型" value="数据表" hint="已摄取的结构元数据" />
              <Fact label="所属服务" value={detail.fullyQualifiedName.split('.')[0]} hint="只读账号摄取" />
              <Fact label="字段数量" value={String(detail.columns.length)} hint="无数据采样" />
              <Fact label="最近更新" value={detail.updatedAt ? formatDateTime(detail.updatedAt) : '—'} hint="元数据中心摄取时间" />
            </dl>
          </Panel>

          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
            <Panel>
              <PanelHead title="字段结构" description="物理字段、类型与业务说明" actions={<Rows3 size={16} className="text-[#8b94a1]" />} />
              <div className="px-5 pb-5">
                <DataTable columns={columns} data={detail.columns} getRowId={(column) => column.name} empty={<p className="py-3 text-label text-muted">当前资产尚无字段结构。</p>} />
              </div>
            </Panel>

            <Panel>
              <PanelHead title="血缘与列级映射" description="上下游对象与声明式列映射" />
              <div className="px-5 pb-5">
                {lineageRequest.isPending ? <LoadingBlock className="min-h-[160px]">正在读取血缘…</LoadingBlock> : null}
                {lineageRequest.isError ? (
                  <div className="py-6 text-center">
                    <p className="text-body-sm text-[#59677d]">血缘暂不可读</p>
                    <Button size="sm" className="mt-2" onClick={() => void lineageRequest.refetch()}>重新读取</Button>
                  </div>
                ) : null}
                {lineage ? (
                  <>
                    <h3 className="mb-1 text-label font-medium text-[#566173]">上游（{lineage.upstreams.length}）</h3>
                    <ul className="m-0 mb-3 list-none space-y-1 p-0">
                      {lineage.upstreams.map((node) => <NodeRow key={node.fullyQualifiedName} label={lineageNodeKindLabel[node.type]} name={node.displayName || shortNodeName(node)} fqn={node.fullyQualifiedName} mappings={node.columnMappings.length} />)}
                      {lineage.upstreams.length === 0 ? <li className="text-label text-muted">暂无上游登记。</li> : null}
                    </ul>
                    <h3 className="mb-1 text-label font-medium text-[#566173]">下游（{lineage.downstreams.length}）</h3>
                    <ul className="m-0 list-none space-y-1 p-0">
                      {lineage.downstreams.map((node) => <NodeRow key={node.fullyQualifiedName} label={lineageNodeKindLabel[node.type]} name={node.displayName || shortNodeName(node)} fqn={node.fullyQualifiedName} mappings={node.columnMappings.length} />)}
                      {lineage.downstreams.length === 0 ? <li className="text-label text-muted">暂无下游登记。</li> : null}
                    </ul>
                  </>
                ) : null}
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="text-meta text-[#8a929e]">{label}</dt>
      <dd className="m-0 mt-0.5 text-body-sm font-medium text-[#4a5666]">{value}</dd>
      <small className="text-meta text-[#98a2ae]">{hint}</small>
    </div>
  )
}

function NodeRow({ label, name, fqn, mappings }: { label: string; name: string; fqn: string; mappings: number }) {
  return (
    <li className="flex items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-label">
      <Badge>{label}</Badge>
      <span className="min-w-0 flex-1 truncate text-[#4a5666]" title={fqn}>{name}</span>
      {mappings > 0 ? <span className="shrink-0 text-meta text-[#7c8795]">{mappings} 条列映射</span> : null}
      <span className="shrink-0 font-mono text-meta text-[#a3adb9]">{fqn.split('.')[0]}</span>
    </li>
  )
}

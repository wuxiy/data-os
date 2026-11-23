import { Badge } from '@/components/ui/badge'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Database, KeyRound, Play, Table2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FormField, FormNotice } from '../../components/kit/form'
import { CodeTextarea, Input } from '../../components/kit/input'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel, PanelHead, ScopeNote } from '../../components/kit/panel'
import { EmptyState, LoadingBlock, LoadingInline } from '../../components/kit/states'
import { DataTable, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  runSourceQuery,
  saveSourceConnection,
  type SourceApiItem,
  type SourceColumnApiItem,
} from '../../data/controlPlane'
import { workLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { ingestionKeys, sourceCatalogsQuery, sourceColumnsQuery, sourceTablesQuery, sourcesQuery } from './queries'
import { errorMessage, sourceDisplayName, sourceStatusView } from './labels'

const columnHelper = listColumnHelper<SourceColumnApiItem>()

/**
 * 数据源浏览（独立工作页，替代旧抽屉）：库 → 表两级懒加载、字段清单与只读 SQL 工作台。
 * 首次浏览先登记非敏感连接（jdbcUrl / username / credentialRef）；明文凭据由服务端拒绝。
 */
export function SourceExplorerPage({ sourceId }: { sourceId: string }) {
  const navigate = usePortalNavigate()
  const sourcesRequest = useQuery(sourcesQuery())
  const source = sourcesRequest.data?.items.find((item) => item.id === sourceId)

  if (sourcesRequest.isPending) return <LoadingBlock>正在读取数据源…</LoadingBlock>
  if (!source) {
    return (
      <Panel>
        <EmptyState
          icon={<TriangleAlert />}
          title="数据源不存在"
          description="该来源可能已被删除，或当前账号没有访问权限。"
          action={<Button variant="outline" onClick={() => navigate('/ingestion')}>返回数据接入</Button>}
        />
      </Panel>
    )
  }

  const status = sourceStatusView(source.status)
  return (
    <div>
      <Breadcrumb items={[{ label: '数据管理' }, { label: '数据接入' }, { label: '数据源浏览' }, { label: sourceDisplayName(source) }]} trailing={<><span>{source.systemType} · {source.protocol}</span></>} />
      <PageHeading
        title={sourceDisplayName(source)}
        description="浏览库表结构、查看字段并执行只读查询；结果行数与超时由服务端强制。"
        actions={
          <>
            <Badge variant={status.tone}>{status.label}</Badge>
            <Button variant="outline" onClick={() => navigate('/ingestion')}>返回列表</Button>
          </>
        }
      />
      {source.connection ? <ExplorerWorkspace source={source} /> : <ConnectionForm source={source} />}
    </div>
  )
}

/** 连接登记：只保存非敏感键，密码与 Secret 走凭据引用。 */
function ConnectionForm({ source }: { source: SourceApiItem }) {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const [jdbcUrl, setJdbcUrl] = useState(source.protocol.toUpperCase() === 'JDBC' ? 'jdbc:postgresql://主机:5432/数据库' : '')
  const [username, setUsername] = useState('')
  const [credentialRef, setCredentialRef] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = { jdbcUrl: jdbcUrl.trim() }
      if (username.trim()) config.username = username.trim()
      if (credentialRef.trim()) config.credentialRef = credentialRef.trim()
      return saveSourceConnection(source.id, config)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.sources() })
      notify('连接配置已登记，可以开始浏览库表')
    },
    onError: (cause) => notify(errorMessage(cause, '连接登记失败，请稍后重试')),
  })

  return (
    <Panel className="max-w-[640px]">
      <PanelHead title="登记连接配置" description="浏览前先登记连接参数；密码、Secret 经凭据服务托管。" />
      <div className="px-5 pb-5">
        <FormNotice icon={<KeyRound />}>
          仅保存库地址、账号与凭据引用；明文密码不会被接受。连接登记不等于连通性检查，检查在数据源列表发起。
        </FormNotice>
        <FormField label="连接地址（JDBC URL）" required htmlFor="explorer-jdbc-url">
          <Input id="explorer-jdbc-url" value={jdbcUrl} onChange={(event) => setJdbcUrl(event.target.value)} placeholder="jdbc:postgresql://主机:5432/数据库" />
        </FormField>
        <FormField label="用户名（只读账号）" htmlFor="explorer-username">
          <Input id="explorer-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如：dataos_ro" />
        </FormField>
        <FormField label="凭据引用" htmlFor="explorer-credential-ref" hint="已登记凭据的引用名；密码由凭据服务托管。">
          <Input id="explorer-credential-ref" value={credentialRef} onChange={(event) => setCredentialRef(event.target.value)} placeholder="例如：cred-lis-ro" />
        </FormField>
        <div className="flex items-center gap-2">
          <Button disabled={!jdbcUrl.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? '登记中…' : '保存连接配置'}
          </Button>
          <Button variant="outline" onClick={() => navigate('/ingestion')}>返回列表</Button>
        </div>
      </div>
    </Panel>
  )
}

/** 浏览工作区：库表树 + 字段清单 + SQL 工作台。 */
function ExplorerWorkspace({ source }: { source: SourceApiItem }) {
  const notify = useNotice()
  const [expandedCatalog, setExpandedCatalog] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<{ catalog: string; table: string } | null>(null)
  const [sql, setSql] = useState('')

  const catalogsRequest = useQuery(sourceCatalogsQuery(source.id))
  const tablesRequest = useQuery({ ...sourceTablesQuery(source.id, expandedCatalog ?? ''), enabled: expandedCatalog !== null })
  const columnsRequest = useQuery({
    ...sourceColumnsQuery(source.id, selectedTable?.catalog ?? '', selectedTable?.table ?? ''),
    enabled: selectedTable !== null,
  })

  useEffect(() => {
    if (selectedTable) setSql(`SELECT * FROM ${selectedTable.table} LIMIT 100`)
  }, [selectedTable])

  const queryMutation = useMutation({
    mutationFn: () => runSourceQuery(source.id, { sql, catalog: selectedTable?.catalog ?? expandedCatalog ?? undefined }),
    onSuccess: (result) => notify(result.truncated ? '查询完成，结果已按行数上限截断' : '查询完成'),
    onError: (cause) => notify(errorMessage(cause, '查询执行失败，请查看错误提示')),
  })

  const columnColumns = columnHelper.columns([
    columnHelper.accessor('name', { header: '字段', cell: ({ row }) => <span className="font-medium text-ink">{row.original.name}</span> }),
    columnHelper.accessor('typeName', { header: '类型' }),
    columnHelper.display({ id: 'nullable', header: '可空', size: 80, cell: ({ row }) => row.original.nullable ? '是' : '否' }),
    columnHelper.display({ id: 'remark', header: '注释', cell: ({ row }) => row.original.remark || '—' }),
  ])

  const result = queryMutation.data
  const resultColumns = result
    ? result.columns.map((column, index) => ({
      id: `c-${index}`,
      header: column,
      cell: (row: (string | null)[]) => row[index] ?? '—',
    }))
    : []

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-0 overflow-clip rounded-panel border border-line bg-paper max-[1100px]:grid-cols-1">
      <aside className="border-r border-line bg-[#fdfdfe] px-3 py-4 max-[1100px]:border-r-0 max-[1100px]:border-b">
        <h2 className="px-2 pb-3 text-label font-medium text-muted-foreground">库与表</h2>
        {catalogsRequest.isPending ? <LoadingInline>正在读取库清单…</LoadingInline> : null}
        {catalogsRequest.isError ? (
          <div role="alert" className="rounded-control border border-red-line bg-red-soft px-2.5 py-2 text-label text-red">
            库清单读取失败
            <Button size="sm" variant="link" className="ml-1" onClick={() => void catalogsRequest.refetch()}>重试</Button>
          </div>
        ) : null}
        {(catalogsRequest.data?.catalogs.length ?? 0) === 0 && catalogsRequest.isSuccess ? (
          <p className="px-2 text-label text-muted-foreground">该数据源未返回任何库，请确认连接地址与账号权限。</p>
        ) : null}
        {catalogsRequest.data?.truncated ? <p className="px-2 pb-2 text-meta text-amber">库数量较多，仅显示前 200 个</p> : null}
        <ul className="m-0 list-none p-0">
          {(catalogsRequest.data?.catalogs ?? []).map((catalog) => {
            const expanded = expandedCatalog === catalog
            return (
              <li key={catalog}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => { setExpandedCatalog(expanded ? null : catalog); setSelectedTable(null) }}
                  className="flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-label text-ink-soft hover:bg-wash"
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <Database size={13} />
                  <span className="truncate">{catalog}</span>
                </button>
                {expanded ? (
                  <div className="mb-1 ml-5 border-l border-line pl-2">
                    {tablesRequest.isPending ? <p className="px-1 py-1 text-meta text-muted-foreground">正在读取表清单…</p> : null}
                    {tablesRequest.isError ? <p className="px-1 py-1 text-meta text-red">表清单读取失败</p> : null}
                    {(tablesRequest.data?.tables ?? []).map((table) => {
                      const active = selectedTable?.catalog === catalog && selectedTable.table === table.name
                      return (
                        <button
                          key={table.name}
                          type="button"
                          title={table.remark || table.type}
                          onClick={() => setSelectedTable({ catalog, table: table.name })}
                          className={`flex w-full items-center gap-1.5 rounded-chip px-1.5 py-1 text-left text-meta ${active ? 'bg-blue-soft text-blue' : 'text-ink-soft hover:bg-wash'}`}
                        >
                          <Table2 size={12} />
                          <span className="truncate">{table.name}</span>
                        </button>
                      )
                    })}
                    {(tablesRequest.data?.tables.length ?? 0) === 0 && !tablesRequest.isPending ? <p className="px-1 py-1 text-meta text-muted-foreground">该库没有可浏览的表</p> : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </aside>

      <div className="min-w-0">
        <ScopeNote>浏览使用只读账号；查询仅限单条 SELECT/WITH，返回行数上限 200。</ScopeNote>
        {selectedTable ? (
          <div className="border-b border-line">
            <div className="flex items-center gap-2 px-4 pt-3 text-label text-ink-soft">
              <Table2 size={13} /><strong>{selectedTable.table}</strong><span className="text-muted-foreground">字段清单</span>
            </div>
            {columnsRequest.isPending ? <div className="px-4 py-3"><LoadingInline>正在读取字段…</LoadingInline></div> : null}
            {columnsRequest.isError ? <p className="px-4 py-3 text-label text-red">字段清单读取失败</p> : null}
            {columnsRequest.data ? (
              <DataTable
                columns={columnColumns}
                data={columnsRequest.data.columns}
                getRowId={(column) => column.name}
                empty={<EmptyState minHeight={120} title="未读取到字段信息" />}
              />
            ) : null}
          </div>
        ) : (
          <p className="px-4 py-4 text-label text-muted-foreground">从左侧选择一张表查看字段清单；也可以直接在下方执行只读查询。</p>
        )}

        <div className="px-4 py-4">
          <div className="mb-2 flex items-center gap-2 text-label text-ink-soft">
            <Play size={13} /><strong>SQL 工作台</strong><span className="text-muted-foreground">只读 · 单条查询 · 行数上限 200</span>
            {selectedTable ? <span className="ml-auto text-meta text-muted-foreground">当前库：{selectedTable.catalog}</span> : null}
          </div>
          <CodeTextarea
            aria-label="SQL 查询语句"
            className="min-h-[120px]"
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            spellCheck={false}
            placeholder="例如：SELECT * FROM 表名 LIMIT 100"
          />
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" disabled={!sql.trim() || queryMutation.isPending} onClick={() => queryMutation.mutate()}>
              <Play size={13} />{queryMutation.isPending ? '查询中…' : '执行查询'}
            </Button>
            <span className="text-meta text-muted-foreground">使用只读账号；结果不写入任何业务表。</span>
          </div>
          {queryMutation.isError ? <p role="alert" className="mt-2 text-body-sm text-red">{errorMessage(queryMutation.error, '查询执行失败')}</p> : null}
          {result ? (
            <div className="mt-3">
              {result.truncated ? <p role="status" className="mb-2 text-meta text-amber">结果超出返回上限，已截断显示前 {result.rows.length} 行。</p> : null}
              {result.rows.length === 0 ? <p className="text-label text-muted-foreground">查询没有返回数据行。</p> : (
                <div className="overflow-x-auto rounded-control border border-line">
                  <table className="w-full border-collapse text-left text-label">
                    <thead className="bg-wash text-muted-foreground">
                      <tr>{resultColumns.map((column) => <th key={column.id} className="border-b border-line px-3 py-2 font-normal">{column.header}</th>)}</tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-line-soft last:border-b-0">
                          {resultColumns.map((column) => <td key={column.id} className="px-3 py-2 font-mono text-meta text-ink-soft">{column.cell(row)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

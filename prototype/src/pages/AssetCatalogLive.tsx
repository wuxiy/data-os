import { Surface } from '../components/ui/Surface'
import { ChartNoAxesCombined, Database, LayoutDashboard, Search, Shapes, Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '../components/ui/PageHeader'
import {
  fetchAssetQualityTests,
  fetchLineageAsset,
  fetchLineageCatalog,
  fetchLineageGraph,
  fetchLineageSummary,
  lineageNodeKindLabel,
  lineageSchemaLabel,
  shortNodeName,
  type AssetQualityTest,
  type LineageAssetCatalog,
  type LineageAssetColumn,
  type LineageAssetDetail,
  type LineageAssetLineage,
  type LineageSummaryView,
} from '../data/lineageApi'
import { formatDateTime } from '../data/domain'
import { useApiResource } from '../hooks/useApiResource'
import { useKeyedResource } from '../hooks/useKeyedResource'
import { usePaged } from '../hooks/usePaged'
import { Pager } from '../components/ui/Pager'
import styles from './IntegrationPages.module.css'
import local from './ConsumptionWorkspace.module.css'

const nodeIcons = {
  table: Table2,
  dataModel: Shapes,
  dashboard: LayoutDashboard,
  chart: ChartNoAxesCombined,
  unknown: Database,
} as const

// 状态语义映射：自研 tone → antd Tag 语义色。
const TAG_COLOR = {
  healthy: 'success',
  warning: 'warning',
  neutral: 'default',
} as const

/**
 * 数据资产目录（真实链路）：资产列表/详情/血缘全部来自控制面血缘 BFF
 * （元数据中心摄取的 doris-dataos 资产，引擎名不进业务文案）。BFF 未配置
 * 或不可达时明确显示「待接入」，不回退静态样例。
 */
export function AssetCatalogLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [catalog, setCatalog] = useState<LineageAssetCatalog | null>(null)
  const [summary, setSummary] = useState<LineageSummaryView | null>(null)
  const [query, setQuery] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [detailReload, setDetailReload] = useState(0)
  const [activeSchema, setActiveSchema] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('db')
    return requested || 'ods_ep'
  })
  const [selectedFqn, setSelectedFqn] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('asset')
    return requested && requested.includes('.') ? requested : ''
  })
  const catalogState = useApiResource({
    reloadKey: `${activeSchema}:${reloadTick}`,
    load: async (signal) => {
      const [catalogResponse, summaryResponse] = await Promise.all([
        fetchLineageCatalog(activeSchema, signal),
        fetchLineageSummary(signal),
      ])
      return { catalogResponse, summaryResponse }
    },
    onData: ({ catalogResponse, summaryResponse }) => {
      setCatalog(catalogResponse)
      setSummary(summaryResponse)
    },
    onUnavailable: () => setCatalog(null),
    timeoutMs: 15000,
  })

  const schemas = summary?.schemas ?? [activeSchema]
  const assets = catalog?.assets ?? []

  function switchSchema(schema: string) {
    if (schema === activeSchema) return
    setActiveSchema(schema)
    setSelectedFqn('')
    setRailPage(0)
  }
  const effectiveFqn = useMemo(() => {
    if (selectedFqn && assets.some((asset) => asset.fullyQualifiedName === selectedFqn)) return selectedFqn
    return assets[0]?.fullyQualifiedName ?? ''
  }, [assets, selectedFqn])
  const selected = assets.find((asset) => asset.fullyQualifiedName === effectiveFqn) ?? null
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return assets
    return assets.filter((asset) => `${asset.name}${asset.fullyQualifiedName}${asset.displayName}`.toLowerCase().includes(keyword))
  }, [assets, query])
  // 医院资产目录动辄数百表：侧栏分页，搜索与切库重置回第一页。
  const RAIL_PAGE_SIZE = 8
  const { page: railPage, setPage: setRailPage, paged: pagedAssets, pageCount: railPageCount } = usePaged(visible, RAIL_PAGE_SIZE)

  const [detail, setDetail] = useState<LineageAssetDetail | null>(null)
  const [lineage, setLineage] = useState<LineageAssetLineage | null>(null)
  const [qualityTests, setQualityTests] = useState<AssetQualityTest[]>([])
  const [qualityTestsAvailable, setQualityTestsAvailable] = useState(true)
  // 键控从属加载：切换资产即中止重取；质量测试是次级资源，失败不塌详情。
  const detailState = useKeyedResource({
    key: effectiveFqn ? `${effectiveFqn}:${detailReload}` : null,
    load: (signal) => Promise.all([
      fetchLineageAsset(effectiveFqn, signal),
      fetchLineageGraph(effectiveFqn, signal),
      fetchAssetQualityTests(effectiveFqn, signal).catch(() => null),
    ]),
    onData: ([detailResponse, lineageResponse, testsResponse]) => {
      setDetail(detailResponse)
      setLineage(lineageResponse)
      setQualityTests(testsResponse ?? [])
      setQualityTestsAvailable(testsResponse !== null)
    },
    onReset: () => {
      setDetail(null)
      setLineage(null)
      setQualityTests([])
      setQualityTestsAvailable(true)
    },
  })

  // 字段结构分页：宽表列数动辄数十，字段表 10 条一页（usePaged 保留数据逻辑，渲染层走 Table 内建分页）。
  const COLUMNS_PAGE_SIZE = 10
  const { page: columnsPage, setPage: setColumnsPage, paged: pagedColumns, pageCount: columnsPageCount } = usePaged(detail?.columns ?? [], COLUMNS_PAGE_SIZE)

  // 字段结构列定义：物理字段等宽文本列，无数字列。
  const columnColumns: ColumnsType<LineageAssetColumn> = [
    { title: '物理字段', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'dataType', key: 'dataType' },
    { title: '说明', key: 'description', render: (_, column) => column.description || '—' },
  ]

  // 质量测试列定义：结论列用语义色 Tag。
  const qualityTestColumns: ColumnsType<AssetQualityTest> = [
    { title: '规则', dataIndex: 'ruleId', key: 'ruleId' },
    { title: '数据集', dataIndex: 'datasetId', key: 'datasetId' },
    {
      title: '最近结论',
      key: 'result',
      render: (_, test) => (
        <Tag color={test.lastRun ? (test.lastRun.passed ? TAG_COLOR.healthy : TAG_COLOR.warning) : TAG_COLOR.neutral}>
          {test.lastRun ? (test.lastRun.passed ? '通过' : '未通过') : '未运行'}
        </Tag>
      ),
    },
    { title: '完成时间', key: 'finishedAt', render: (_, test) => formatDateTime(test.lastRun?.finishedAt) },
  ]

  if (catalogState !== 'live' || !catalog) {
    return (
      <div className={styles.integrationPage}>
        <PageHeader title="数据资产" eyebrow="资产目录与影响分析" subtitle="围绕同一资产查看业务定义、字段结构、质量结果与消费影响。" compact />
        <section className={local.statePanel} role="status" aria-busy={catalogState === 'loading'}>
          <h2>{catalogState === 'loading' ? '正在读取资产目录' : '资产目录暂不可用'}</h2>
          <p>{catalogState === 'loading' ? '正在获取结构元数据、资产范围和已登记消费。' : '暂时无法读取当前库的资产。可重新读取；持续不可用时请联系平台运维核对元数据接入。'}</p>
          {catalogState === 'loading' ? <Skeleton active paragraph={{ rows: 4 }} /> : <Button onClick={() => setReloadTick((tick) => tick + 1)}>重新读取</Button>}
        </section>
      </div>
    )
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader title="数据资产" eyebrow="资产目录与影响分析" subtitle="围绕同一资产查看业务定义、字段结构、质量结果与消费影响。" compact />
      <div className={styles.integrationWorkspace}>
        <Surface><aside className={styles.catalogRail} aria-label="数据资产目录">
          {schemas.length > 1 ? (
            <div className={styles.schemaTabs} role="tablist" aria-label="资产库切换">
              {schemas.map((schema) => (
                <button
                  key={schema}
                  role="tab"
                  aria-selected={schema === activeSchema}
                  className={`${styles.schemaTab} ${schema === activeSchema ? styles.schemaTabActive : ''}`}
                  onClick={() => switchSchema(schema)}
                >
                  {lineageSchemaLabel(schema)}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.railHeader}>
            <h2>{catalog.service} · {lineageSchemaLabel(catalog.schema)}</h2>
            <span className={styles.railCount}>{visible.length} 项</span>
          </div>
          <label className={styles.railSearch}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setRailPage(0) }} placeholder="搜索表名或全限定名" aria-label="搜索数据资产" />
          </label>
          <div className={styles.railLabel}>元数据摄取资产</div>
          <ul className={styles.catalogList}>
            {pagedAssets.map((asset) => (
              <li key={asset.fullyQualifiedName}>
                <button
                  className={`${styles.catalogItem} ${asset.fullyQualifiedName === effectiveFqn ? styles.catalogItemSelected : ''}`}
                  onClick={() => setSelectedFqn(asset.fullyQualifiedName)}
                  aria-pressed={asset.fullyQualifiedName === effectiveFqn}
                >
                  <strong>{asset.displayName || asset.name}</strong>
                  <span>{asset.name}</span>
                  <div className={styles.catalogMeta}>
                    <em>{asset.columnCount} 列</em>
                    <i className={styles.healthMark}>已摄取</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <div className={local.emptyDirectory}><p>{assets.length ? '没有匹配的数据资产。' : '当前库暂无已摄取的资产，可切换资产库查看。'}</p>{query ? <Button size="small" onClick={() => { setQuery(''); setRailPage(0) }}>清空搜索</Button> : null}</div> : null}
          <Pager label="资产目录分页" page={railPage} pageCount={railPageCount} pageSize={RAIL_PAGE_SIZE} onPageChange={setRailPage} />
          {summary ? (
            <div className={styles.catalogMeta}>
              <em>{summary.tableCount} 表 · {summary.columnCount} 列</em>
              <i>{summary.dashboards.length} 个仪表盘消费</i>
            </div>
          ) : null}
        </aside></Surface>

        <section className={styles.workspaceMain} aria-label={`${selected?.name ?? '资产'}详情`}>
          {!selected ? <section className={local.statePanel}><h2>当前库暂无资产</h2><p>资产完成结构元数据摄取后，会在这里显示字段、质量与血缘证据。</p><Button onClick={() => setReloadTick((tick) => tick + 1)}>刷新资产目录</Button></section> : <>
          <div className={styles.assetToolbar}>
            <div className={styles.assetIdentity}>
              <div className={styles.assetIdentityTop}><span className={styles.assetCode}>{catalog.service}</span><Tag color={TAG_COLOR.healthy}>元数据已摄取</Tag></div>
              <h2>{detail?.displayName || selected?.displayName || selected?.name || '—'}</h2>
              <p>{effectiveFqn || '—'}</p>
            </div>
            <div className={styles.toolbarActions}>
              <Button onClick={() => onNotice('资产关注已开启，结构变化将进入个人待办')}>关注变化</Button>
            </div>
          </div>

          <div className={styles.assetBody}>
            {(detailState === 'loading' || detailState === 'idle') ? <section className={local.inlineState} role="status" aria-busy="true"><p>正在读取资产结构与血缘…</p><Skeleton active paragraph={{ rows: 3 }} /></section> : null}
            {detailState === 'error' ? <section className={local.inlineState} role="status"><Tag color={TAG_COLOR.warning}>读取失败</Tag><p>当前资产详情或血缘暂不可读。目录仍可切换，也可以重新读取。</p><Button size="small" onClick={() => setDetailReload((tick) => tick + 1)}>重新读取当前资产</Button></section> : null}
            {detail ? (
              <Surface><section className={styles.contentPanel}>
                <div className={styles.contentPanelHeader}>
                  <h3>字段结构</h3>
                  <span>{detail.columns.length} 列 · 最近更新 {formatDateTime(detail.updatedAt)}</span>
                </div>
                <div className={styles.descriptionBlock}><p>{detail.description || '暂无业务描述：结构元数据由元数据中心摄取，业务定义在资产治理流程中补充。'}</p></div>
                <Table<LineageAssetColumn>
                  scroll={{ x: 'max-content' }}
                  rowKey="name"
                  columns={columnColumns}
                  dataSource={pagedColumns}
                  loading={detailState === 'loading'}
                  pagination={{
                    current: columnsPage + 1,
                    pageSize: COLUMNS_PAGE_SIZE,
                    total: detail.columns.length,
                    showSizeChanger: false,
                    onChange: (page) => setColumnsPage(page - 1),
                  }}
                  locale={{ emptyText: detailState === 'loading' ? '正在读取字段结构…' : detailState === 'error' ? '字段结构暂时不可读，请稍后重试。' : '暂无字段结构。' }}
                />
              </section></Surface>
            ) : null}
            {qualityTests.length > 0 ? (
              <Surface><section className={styles.contentPanel}>
                <div className={styles.contentPanelHeader}>
                  <h3>质量测试</h3>
                  <span>{qualityTests.length} 条规则 · 来自控制面质量域（规则注册表 + 最近运行）</span>
                </div>
                <Table<AssetQualityTest>
                  scroll={{ x: 'max-content' }}
                  rowKey="ruleId"
                  columns={qualityTestColumns}
                  dataSource={qualityTests}
                  pagination={false}
                />
              </section></Surface>
            ) : null}
            {detailState === 'ready' && qualityTests.length === 0 ? <section className={local.inlineState}><strong>质量结果</strong><p>{qualityTestsAvailable ? '当前资产尚未关联质量规则，暂无可核对的质量结论。' : '质量结果暂不可读，不能据此判断当前资产的质量状态。'}</p>{!qualityTestsAvailable ? <Button size="small" onClick={() => setDetailReload((tick) => tick + 1)}>重新读取质量证据</Button> : null}</section> : null}
            {lineage ? (
              <Surface><section className={styles.lineageCanvas} aria-label="血缘与影响">
                <div className={styles.lineageSummary}>
                  <div><h3>血缘与消费</h3><span>血缘来自元数据中心：上游为数据来源，下游为产出与消费（数据模型 / 仪表盘）</span></div>
                  <Tag color={TAG_COLOR.healthy}>{lineage.upstreams.length + lineage.downstreams.length} 个关联节点</Tag>
                </div>
                <div className={styles.lineageRow}>
                  {lineage.upstreams.map((node) => {
                    const Icon = nodeIcons[node.type] ?? nodeIcons.unknown
                    return (
                      <article className={styles.lineageNode} key={node.fullyQualifiedName}>
                        <span className={styles.lineageNodeIcon}><Icon size={16} /></span>
                        <span>{lineageNodeKindLabel[node.type]}</span>
                        <strong>{shortNodeName(node)}</strong>
                        <small>{node.fullyQualifiedName.split('.')[0]}</small>
                        {renderColumnMappings(node, false)}
                      </article>
                    )
                  })}
                  <article className={`${styles.lineageNode} ${styles.lineageNodeAsset}`}>
                    <span className={styles.lineageNodeIcon}><Table2 size={16} /></span>
                    <span>当前资产</span>
                    <strong>{selected?.name ?? effectiveFqn.split('.').pop()}</strong>
                    <small>{catalog.service}</small>
                  </article>
                  {lineage.downstreams.map((node) => {
                    const Icon = nodeIcons[node.type] ?? nodeIcons.unknown
                    return (
                      <article className={styles.lineageNode} key={node.fullyQualifiedName}>
                        <span className={styles.lineageNodeIcon}><Icon size={16} /></span>
                        <span>{lineageNodeKindLabel[node.type]}</span>
                        <strong>{shortNodeName(node)}</strong>
                        <small>{node.fullyQualifiedName.split('.')[0]}</small>
                        {renderColumnMappings(node, true)}
                      </article>
                    )
                  })}
                </div>
                {lineage.upstreams.length + lineage.downstreams.length === 0 ? (
                  <div className={styles.lineageImpact}><div className={styles.impactItem}><span>血缘关联</span><strong>暂无已登记的上下游（单源资产，消费链待建立）</strong></div></div>
                ) : (
                  <div className={styles.lineageImpact}>
                    <div className={styles.impactItem}><span>上游来源</span><strong>{lineage.upstreams.length} 个对象{lineage.upstreams.length ? `（${summarizeTypes(lineage.upstreams)}）` : ''}</strong></div>
                    <div className={styles.impactItem}><span>下游产出</span><strong>{lineage.downstreams.length} 个对象{lineage.downstreams.length ? `（${summarizeTypes(lineage.downstreams)}）` : ''}</strong></div>
                    <div className={styles.impactItem}><span>消费仪表盘</span><strong>{lineage.downstreams.filter((node) => node.type === 'dashboard' || node.type === 'dataModel').length} 个关联</strong></div>
                  </div>
                )}
              </section></Surface>
            ) : null}
          </div>
          </>}
        </section>

        <Surface><aside className={styles.evidenceRail} aria-label="资产来源证据">
          <div className={styles.evidenceHeader}><h2>资产证据</h2><Tag color={TAG_COLOR.healthy}>元数据中心</Tag></div>
          <div className={styles.evidenceBody}>
            <dl className={styles.evidenceDefinition}>
              <div><dt>元数据服务</dt><dd>{catalog.service}</dd></div>
              <div><dt>摄取范围</dt><dd>{schemas.map(lineageSchemaLabel).join('、')}（只读结构元数据，无数据采样）</dd></div>
              <div><dt>资产数量</dt><dd>{summary?.tableCount ?? assets.length} 表 · {summary?.columnCount ?? 0} 列</dd></div>
              <div><dt>读取时间</dt><dd>{formatDateTime(catalog.fetchedAt)}</dd></div>
            </dl>
            {summary && summary.dashboards.length > 0 ? (
              <section className={styles.evidenceSection}>
                <h3>消费仪表盘（{summary.dashboardService}）</h3>
                <ul className={styles.relatedList}>
                  {summary.dashboards.map((dashboard) => <li key={dashboard.fullyQualifiedName}><ChartNoAxesCombined size={14} />{dashboard.displayName || dashboard.fullyQualifiedName}</li>)}
                </ul>
              </section>
            ) : null}
          </div>
        </aside></Surface>
      </div>
    </div>
  )
}

function summarizeTypes(nodes: { type: string }[]): string {
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  return [...counts.entries()].map(([type, count]) => `${lineageNodeKindLabel[type as keyof typeof lineageNodeKindLabel] ?? type}×${count}`).join('、')
}

type NodeWithMappings = {
  fullyQualifiedName: string
  columnMappings: { fromColumns: string[]; toColumn: string }[]
}

/** 血缘节点的列级映射展开（G7 声明式血缘）：上游方向镜像 from/to。 */
function renderColumnMappings(node: NodeWithMappings, downstream: boolean) {
  const mappings = node.columnMappings ?? []
  if (!mappings.length) return null
  return (
    <div className={styles.columnMappings}>
      <div className={styles.columnMappingsMeta}>
        列级映射 ×{mappings.length}
      </div>
      <ul className={styles.columnMappingList}>
        {mappings.map((mapping) => {
          const left = downstream ? mapping.fromColumns : [mapping.toColumn]
          const right = downstream ? [mapping.toColumn] : mapping.fromColumns
          return (
            <li key={`${mapping.fromColumns.join('+')}->${mapping.toColumn}`}>
              <em>{left.join('+')}</em>
              <span>→</span>
              <code>{right.join('+')}</code>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

import { ChartNoAxesCombined, Database, LayoutDashboard, Search, Shapes, Table2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  fetchLineageAsset,
  fetchLineageCatalog,
  fetchLineageGraph,
  fetchLineageSummary,
  lineageNodeKindLabel,
  shortNodeName,
  type LineageAssetCatalog,
  type LineageAssetDetail,
  type LineageAssetLineage,
  type LineageSummaryView,
} from '../data/lineageApi'
import { useApiResource } from '../hooks/useApiResource'
import styles from './IntegrationPages.module.css'

const nodeIcons = {
  table: Table2,
  dataModel: Shapes,
  dashboard: LayoutDashboard,
  chart: ChartNoAxesCombined,
  unknown: Database,
} as const

/**
 * 数据资产目录（真实链路）：资产列表/详情/血缘全部来自控制面血缘 BFF
 * （OpenMetadata 摄取的 doris-dataos 资产）。BFF 未配置或不可达时明确
 * 显示「待接入」，不回退静态样例。
 */
export function AssetCatalogLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [catalog, setCatalog] = useState<LineageAssetCatalog | null>(null)
  const [summary, setSummary] = useState<LineageSummaryView | null>(null)
  const [query, setQuery] = useState('')
  const [selectedFqn, setSelectedFqn] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('asset')
    return requested && requested.includes('.') ? requested : ''
  })
  const catalogState = useApiResource({
    load: async (signal) => {
      const [catalogResponse, summaryResponse] = await Promise.all([
        fetchLineageCatalog(undefined, signal),
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

  const assets = catalog?.assets ?? []
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

  const [detail, setDetail] = useState<LineageAssetDetail | null>(null)
  const [lineage, setLineage] = useState<LineageAssetLineage | null>(null)
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    if (!effectiveFqn) return
    const controller = new AbortController()
    setDetailState('loading')
    setDetail(null)
    setLineage(null)
    Promise.all([
      fetchLineageAsset(effectiveFqn, controller.signal),
      fetchLineageGraph(effectiveFqn, controller.signal),
    ])
      .then(([detailResponse, lineageResponse]) => {
        setDetail(detailResponse)
        setLineage(lineageResponse)
        setDetailState('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setDetailState('error')
      })
    return () => controller.abort()
  }, [effectiveFqn])

  if (catalogState !== 'live' || !catalog) {
    return (
      <div className={styles.integrationPage}>
        <PageHeader title="数据资产" eyebrow="资产目录与影响分析" subtitle="从业务定义进入字段、质量、血缘和消费证据，不暴露底层元数据控制台" compact />
        <section className={styles.technicalNotice} role="status">
          <StatusTag tone="warning">{catalogState === 'loading' ? '读取中' : '待接入'}</StatusTag>
          <span>{catalogState === 'loading' ? '正在从血缘服务读取资产目录…' : '血缘服务暂不可用：资产目录需要控制面已配置 OpenMetadata（data-os.openmetadata.base-url）。'}</span>
        </section>
      </div>
    )
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader title="数据资产" eyebrow="资产目录与影响分析" subtitle="从业务定义进入字段、质量、血缘和消费证据，不暴露底层元数据控制台" compact />
      <div className={styles.integrationWorkspace}>
        <aside className={styles.catalogRail} aria-label="数据资产目录">
          <div className={styles.railHeader}>
            <h2>{catalog.service} · {catalog.schema}</h2>
            <span className={styles.railCount}>{visible.length} 项</span>
          </div>
          <label className={styles.railSearch}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索表名或全限定名" aria-label="搜索数据资产" />
          </label>
          <div className={styles.railLabel}>OpenMetadata 摄取资产</div>
          <ul className={styles.catalogList}>
            {visible.map((asset) => (
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
          {visible.length === 0 ? <div className={styles.emptyRail}>没有匹配的数据资产，请调整搜索条件。</div> : null}
          {summary ? (
            <div className={styles.catalogMeta}>
              <em>{summary.tableCount} 表 · {summary.columnCount} 列</em>
              <i>{summary.dashboards.length} 个仪表盘消费</i>
            </div>
          ) : null}
        </aside>

        <section className={styles.workspaceMain} aria-label={`${selected?.name ?? '资产'}详情`}>
          <div className={styles.assetToolbar}>
            <div className={styles.assetIdentity}>
              <div className={styles.assetIdentityTop}><span className={styles.assetCode}>{catalog.service}</span><StatusTag tone="healthy">元数据已摄取</StatusTag></div>
              <h2>{detail?.displayName || selected?.displayName || selected?.name || '—'}</h2>
              <p>{effectiveFqn || '—'}</p>
            </div>
            <div className={styles.toolbarActions}>
              <Button onClick={() => onNotice('资产关注已开启，结构变化将进入个人待办')}>关注变化</Button>
            </div>
          </div>

          <div className={styles.assetBody}>
            {detailState === 'loading' ? <div className={styles.technicalNotice}><StatusTag tone="neutral">读取中</StatusTag><span>正在读取资产结构与血缘…</span></div> : null}
            {detailState === 'error' ? <div className={styles.technicalNotice} role="status"><StatusTag tone="warning">读取失败</StatusTag><span>资产详情或血缘暂时不可读，请稍后重试。</span></div> : null}
            {detail ? (
              <section className={styles.contentPanel}>
                <div className={styles.contentPanelHeader}>
                  <h3>字段结构</h3>
                  <span>{detail.columns.length} 列 · 最近更新 {detail.updatedAt ? new Date(detail.updatedAt).toLocaleString('zh-CN') : '—'}</span>
                </div>
                <div className={styles.descriptionBlock}><p>{detail.description || '暂无业务描述：结构元数据来自 OpenMetadata 摄取，业务定义在资产治理流程中补充。'}</p></div>
                <div className={styles.horizontalScroll}>
                  <table className={styles.fieldTable}>
                    <thead><tr><th>物理字段</th><th>类型</th><th>说明</th></tr></thead>
                    <tbody>
                      {detail.columns.map((column) => (
                        <tr key={column.name}><td>{column.name}</td><td>{column.dataType}</td><td>{column.description || '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {lineage ? (
              <section className={styles.lineageCanvas} aria-label="血缘与影响">
                <div className={styles.lineageSummary}>
                  <div><h3>血缘与消费</h3><span>来自 OpenMetadata：上游为消费链（仪表盘 / 数据模型），下游为加工产出</span></div>
                  <StatusTag tone="healthy">{lineage.upstreams.length + lineage.downstreams.length} 个关联节点</StatusTag>
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
                      </article>
                    )
                  })}
                </div>
                {lineage.upstreams.length + lineage.downstreams.length === 0 ? (
                  <div className={styles.lineageImpact}><div className={styles.impactItem}><span>血缘关联</span><strong>暂无已登记的上下游（单源资产，消费链待建立）</strong></div></div>
                ) : (
                  <div className={styles.lineageImpact}>
                    <div className={styles.impactItem}><span>上游消费链</span><strong>{lineage.upstreams.length} 个对象（{summarizeTypes(lineage.upstreams)}）</strong></div>
                    <div className={styles.impactItem}><span>下游影响</span><strong>{lineage.downstreams.length} 个对象</strong></div>
                    <div className={styles.impactItem}><span>消费仪表盘</span><strong>{lineage.upstreams.filter((node) => node.type === 'dashboard').length} 个</strong></div>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </section>

        <aside className={styles.evidenceRail} aria-label="资产来源证据">
          <div className={styles.evidenceHeader}><h2>资产证据</h2><StatusTag tone="healthy">OpenMetadata</StatusTag></div>
          <div className={styles.evidenceBody}>
            <dl className={styles.evidenceDefinition}>
              <div><dt>元数据服务</dt><dd>{catalog.service}</dd></div>
              <div><dt>摄取范围</dt><dd>{catalog.schema}（只读结构元数据，无数据采样）</dd></div>
              <div><dt>资产数量</dt><dd>{summary?.tableCount ?? assets.length} 表 · {summary?.columnCount ?? 0} 列</dd></div>
              <div><dt>读取时间</dt><dd>{catalog.fetchedAt ? new Date(catalog.fetchedAt).toLocaleString('zh-CN') : '—'}</dd></div>
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
        </aside>
      </div>
    </div>
  )
}

function summarizeTypes(nodes: { type: string }[]): string {
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  return [...counts.entries()].map(([type, count]) => `${lineageNodeKindLabel[type as keyof typeof lineageNodeKindLabel] ?? type}×${count}`).join('、')
}

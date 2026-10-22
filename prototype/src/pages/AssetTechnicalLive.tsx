import { Surface } from '../components/ui/Surface'
import { ArrowLeft, Database, Link2, Rows3, TableProperties } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Input, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '../components/ui/PageHeader'
import {
  fetchLineageAsset,
  fetchLineageCatalog,
  fetchLineageGraph,
  fetchLineageSummary,
  lineageNodeKindLabel,
  shortNodeName,
  type LineageAssetColumn,
  type LineageAssetDetail,
  type LineageAssetLineage,
  type LineageAssetSummary,
} from '../data/lineageApi'
import { formatDateTime } from '../data/domain'
import { routePaths } from '../data/routes'
import { useApiResource } from '../hooks/useApiResource'
import { useKeyedResource } from '../hooks/useKeyedResource'
import styles from './IntegrationPages.module.css'
import local from './AssetTechnicalLive.module.css'
import workspace from './ConsumptionWorkspace.module.css'

// 状态语义映射：自研 tone → antd Tag 语义色。
const TAG_COLOR = {
  healthy: 'success',
  warning: 'warning',
  neutral: 'default',
} as const

// 字段结构列定义：物理字段等宽文本列，无数字列。
const columnColumns: ColumnsType<LineageAssetColumn> = [
  { title: '物理字段', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'dataType', key: 'dataType' },
  { title: '说明', key: 'description', render: (_, column) => column.description || '—' },
]

/**
 * 技术视图（真实链路）：结构与血缘证据来自控制面血缘 BFF；
 * 资产以全限定名定位（?asset=doris-dataos.default.ods_ep.ep_mz_cfzb）。
 * 无 ?asset= 参数时渲染资产选择器（与资产目录同源），不再停留死提示。
 */
export function AssetTechnicalLive({ onNotice }: { onNotice: (message: string) => void }) {
  const requestedFqn = new URLSearchParams(window.location.search).get('asset') ?? ''
  const [detail, setDetail] = useState<LineageAssetDetail | null>(null)
  const [lineage, setLineage] = useState<LineageAssetLineage | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  // 键控加载：无 ?asset= 键时 idle（渲染资产选择器）。
  const state = useKeyedResource({
    key: requestedFqn ? `${requestedFqn}:${reloadTick}` : null,
    load: (signal) => Promise.all([
      fetchLineageAsset(requestedFqn, signal),
      fetchLineageGraph(requestedFqn, signal),
    ]),
    onData: ([detailResponse, lineageResponse]) => {
      setDetail(detailResponse)
      setLineage(lineageResponse)
    },
  })

  const backHref = `${routePaths.assets}${requestedFqn ? `?asset=${encodeURIComponent(detail?.fullyQualifiedName || requestedFqn)}` : ''}`

  async function copyTechnicalId() {
    const value = requestedFqn
    try {
      await navigator.clipboard.writeText(value)
      onNotice('资产全限定名已复制')
    } catch {
      onNotice(`资产全限定名：${value}`)
    }
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader
        title="技术视图"
        eyebrow="数据资产 · 结构与技术证据"
        subtitle="面向数据开发与运维人员的结构、血缘和同步证据；业务定义仍以资产详情为准。"
        compact
      />
      {state === 'idle' ? <AssetPicker /> : null}
      {state === 'loading' ? (
        <section className={workspace.statePanel} role="status" aria-busy="true"><h2>正在读取技术元数据</h2><p>按当前资产定位字段结构与已登记链路。</p><Skeleton active paragraph={{ rows: 4 }} /><a className={styles.externalLinkButton} href={backHref}><ArrowLeft size={14} />返回资产详情</a></section>
      ) : null}
      {state === 'error' ? (
        <section className={workspace.statePanel} role="status"><h2>技术元数据暂不可读</h2><p>当前资产的结构或血缘读取失败。可重新读取，或返回资产目录确认当前资产。</p><div className={workspace.actions}><Button onClick={() => setReloadTick((tick) => tick + 1)}>重新读取</Button><a className={styles.externalLinkButton} href={backHref}><ArrowLeft size={14} />返回资产详情</a></div></section>
      ) : null}
      {state === 'ready' && detail ? (
        <div className={styles.technicalWorkspace}>
          <header className={styles.technicalHeader}>
            <div className={styles.technicalIdentity}>
              <div className={styles.technicalIcon}><TableProperties size={19} /></div>
              <div><span>{detail.fullyQualifiedName}</span><h2>{detail.displayName || detail.name}</h2><p>技术元数据快照 · 元数据中心摄取</p></div>
            </div>
            <div className={styles.technicalHeaderActions}>
              <Tag color={TAG_COLOR.healthy}>元数据已摄取</Tag>
              <a className={styles.externalLinkButton} href={backHref}><ArrowLeft size={14} />返回资产详情</a>
            </div>
          </header>

          <div className={styles.technicalSummary}>
            <div><span>实体类型</span><strong>数据表</strong><small>已摄取的结构元数据</small></div>
            <div><span>所属服务</span><strong>{detail.fullyQualifiedName.split('.')[0]}</strong><small>只读账号摄取</small></div>
            <div><span>字段数量</span><strong>{detail.columns.length}</strong><small>结构元数据（无数据采样）</small></div>
            <div><span>最近更新</span><strong>{detail.updatedAt ? formatDateTime(detail.updatedAt) : '—'}</strong><small>元数据中心摄取时间</small></div>
          </div>

          <div className={styles.technicalGrid}>
            <Surface><section className={styles.technicalPanel}>
              <div className={styles.technicalPanelHeader}><div><h3>字段结构</h3><span>物理字段、类型与业务说明</span></div><Rows3 size={17} /></div>
              <Table<LineageAssetColumn>
                scroll={{ x: 'max-content' }}
                rowKey="name"
                columns={columnColumns}
                dataSource={detail.columns}
                pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
                locale={{ emptyText: '当前资产尚无字段结构。' }}
              />
            </section></Surface>

            <Surface><aside className={styles.technicalPanel}>
              <div className={styles.technicalPanelHeader}><div><h3>连接与归属</h3><span>由平台适配器维护的绑定证据</span></div><Database size={17} /></div>
              <dl className={styles.technicalDefinition}>
                <div><dt><Database size={13} />数据平台</dt><dd>Doris · {detail.fullyQualifiedName.split('.').slice(-2)[0]}</dd></div>
                <div><dt>FQN</dt><dd>{detail.fullyQualifiedName}</dd></div>
                <div><dt>元数据来源</dt><dd>元数据中心 · {detail.fullyQualifiedName.split('.')[0]}</dd></div>
                <div><dt>消费链</dt><dd>{lineage ? `${lineage.upstreams.length} 上游 · ${lineage.downstreams.length} 下游` : '—'}</dd></div>
              </dl>
              <div className={styles.technicalNotice}><Link2 size={15} /><span>当前只展示结构元数据与已登记血缘；字段内容未做数据采样。</span></div>
            </aside></Surface>
          </div>

          <section className={styles.technicalLineage}>
            <div className={styles.technicalPanelHeader}><div><h3>技术链路</h3><span>上游为数据来源，下游为产出与消费</span></div><Link2 size={17} /></div>
            <div className={styles.technicalLineageRow}>
              {(lineage?.upstreams ?? []).map((node) => (
                <div className={styles.technicalLineageNode} key={node.fullyQualifiedName}>
                  <span>{lineageNodeKindLabel[node.type]}</span>
                  <strong>{shortNodeName(node)}</strong>
                  <small>{node.fullyQualifiedName.split('.')[0]}</small>
                </div>
              ))}
              <div className={styles.technicalLineageNode}>
                <span>当前资产</span>
                <strong>{detail.name}</strong>
                <small>{detail.fullyQualifiedName.split('.').slice(0, -1).join('.')}</small>
              </div>
              {(lineage?.downstreams ?? []).map((node) => (
                <div className={styles.technicalLineageNode} key={node.fullyQualifiedName}>
                  <span>{lineageNodeKindLabel[node.type]}</span>
                  <strong>{shortNodeName(node)}</strong>
                  <small>{node.fullyQualifiedName.split('.')[0]}</small>
                </div>
              ))}
            </div>
            <div className={styles.technicalFooter}>
              <span>技术视图是资产详情的深链，不复制底层元数据控制台。</span>
              <Button type="text" onClick={() => void copyTechnicalId()}>复制全限定名</Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 无 ?asset= 参数时的资产选择器（2026-10-07 复评 P1-c）：清单与数据资产目录
 * 同源（血缘 BFF：summary 取库清单 → 逐库 catalog），点击经深链整页跳转，
 * 与「返回资产详情」的 plain anchor 同一导航口径。
 */
function AssetPicker() {
  const [assets, setAssets] = useState<LineageAssetSummary[]>([])
  const [query, setQuery] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const pickerState = useApiResource({
    reloadKey: reloadTick,
    timeoutMs: 15000,
    load: async (signal) => {
      const summary = await fetchLineageSummary(signal)
      const catalogs = await Promise.all(summary.schemas.map((schema) => fetchLineageCatalog(schema, signal)))
      return catalogs.flatMap((catalog) => catalog.assets)
    },
    onData: setAssets,
    onUnavailable: () => setAssets([]),
  })

  const visibleAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return assets.filter((asset) => `${asset.displayName}${asset.name}${asset.fullyQualifiedName}`.toLowerCase().includes(keyword))
  }, [assets, query])

  return (
    <section className={local.pickerPanel} aria-label="选择资产">
      <h2>选择资产查看技术视图</h2>
      <p>结构与血缘证据按资产全限定名定位；以下清单与数据资产目录同源。</p>
      <div className={local.pickerToolbar}><Input.Search value={query} onChange={(event) => setQuery(event.target.value)} allowClear placeholder="搜索资产名称或全限定名" aria-label="搜索技术视图资产" /><a className={styles.externalLinkButton} href={routePaths.assets}><ArrowLeft size={14} />资产目录</a></div>
      {pickerState === 'loading' ? <div className={workspace.railLoading} role="status" aria-busy="true"><p>正在读取资产目录…</p><Skeleton active paragraph={{ rows: 3 }} /></div> : null}
      {pickerState === 'unavailable' ? <div className={workspace.emptyDirectory}><p>资产清单暂不可用，请重新读取或联系平台运维核对元数据接入。</p><Button onClick={() => setReloadTick((tick) => tick + 1)}>重新读取目录</Button></div> : null}
      {pickerState === 'live' && assets.length === 0 ? <p className={local.pickerEmpty}>暂无已摄取的资产。</p> : null}
      {pickerState === 'live' && assets.length > 0 && visibleAssets.length === 0 ? <div className={workspace.emptyDirectory}><p>没有匹配的资产。</p><Button size="small" onClick={() => setQuery('')}>清空搜索</Button></div> : null}
      {visibleAssets.length > 0 ? (
        <ul className={local.pickerList}>
          {visibleAssets.map((asset) => (
            <li key={asset.fullyQualifiedName}>
              <a href={`${routePaths.assetTechnical}?asset=${encodeURIComponent(asset.fullyQualifiedName)}`}>
                <strong>{asset.displayName || asset.name}</strong>
                <span title={asset.fullyQualifiedName}>{asset.fullyQualifiedName}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

import { ArrowLeft, Database, Link2, Rows3, TableProperties } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  fetchLineageAsset,
  fetchLineageCatalog,
  fetchLineageGraph,
  fetchLineageSummary,
  lineageNodeKindLabel,
  shortNodeName,
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

/**
 * 技术视图（真实链路）：结构与血缘证据来自控制面血缘 BFF；
 * 资产以全限定名定位（?asset=doris-dataos.default.ods_ep.ep_mz_cfzb）。
 * 无 ?asset= 参数时渲染资产选择器（与资产目录同源），不再停留死提示。
 */
export function AssetTechnicalLive({ onNotice }: { onNotice: (message: string) => void }) {
  const requestedFqn = new URLSearchParams(window.location.search).get('asset') ?? ''
  const [detail, setDetail] = useState<LineageAssetDetail | null>(null)
  const [lineage, setLineage] = useState<LineageAssetLineage | null>(null)
  // 键控加载：无 ?asset= 键时 idle（渲染资产选择器）。
  const state = useKeyedResource({
    key: requestedFqn || null,
    load: (signal) => Promise.all([
      fetchLineageAsset(requestedFqn, signal),
      fetchLineageGraph(requestedFqn, signal),
    ]),
    onData: ([detailResponse, lineageResponse]) => {
      setDetail(detailResponse)
      setLineage(lineageResponse)
    },
  })

  const backHref = `${routePaths.assets}${detail ? `?asset=${encodeURIComponent(detail.fullyQualifiedName)}` : ''}`

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
        <section className={styles.technicalNotice} role="status"><StatusTag tone="neutral">读取中</StatusTag><span>正在读取技术元数据…</span></section>
      ) : null}
      {state === 'error' ? (
        <section className={styles.technicalNotice} role="status"><StatusTag tone="warning">读取失败</StatusTag><span>技术元数据暂不可读，请稍后重试。</span></section>
      ) : null}
      {state === 'ready' && detail ? (
        <div className={styles.technicalWorkspace}>
          <header className={styles.technicalHeader}>
            <div className={styles.technicalIdentity}>
              <div className={styles.technicalIcon}><TableProperties size={19} /></div>
              <div><span>{detail.fullyQualifiedName}</span><h2>{detail.displayName || detail.name}</h2><p>技术元数据快照 · 元数据中心摄取</p></div>
            </div>
            <div className={styles.technicalHeaderActions}>
              <StatusTag tone="healthy">元数据已摄取</StatusTag>
              <a className={styles.externalLinkButton} href={backHref}><ArrowLeft size={14} />返回资产详情</a>
            </div>
          </header>

          <div className={styles.technicalSummary}>
            <div><span>实体类型</span><strong>数据表</strong><small>Doris UNIQUE/DUP 表</small></div>
            <div><span>所属服务</span><strong>{detail.fullyQualifiedName.split('.')[0]}</strong><small>只读账号摄取</small></div>
            <div><span>字段数量</span><strong>{detail.columns.length}</strong><small>结构元数据（无数据采样）</small></div>
            <div><span>最近更新</span><strong>{detail.updatedAt ? formatDateTime(detail.updatedAt) : '—'}</strong><small>元数据中心摄取时间</small></div>
          </div>

          <div className={styles.technicalGrid}>
            <section className={styles.technicalPanel}>
              <div className={styles.technicalPanelHeader}><div><h3>字段结构</h3><span>物理字段与类型（OpenMetadata 摄取）</span></div><Rows3 size={17} /></div>
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

            <aside className={styles.technicalPanel}>
              <div className={styles.technicalPanelHeader}><div><h3>连接与归属</h3><span>由平台适配器维护的绑定证据</span></div><Database size={17} /></div>
              <dl className={styles.technicalDefinition}>
                <div><dt><Database size={13} />数据平台</dt><dd>Doris · {detail.fullyQualifiedName.split('.').slice(-2)[0]}</dd></div>
                <div><dt>FQN</dt><dd>{detail.fullyQualifiedName}</dd></div>
                <div><dt>元数据来源</dt><dd>OpenMetadata（doris-dataos 摄取）</dd></div>
                <div><dt>消费链</dt><dd>{lineage ? `${lineage.upstreams.length} 上游 · ${lineage.downstreams.length} 下游` : '—'}</dd></div>
              </dl>
              <div className={styles.technicalNotice}><Link2 size={15} /><span>血缘、质量和责任人由统一门户聚合，当前页面不要求直接登录 OpenMetadata。</span></div>
            </aside>
          </div>

          <section className={styles.technicalLineage}>
            <div className={styles.technicalPanelHeader}><div><h3>技术链路</h3><span>消费链（上游）与加工产出（下游）</span></div><Link2 size={17} /></div>
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
              <Button variant="quiet" onClick={() => void copyTechnicalId()}>复制全限定名</Button>
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
  const pickerState = useApiResource({
    timeoutMs: 15000,
    load: async (signal) => {
      const summary = await fetchLineageSummary(signal)
      const catalogs = await Promise.all(summary.schemas.map((schema) => fetchLineageCatalog(schema, signal)))
      return catalogs.flatMap((catalog) => catalog.assets)
    },
    onData: setAssets,
    onUnavailable: () => setAssets([]),
  })

  function openAsset(fullyQualifiedName: string) {
    window.location.assign(`${routePaths.assetTechnical}?asset=${encodeURIComponent(fullyQualifiedName)}`)
  }

  return (
    <section className={local.pickerPanel} aria-label="选择资产">
      <h2>选择资产查看技术视图</h2>
      <p>结构与血缘证据按资产全限定名定位；以下清单与数据资产目录同源。</p>
      {pickerState === 'loading' ? <p className={local.pickerEmpty}>正在读取资产目录…</p> : null}
      {pickerState === 'unavailable' ? <p className={local.pickerEmpty}>血缘服务暂不可用：资产清单需要控制面完成元数据中心接入配置。</p> : null}
      {pickerState === 'live' && assets.length === 0 ? <p className={local.pickerEmpty}>暂无已摄取的资产。</p> : null}
      {assets.length > 0 ? (
        <ul className={local.pickerList}>
          {assets.map((asset) => (
            <li key={asset.fullyQualifiedName}>
              <button type="button" onClick={() => openAsset(asset.fullyQualifiedName)}>
                <strong>{asset.displayName || asset.name}</strong>
                <span title={asset.fullyQualifiedName}>{asset.fullyQualifiedName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

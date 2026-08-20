import { ArrowLeft, Database, Link2, Rows3, TableProperties } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  fetchLineageAsset,
  fetchLineageGraph,
  lineageNodeKindLabel,
  shortNodeName,
  type LineageAssetDetail,
  type LineageAssetLineage,
} from '../data/lineageApi'
import { routePaths } from '../data/routes'
import styles from './IntegrationPages.module.css'

/**
 * 技术视图（真实链路）：结构与血缘证据来自控制面血缘 BFF；
 * 资产以全限定名定位（?asset=doris-dataos.default.ods_ep.ep_mz_cfzb）。
 */
export function AssetTechnicalLive({ onNotice }: { onNotice: (message: string) => void }) {
  const requestedFqn = new URLSearchParams(window.location.search).get('asset') ?? ''
  const [detail, setDetail] = useState<LineageAssetDetail | null>(null)
  const [lineage, setLineage] = useState<LineageAssetLineage | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading')
  useEffect(() => {
    if (!requestedFqn) {
      setState('missing')
      return
    }
    const controller = new AbortController()
    setState('loading')
    Promise.all([
      fetchLineageAsset(requestedFqn, controller.signal),
      fetchLineageGraph(requestedFqn, controller.signal),
    ])
      .then(([detailResponse, lineageResponse]) => {
        setDetail(detailResponse)
        setLineage(lineageResponse)
        setState('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState('error')
      })
    return () => controller.abort()
  }, [requestedFqn])

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
        eyebrow="数据资产 · OpenMetadata"
        subtitle="面向数据开发与运维人员的结构、血缘和同步证据；业务定义仍以资产详情为准。"
        compact
      />
      {state === 'missing' ? (
        <section className={styles.technicalNotice} role="status">
          <StatusTag tone="warning">缺少资产</StatusTag>
          <span>请从数据资产目录进入技术视图（URL 需带 ?asset=全限定名）。</span>
        </section>
      ) : null}
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
              <div><span>{detail.fullyQualifiedName}</span><h2>{detail.displayName || detail.name}</h2><p>技术元数据快照 · OpenMetadata 摄取</p></div>
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
            <div><span>最近更新</span><strong>{detail.updatedAt ? new Date(detail.updatedAt).toLocaleString('zh-CN') : '—'}</strong><small>OpenMetadata 摄取时间</small></div>
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

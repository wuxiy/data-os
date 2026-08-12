import { ArrowLeft, Braces, Database, ExternalLink, KeyRound, Link2, Rows3, ShieldCheck, TableProperties } from 'lucide-react'
import { useMemo } from 'react'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { assets, type AssetItem } from '../data/integrations'
import { routePaths } from '../data/mock'
import styles from './IntegrationPages.module.css'

export function AssetTechnicalPage({ onNotice }: { onNotice: (message: string) => void }) {
  const asset = useMemo(() => {
    const requestedId = new URLSearchParams(window.location.search).get('asset')
    return assets.find((item) => item.id === requestedId) ?? assets[0]
  }, [])
  const backHref = `${routePaths.assets}?asset=${encodeURIComponent(asset.id)}`

  async function copyTechnicalId() {
    try {
      await navigator.clipboard.writeText(asset.entityId)
      onNotice('资产技术编号已复制')
    } catch {
      onNotice(`资产技术编号：${asset.entityId}`)
    }
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader
        title="技术视图"
        eyebrow={`数据资产 · ${asset.entityId}`}
        subtitle="面向数据开发与运维人员的结构、血缘和同步证据；业务定义仍以资产详情为准。"
        compact
      />
      <DemoDataBoundary moduleName="数据资产技术视图">
        <div className={styles.technicalWorkspace}>
        <header className={styles.technicalHeader}>
          <div className={styles.technicalIdentity}>
            <div className={styles.technicalIcon}><TableProperties size={19} /></div>
            <div><span>{asset.fqn}</span><h2>{asset.name}</h2><p>技术元数据快照 · 最近同步 {asset.freshness}</p></div>
          </div>
          <div className={styles.technicalHeaderActions}>
            <StatusTag tone={asset.status === '可信' ? 'healthy' : 'warning'}>{asset.status}</StatusTag>
            <a className={styles.externalLinkButton} href={backHref}><ArrowLeft size={14} />返回资产详情</a>
          </div>
        </header>

        <div className={styles.technicalSummary}>
          <div><span>实体类型</span><strong>{asset.type}</strong><small>平台登记资产</small></div>
          <div><span>所属主题</span><strong>{asset.domain}</strong><small>业务域与技术域已绑定</small></div>
          <div><span>字段数量</span><strong>{asset.fields.length}</strong><small>关键字段已完成标准映射</small></div>
          <div><span>同步状态</span><strong>已同步</strong><small>快照更新时间 {asset.freshness}</small></div>
        </div>

        <div className={styles.technicalGrid}>
          <section className={styles.technicalPanel}>
            <div className={styles.technicalPanelHeader}><div><h3>字段结构</h3><span>技术字段与医疗数据标准绑定关系</span></div><Rows3 size={17} /></div>
            <div className={styles.horizontalScroll}>
              <table className={styles.fieldTable}>
                <thead><tr><th>物理字段</th><th>类型</th><th>业务名称</th><th>绑定标准</th><th>安全标记</th></tr></thead>
                <tbody>{asset.fields.map((field, index) => <tr key={field.name}><td>{field.name}</td><td>{field.type}</td><td>{field.label}</td><td>{field.standard}</td><td>{index === 1 ? <StatusTag tone="warning">敏感标识</StatusTag> : <StatusTag tone="neutral">普通</StatusTag>}</td></tr>)}</tbody>
              </table>
            </div>
          </section>

          <aside className={styles.technicalPanel}>
            <div className={styles.technicalPanelHeader}><div><h3>连接与归属</h3><span>由平台适配器维护的绑定证据</span></div><Database size={17} /></div>
            <dl className={styles.technicalDefinition}>
              <div><dt><Database size={13} />数据平台</dt><dd>Doris · clinical</dd></div>
              <div><dt><Braces size={13} />FQN</dt><dd>{asset.fqn}</dd></div>
              <div><dt><KeyRound size={13} />资产编号</dt><dd>{asset.entityId}</dd></div>
              <div><dt><ShieldCheck size={13} />责任人</dt><dd>{asset.owner}</dd></div>
            </dl>
            <div className={styles.technicalNotice}><Link2 size={15} /><span>血缘、质量和责任人由统一门户聚合，当前页面不要求直接登录 OpenMetadata。</span></div>
          </aside>
        </div>

        <section className={styles.technicalLineage}>
          <div className={styles.technicalPanelHeader}><div><h3>技术链路</h3><span>从源系统到消费对象的已登记节点</span></div><Link2 size={17} /></div>
          <div className={styles.technicalLineageRow}>{asset.lineage.map((node) => <div className={styles.technicalLineageNode} key={`${node.stage}-${node.name}`}><span>{node.stage}</span><strong>{node.name}</strong><small>{node.detail}</small></div>)}</div>
          <div className={styles.technicalFooter}><span>技术视图是资产详情的深链，不复制底层元数据控制台。</span><Button variant="quiet" onClick={() => void copyTechnicalId()}>复制技术编号 <ExternalLink size={13} /></Button></div>
        </section>
        </div>
      </DemoDataBoundary>
    </div>
  )
}

import { ChartNoAxesCombined, Database, ExternalLink, FileCheck2, FileText, Search, Table2, Waypoints, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { assets, type AssetItem } from '../data/integrations'
import styles from './IntegrationPages.module.css'

type AssetTab = 'overview' | 'lineage' | 'quality'

const lineageIcons = {
  source: Database,
  task: Workflow,
  asset: Table2,
  consumer: ChartNoAxesCombined,
}

export function AssetCatalogPage({ onNotice }: { onNotice: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(assets[0].id)
  const [activeTab, setActiveTab] = useState<AssetTab>('lineage')
  const [query, setQuery] = useState('')
  const selected = assets.find((item) => item.id === selectedId) ?? assets[0]
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return assets
    return assets.filter((item) => `${item.name}${item.fqn}${item.domain}${item.owner}`.toLowerCase().includes(keyword))
  }, [query])

  function selectAsset(id: string) {
    setSelectedId(id)
    setActiveTab('lineage')
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader
        title="数据资产"
        eyebrow="资产目录与影响分析"
        subtitle="从业务定义进入字段、质量、血缘和消费证据，不暴露底层元数据控制台"
        compact
        onFilterNotice={onNotice}
      />
      <div className={styles.integrationWorkspace}>
        <aside className={styles.catalogRail} aria-label="数据资产目录">
          <div className={styles.railHeader}><h2>资产目录</h2><span className={styles.railCount}>{visible.length} 项</span></div>
          <label className={styles.railSearch}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产、字段或责任人" aria-label="搜索数据资产" />
          </label>
          <div className={styles.railLabel}>核心医疗数据</div>
          <ul className={styles.catalogList}>
            {visible.map((asset) => (
              <li key={asset.id}>
                <button
                  className={`${styles.catalogItem} ${asset.id === selected.id ? styles.catalogItemSelected : ''}`}
                  onClick={() => selectAsset(asset.id)}
                  aria-pressed={asset.id === selected.id}
                >
                  <strong>{asset.name}</strong>
                  <span>{asset.type} · {asset.domain}</span>
                  <div className={styles.catalogMeta}>
                    <em>质量 {asset.quality}</em>
                    <i className={asset.status === '可信' ? styles.healthMark : styles.warningMark}>{asset.status}</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <div className={styles.emptyRail}>没有匹配的数据资产，请调整搜索条件。</div> : null}
        </aside>

        <section className={styles.workspaceMain} aria-label={`${selected.name}资产详情`}>
          <div className={styles.assetToolbar}>
            <div className={styles.assetIdentity}>
              <div className={styles.assetIdentityTop}><span className={styles.assetCode}>{selected.entityId}</span><StatusTag tone={selected.status === '可信' ? 'healthy' : 'warning'}>{selected.status}</StatusTag></div>
              <h2>{selected.name}</h2>
              <p>{selected.fqn}</p>
            </div>
            <div className={styles.toolbarActions}>
              <Button onClick={() => onNotice('资产关注已开启，质量与结构变化将进入个人待办')}>关注变化</Button>
              <Button variant="primary" onClick={() => onNotice('专业元数据视图将在新标签页打开，并沿用统一登录')}>打开技术视图 <ExternalLink size={13} /></Button>
            </div>
          </div>
          <nav className={styles.assetTabs} aria-label="资产详情视图">
            {[
              ['overview', '资产概览'],
              ['lineage', '血缘与影响'],
              ['quality', '质量结果'],
            ].map(([tab, label]) => (
              <button
                key={tab}
                className={`${styles.assetTab} ${activeTab === tab ? styles.assetTabActive : ''}`}
                onClick={() => setActiveTab(tab as AssetTab)}
                aria-current={activeTab === tab ? 'page' : undefined}
              >{label}</button>
            ))}
          </nav>
          <div className={styles.assetBody}>
            <div className={styles.assetSummary}>
              <div className={styles.assetScore}><span>数据质量</span><strong>{selected.quality}</strong></div>
              <div className={styles.assetScore}><span>数据新鲜度</span><strong>{selected.freshness}</strong></div>
              <div className={styles.assetScore}><span>已登记消费</span><strong>{selected.uses.length} 项</strong></div>
            </div>
            {activeTab === 'overview' ? <AssetOverview asset={selected} /> : null}
            {activeTab === 'lineage' ? <AssetLineage asset={selected} /> : null}
            {activeTab === 'quality' ? <AssetQuality asset={selected} /> : null}
          </div>
        </section>

        <aside className={styles.evidenceRail} aria-label="资产来源证据">
          <div className={styles.evidenceHeader}><h2>资产证据</h2><StatusTag tone="healthy">已同步</StatusTag></div>
          <div className={styles.evidenceBody}>
            <div className={styles.evidenceStamp}>
              <span className={styles.evidenceStampIcon}><Waypoints size={17} /></span>
              <div><strong>元数据实体已绑定</strong><span>{selected.entityId}</span></div>
            </div>
            <dl className={styles.evidenceDefinition}>
              <div><dt>业务定义</dt><dd>{selected.description}</dd></div>
              <div><dt>权威责任人</dt><dd>{selected.owner}</dd></div>
              <div><dt>资产类型</dt><dd>{selected.type} · {selected.domain}</dd></div>
              <div><dt>同步状态</dt><dd>增量同步成功 · {selected.freshness}</dd></div>
            </dl>
            <section className={styles.evidenceSection}>
              <h3>已登记消费</h3>
              <ul className={styles.relatedList}>
                {selected.uses.map((usage) => <li key={usage}><FileText size={14} />{usage}</li>)}
              </ul>
            </section>
            <Button className={styles.evidenceAction} onClick={() => onNotice('已生成当前资产的变更影响清单')}>生成影响清单</Button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function AssetOverview({ asset }: { asset: AssetItem }) {
  return (
    <div className={styles.overviewGrid}>
      <section className={styles.contentPanel}>
        <div className={styles.contentPanelHeader}><h3>字段与标准</h3><span>{asset.fields.length} 个关键字段</span></div>
        <div className={styles.descriptionBlock}><p>{asset.description}</p></div>
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>字段</th><th>业务名称</th><th>类型</th><th>绑定标准</th></tr></thead>
            <tbody>{asset.fields.map((field) => <tr key={field.name}><td>{field.name}</td><td>{field.label}</td><td>{field.type}</td><td>{field.standard}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className={styles.contentPanel}>
        <div className={styles.contentPanelHeader}><h3>使用情况</h3><span>{asset.uses.length} 项</span></div>
        <ul className={styles.usageList}>{asset.uses.map((usage) => <li key={usage}><FileCheck2 size={14} />{usage}</li>)}</ul>
      </section>
    </div>
  )
}

function AssetLineage({ asset }: { asset: AssetItem }) {
  return (
    <section className={styles.lineageCanvas} aria-label={`${asset.name}端到端血缘`}>
      <div className={styles.lineageSummary}><div><h3>端到端血缘</h3><span>当前版本 v2.6 · 字段级血缘完整率 94.1%</span></div><StatusTag tone="healthy">4 层已核验</StatusTag></div>
      <div className={styles.lineageRow}>
        {asset.lineage.map((node) => {
          const Icon = lineageIcons[node.kind]
          return (
            <article className={`${styles.lineageNode} ${node.kind === 'asset' ? styles.lineageNodeAsset : ''}`} key={`${node.stage}-${node.name}`}>
              <span className={styles.lineageNodeIcon}><Icon size={16} /></span>
              <span>{node.stage}</span><strong>{node.name}</strong><small>{node.detail}</small>
            </article>
          )
        })}
      </div>
      <div className={styles.lineageImpact}>
        <div className={styles.impactItem}><span>上游依赖</span><strong>2 个源对象 · 1 个采集任务</strong></div>
        <div className={styles.impactItem}><span>下游影响</span><strong>{asset.uses.length} 项已登记消费</strong></div>
        <div className={styles.impactItem}><span>最近结构变化</span><strong>07-29 新增 2 个标准字段</strong></div>
      </div>
    </section>
  )
}

function AssetQuality({ asset }: { asset: AssetItem }) {
  return (
    <ul className={styles.qualityList} aria-label={`${asset.name}质量规则结果`}>
      {asset.rules.map((rule) => (
        <li key={rule.name}>
          <div className={styles.qualityName}><strong>{rule.name}</strong><span>最近一次执行已形成证据记录</span></div>
          <StatusTag tone="neutral">{rule.dimension}</StatusTag>
          <span className={styles.qualityResult}>{rule.result}</span>
          <time>{rule.checkedAt}</time>
        </li>
      ))}
    </ul>
  )
}

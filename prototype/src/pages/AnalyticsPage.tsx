import { ChartNoAxesCombined, ExternalLink, FileText, Maximize2, Pencil, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { TrendChart } from '../components/charts/TrendChart'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { dashboards } from '../data/integrations'
import styles from './IntegrationPages.module.css'

export function AnalyticsPage({ onNotice, onNavigate }: { onNotice: (message: string) => void; onNavigate: (route: 'ingestion' | 'governance' | 'quality') => void }) {
  const [selectedId, setSelectedId] = useState(dashboards[0].id)
  const [query, setQuery] = useState('')
  const selected = dashboards.find((item) => item.id === selectedId) ?? dashboards[0]
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return dashboards
    return dashboards.filter((item) => `${item.title}${item.domain}${item.owner}`.toLowerCase().includes(keyword))
  }, [query])

  return (
    <div className={styles.integrationPage}>
      <PageHeader
        title="分析看板"
        eyebrow="嵌入式分析"
        subtitle="业务人员在统一门户查看结果，专业人员按权限进入分析设计器"
        compact
        onFilterNotice={onNotice}
      />
      <DemoDataBoundary moduleName="分析看板" onNavigate={onNavigate}>
        <div className={styles.integrationWorkspace}>
        <aside className={styles.catalogRail} aria-label="分析看板目录">
          <div className={styles.railHeader}><h2>看板目录</h2><span className={styles.railCount}>{visible.length} 项</span></div>
          <label className={styles.railSearch}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索看板或主题域" aria-label="搜索分析看板" />
          </label>
          <div className={styles.railLabel}>已发布分析</div>
          <ul className={styles.catalogList}>
            {visible.map((dashboard) => (
              <li key={dashboard.id}>
                <button
                  className={`${styles.catalogItem} ${dashboard.id === selected.id ? styles.catalogItemSelected : ''}`}
                  onClick={() => setSelectedId(dashboard.id)}
                  aria-pressed={dashboard.id === selected.id}
                >
                  <strong>{dashboard.title}</strong>
                  <span>{dashboard.domain} · {dashboard.owner.split(' · ')[0]}</span>
                  <div className={styles.catalogMeta}>
                    <em>{dashboard.updatedAt}</em>
                    <i className={dashboard.status === '运行正常' ? styles.healthMark : styles.warningMark}>{dashboard.status}</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <div className={styles.emptyRail}>没有匹配的分析看板，请调整关键词。</div> : null}
        </aside>

        <section className={styles.workspaceMain} aria-label={`${selected.title}嵌入视图`}>
          <section className={styles.embeddedShell}>
            <div className={styles.embedToolbar}>
              <div className={styles.embedIdentity}><ChartNoAxesCombined size={15} /><span>受控嵌入视图 · {selected.bindingId}</span></div>
              <div className={styles.toolbarActions}>
                <button className={styles.toolbarButton} onClick={() => onNotice(`${selected.title}已刷新至 ${selected.updatedAt}`)}><RefreshCw size={14} />刷新</button>
                <button className={styles.toolbarButton} onClick={() => onNotice('已进入全屏预览；原型中保留 data-os 的范围与权限上下文')}><Maximize2 size={14} />全屏</button>
              </div>
            </div>
            <div className={styles.dashboardHeader}>
              <div className={styles.dashboardTitleBlock}>
                <h2>{selected.title}</h2>
                <p>{selected.description}</p>
              </div>
              <div className={styles.dashboardScope}>市第一人民医院 · 近 30 天</div>
            </div>
            <div className={styles.metricBand}>
              {selected.metrics.map((metric) => (
                <div
                  className={`${styles.dashboardMetric} ${metric.tone === 'warning' ? styles.metricWarning : ''} ${metric.tone === 'danger' ? styles.metricDanger : ''}`}
                  key={metric.label}
                >
                  <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.delta}</small>
                </div>
              ))}
            </div>
            <div className={styles.dashboardGrid}>
              <section className={styles.analysisPanel}>
                <div className={styles.analysisPanelHeader}><h3>近 30 天趋势</h3><span>按日 · 已排除测试记录</span></div>
                <div className={styles.trendWrap}><TrendChart title="" primaryLabel="本期" secondaryLabel="对照期" flat /></div>
              </section>
              <section className={styles.analysisPanel}>
                <div className={styles.analysisPanelHeader}><h3>重点对象分布</h3><span>按当前筛选范围</span></div>
                <ol className={styles.barList}>
                  {selected.breakdown.map((item) => (
                    <li className={styles.barRow} key={item.label}>
                      <div className={styles.barRowTop}><span>{item.label}</span><span>{item.display}</span></div>
                      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${item.value}%` }} /></div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <footer className={styles.dashboardFoot}>
              <span>所有指标均绑定已发布口径，机构范围由门户权限自动约束。</span>
              <span>刷新于 {selected.updatedAt}</span>
            </footer>
          </section>
        </section>

        <aside className={styles.evidenceRail} aria-label="分析证据">
          <div className={styles.evidenceHeader}><h2>分析证据</h2><StatusTag tone={selected.status === '运行正常' ? 'healthy' : 'warning'}>{selected.status}</StatusTag></div>
          <div className={styles.evidenceBody}>
            <div className={styles.evidenceStamp}>
              <span className={styles.evidenceStampIcon}><FileText size={17} /></span>
              <div><strong>资源绑定已核验</strong><span>{selected.bindingId}</span></div>
            </div>
            <dl className={styles.evidenceDefinition}>
              <div><dt>统计范围</dt><dd>市第一人民医院 · 全部院区</dd></div>
              <div><dt>指标口径</dt><dd>{selected.metricDefinition}</dd></div>
              <div><dt>责任人</dt><dd>{selected.owner}</dd></div>
              <div><dt>最近刷新</dt><dd>{selected.updatedAt} · 完整加载</dd></div>
            </dl>
            <section className={styles.evidenceSection}>
              <h3>关联数据资产</h3>
              <ul className={styles.relatedList}>
                {selected.relatedAssets.map((asset) => <li key={asset}><FileText size={14} />{asset}</li>)}
              </ul>
            </section>
            <Button className={styles.evidenceAction} onClick={() => onNotice('已打开指标口径与数据血缘详情')}>查看口径与血缘</Button>
            <Button className={styles.evidenceAction} variant="quiet" onClick={() => onNotice('专业分析设计器将在新标签页打开，并沿用统一登录')}><Pencil size={14} />进入专业编辑 <ExternalLink size={13} /></Button>
          </div>
        </aside>
        </div>
      </DemoDataBoundary>
    </div>
  )
}

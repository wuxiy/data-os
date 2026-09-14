import { ChartNoAxesCombined, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { embedDashboard } from '@superset-ui/embedded-sdk'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusTag } from '../components/ui/Primitives'
import { Pager } from '../components/ui/Pager'
import {
  fetchEmbeddableDashboards,
  fetchGuestToken,
  supersetEmbedOrigin,
  type EmbeddableDashboard,
} from '../data/analyticsApi'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import styles from './IntegrationPages.module.css'

/**
 * 分析看板（真实链路）：嵌入式分析仪表盘经控制面访客令牌（guest token）
 * 进入——业务人员免分析平台登录、按仪表盘限权；嵌入 origin 是门户专用监听
 * 端口（同主机 HTTP，不暴露网关自签证书）。引擎名不进业务文案
 * （DESIGN.md「不在业务视图暴露分析引擎品牌」）；BFF 未配置/不可达时显示
 * 「待接入」，不回退静态样例。
 */
export function AnalyticsLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [dashboards, setDashboards] = useState<EmbeddableDashboard[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const catalogState = useApiResource({
    load: (signal) => fetchEmbeddableDashboards(signal),
    onData: (list) => {
      setDashboards(list)
      if (list.length > 0) setSelectedId((current) => current || list[0].id)
    },
    onUnavailable: () => setDashboards([]),
    timeoutMs: 15000,
  })

  const selected = dashboards.find((item) => item.id === selectedId) ?? dashboards[0] ?? null

  // 目录搜索与分页（与演示构建同能力，不因真实链路降级）。
  const RAIL_PAGE_SIZE = 8
  const visibleDashboards = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return dashboards
    return dashboards.filter((item) => `${item.title}${item.id}`.toLowerCase().includes(keyword))
  }, [dashboards, query])
  const { page: railPage, setPage: setRailPage, paged: pagedDashboards, pageCount: railPageCount } = usePaged(visibleDashboards, RAIL_PAGE_SIZE)

  const mountRef = useRef<HTMLDivElement | null>(null)
  const [embedState, setEmbedState] = useState<'idle' | 'mounting' | 'mounted' | 'error'>('idle')

  useEffect(() => {
    if (!selected || !selected.embeddedUuid || !mountRef.current) return
    const mountPoint = mountRef.current
    setEmbedState('mounting')
    let cancelled = false
    embedDashboard({
      id: selected.embeddedUuid,
      supersetDomain: supersetEmbedOrigin,
      mountPoint,
      fetchGuestToken: async () => (await fetchGuestToken(selected.id)).token,
      dashboardUiConfig: { hideTitle: false, hideChartControls: true, hideTab: true },
    })
      .then(() => {
        if (!cancelled) setEmbedState('mounted')
      })
      .catch(() => {
        if (!cancelled) {
          setEmbedState('error')
          onNotice('分析仪表盘嵌入失败，请稍后重试')
        }
      })
    return () => {
      cancelled = true
      mountPoint.innerHTML = ''
    }
  }, [selected?.id, selected?.embeddedUuid, onNotice])

  if (catalogState !== 'live' || dashboards.length === 0) {
    return (
      <div className={styles.integrationPage}>
        <PageHeader title="分析看板" eyebrow="嵌入式分析" subtitle="业务人员在统一门户查看结果，专业人员按权限进入分析设计器" compact />
        {catalogState === 'loading' ? (
          <section className={styles.technicalNotice} role="status">
            <StatusTag tone="neutral">读取中</StatusTag>
            <span>正在从分析服务读取仪表盘清单…</span>
          </section>
        ) : (
          <div className={styles.analyticsEmpty} role="status">
            <ChartNoAxesCombined size={30} aria-hidden="true" />
            <h3>分析看板待接入</h3>
            <p>需要控制面完成嵌入式分析引擎接入配置（详见平台运维）。<br />接入后业务人员在统一门户查看已授权仪表盘，无需分析平台账号。</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader title="分析看板" eyebrow="嵌入式分析" subtitle="业务人员在统一门户查看结果，专业人员按权限进入分析设计器" compact />
      <div className={styles.integrationWorkspace}>
        <aside className={styles.catalogRail} aria-label="分析看板目录">
          <div className={styles.railHeader}>
            <h2>已授权看板</h2>
            <span className={styles.railCount}>{visibleDashboards.length} 项</span>
          </div>
          <label className={styles.railSearch}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setRailPage(0) }} placeholder="搜索看板名称" aria-label="搜索分析看板" />
          </label>
          <div className={styles.railLabel}>已授权嵌入（访客令牌）</div>
          <ul className={styles.catalogList}>
            {pagedDashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <button
                  className={`${styles.catalogItem} ${dashboard.id === selected?.id ? styles.catalogItemSelected : ''}`}
                  onClick={() => setSelectedId(dashboard.id)}
                  aria-pressed={dashboard.id === selected?.id}
                >
                  <strong>{dashboard.title}</strong>
                  <span>只读视图</span>
                  <div className={styles.catalogMeta}>
                    <em>看板 {dashboard.id}</em>
                    <i className={styles.healthMark}>已授权嵌入</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {visibleDashboards.length === 0 ? <div className={styles.emptyRail}>没有匹配的看板，请调整搜索条件。</div> : null}
          <Pager label="分析看板目录分页" page={railPage} pageCount={railPageCount} pageSize={RAIL_PAGE_SIZE} onPageChange={setRailPage} />
        </aside>

        <section className={styles.workspaceMain} aria-label={`${selected?.title ?? '分析看板'}嵌入视图`}>
          <div className={styles.assetToolbar}>
            <div className={styles.assetIdentity}>
              <div className={styles.assetIdentityTop}>
                <span className={styles.assetCode}>只读嵌入 · 看板 {selected?.id}</span>
                <StatusTag tone={embedState === 'mounted' ? 'healthy' : embedState === 'error' ? 'warning' : 'neutral'}>
                  {embedState === 'mounted' ? '已嵌入' : embedState === 'error' ? '嵌入失败' : '载入中'}
                </StatusTag>
              </div>
              <h2>{selected?.title}</h2>
              <p>访客令牌由控制面签发（只读、限本仪表盘、短时效）；数据口径与源表见「数据资产 · 血缘」。</p>
            </div>
          </div>
          {embedState === 'error' ? (
            <section className={styles.technicalNotice} role="status">
              <StatusTag tone="warning">嵌入失败</StatusTag>
              <span>无法嵌入当前仪表盘：请确认嵌入白名单（allowed_domains 含门户地址）后重试。</span>
            </section>
          ) : null}
          {embedState === 'mounting' ? (
            <section className={styles.technicalNotice} role="status">
              <StatusTag tone="neutral">载入中</StatusTag>
              <span>正在装载仪表盘（访客令牌已签发）…</span>
            </section>
          ) : null}
          <div
            ref={mountRef}
            className={styles.embedCanvas}
            aria-label="嵌入式分析仪表盘"
            data-embed-state={embedState}
          />
        </section>

        <aside className={styles.evidenceRail} aria-label="分析访问证据">
          <div className={styles.evidenceHeader}><h2>访问证据</h2><StatusTag tone="healthy">免登录</StatusTag></div>
          <div className={styles.evidenceBody}>
            <div className={styles.evidenceStamp}>
              <span className={styles.evidenceStampIcon}><ShieldCheck size={17} /></span>
              <div><strong>访客令牌模式</strong><span>无需分析平台账号</span></div>
            </div>
            <dl className={styles.evidenceDefinition}>
              <div><dt>嵌入方式</dt><dd>嵌入式分析 SDK（门户专用端口）</dd></div>
              <div><dt>令牌权限</dt><dd>只读 · 限白名单仪表盘</dd></div>
              <div><dt>令牌时效</dt><dd>短时效（默认 300 秒，自动续签）</dd></div>
              <div><dt>嵌入白名单</dt><dd>仪表盘级 allowed_domains 校验门户来源</dd></div>
            </dl>
            <section className={styles.evidenceSection}>
              <h3>数据来源</h3>
              <ul className={styles.relatedList}>
                <li><ChartNoAxesCombined size={14} />ods_ep.ep_mz_cfzb（Doris 只读数据集）</li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}

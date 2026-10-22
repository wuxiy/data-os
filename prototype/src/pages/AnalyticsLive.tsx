import { ChartNoAxesCombined, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Skeleton, Tag } from 'antd'
import { embedDashboard } from '@superset-ui/embedded-sdk'
import { PageHeader } from '../components/ui/PageHeader'
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
import local from './ConsumptionWorkspace.module.css'
import { routePaths } from '../data/routes'

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
  const [catalogReload, setCatalogReload] = useState(0)
  const catalogState = useApiResource({
    reloadKey: catalogReload,
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
  const [embedReload, setEmbedReload] = useState(0)

  useEffect(() => {
    if (!selected || !mountRef.current) return
    if (!selected.embeddedUuid) {
      setEmbedState('error')
      return
    }
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
  }, [selected?.id, selected?.embeddedUuid, embedReload, onNotice])

  if (catalogState !== 'live' || dashboards.length === 0) {
    return (
      <div className={styles.integrationPage}>
        <PageHeader title="分析看板" eyebrow="嵌入式分析" subtitle="业务人员在统一门户查看结果，专业人员按权限进入分析设计器" compact />
        {catalogState === 'loading' ? (
          <section className={local.statePanel} role="status" aria-label="正在读取分析看板" aria-busy="true">
            <h2>正在读取已授权看板</h2>
            <p>看板清单和访问范围以当前账号权限为准。</p>
            <Skeleton active paragraph={{ rows: 3 }} />
          </section>
        ) : (
          <div className={local.statePanel} role="status">
            <ChartNoAxesCombined size={30} aria-hidden="true" />
            <h2>{catalogState === 'live' ? '暂无已授权看板' : '分析看板暂不可用'}</h2>
            <p>{catalogState === 'live' ? '当前账号没有可查看的已发布看板。请联系分析负责人核对发布与授权范围。' : '暂时无法读取看板目录。可重新读取；持续不可用时请联系平台运维核对服务连接。'}</p>
            <Button onClick={() => setCatalogReload((value) => value + 1)}>重新读取</Button>
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
          <div className={styles.railLabel}>当前账号可查看</div>
          <ul className={styles.catalogList}>
            {pagedDashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <button
                  className={`${styles.catalogItem} ${dashboard.id === selected?.id ? styles.catalogItemSelected : ''}`}
                  onClick={() => setSelectedId(dashboard.id)}
                  aria-pressed={dashboard.id === selected?.id}
                >
                  <strong>{dashboard.title}</strong>
                  <span>只读视图 · 看板 {dashboard.id}</span>
                </button>
              </li>
            ))}
          </ul>
          {visibleDashboards.length === 0 ? <div className={local.emptyDirectory}><p>没有匹配的看板。</p><Button size="small" onClick={() => { setQuery(''); setRailPage(0) }}>清空搜索</Button></div> : null}
          <Pager label="分析看板目录分页" page={railPage} pageCount={railPageCount} pageSize={RAIL_PAGE_SIZE} onPageChange={setRailPage} />
        </aside>

        <section className={styles.workspaceMain} aria-label={`${selected?.title ?? '分析看板'}嵌入视图`}>
          <div className={styles.assetToolbar}>
            <div className={styles.assetIdentity}>
              <div className={styles.assetIdentityTop}>
                <span className={styles.assetCode}>只读嵌入 · 看板 {selected?.id}</span>
                <Tag color={embedState === 'mounted' ? 'success' : embedState === 'error' ? 'warning' : 'default'}>
                  {embedState === 'mounted' ? '已嵌入' : embedState === 'error' ? '嵌入失败' : '载入中'}
                </Tag>
              </div>
              <h2>{selected?.title}</h2>
              <p>按当前账号授权查看；指标口径与来源可在资产目录中复核。</p>
            </div>
            <Button size="small" disabled={embedState === 'mounting'} onClick={() => setEmbedReload((value) => value + 1)}>刷新看板</Button>
          </div>
          {embedState === 'error' ? (
            <section className={local.inlineState} role="status">
              <Tag color="warning">嵌入失败</Tag>
              <p>当前看板未能载入。可重新加载；持续失败时请联系平台运维核对访问配置。</p>
              <Button size="small" onClick={() => setEmbedReload((value) => value + 1)}>重新加载看板</Button>
            </section>
          ) : null}
          {embedState === 'mounting' ? (
            <section className={local.inlineState} role="status" aria-busy="true">
              <p>正在载入看板并校验访问权限…</p>
              <Skeleton active paragraph={{ rows: 4 }} />
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
          <div className={styles.evidenceHeader}><h2>访问证据</h2><Tag>受控只读</Tag></div>
          <div className={styles.evidenceBody}>
            <div className={styles.evidenceStamp}>
              <span className={styles.evidenceStampIcon}><ShieldCheck size={17} /></span>
              <div><strong>{selected?.title}</strong><span>看板编号 {selected?.id}</span></div>
            </div>
            <dl className={styles.evidenceDefinition}>
              <div><dt>访问范围</dt><dd>仅当前账号已授权的看板</dd></div>
              <div><dt>操作权限</dt><dd>只读查看，不能在门户修改分析定义</dd></div>
              <div><dt>会话验证</dt><dd>访问凭证短时有效，由平台自动续签</dd></div>
              <div><dt>加载状态</dt><dd>{embedState === 'mounted' ? '已完成嵌入；数据结果以看板内刷新时间为准' : embedState === 'error' ? '加载失败，尚未确认数据结果' : '正在验证访问与加载看板'}</dd></div>
            </dl>
            <a className={`${styles.externalLinkButton} ${styles.evidenceAction}`} href={routePaths.assets}>查看数据资产与血缘</a>
          </div>
        </aside>
      </div>
    </div>
  )
}

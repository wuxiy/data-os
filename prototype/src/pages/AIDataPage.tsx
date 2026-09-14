import { BrainCircuit, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { Drawer } from '../components/ui/Drawer'
import {
  createAIDataProduct,
  evaluateAIDataProduct,
  fetchAIOverview,
  fetchAIDataProducts,
  lifecycleLabel,
  nextLifecycleTarget,
  productTypeLabel,
  transitionAIDataProduct,
  buildAIDataProduct,
  type AIDataProduct,
  type AIDataProductType,
} from '../data/aiDataApi'
import { PortalHttpError } from '../data/http'
import { useAction } from '../hooks/useAction'
import { frontendDemoMode } from '../data/runtimeMode'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import { Pager } from '../components/ui/Pager'
import type { AIOverview } from '../data/aiDataApi'
import { AIDataDetailPage } from './AIDataDetailPage'
import styles from './IntegrationPages.module.css'
// 抽屉表单体系与数据接入/数据服务页同源，保持一处维护。
import formStyles from './Pages.module.css'

const PRODUCT_TYPES = Object.keys(productTypeLabel) as AIDataProductType[]

/**
 * AI Data 工作台（G8）：AI Data Product 一等域对象的列表与详情。
 * 真实构建渲染控制面 API；演示构建不收录静态样例（AI Data 无 mock 数据，
 * 演示模式显示边界说明）——与「不把演示状态当真实业务事实」口径一致。
 */
export function AIDataPage({ onNotice }: { onNotice: (message: string) => void }) {
  if (!frontendDemoMode) {
    return <AIDataLive onNotice={onNotice} />
  }
  return (
    <div className={styles.integrationPage}>
      <PageHeader title="AI Data" eyebrow="AI Ready Data" subtitle="AI 数据产品的清单、版本与生命周期工作台" compact />
      <section className={styles.technicalNotice} role="status">
        <StatusTag tone="neutral">演示边界</StatusTag>
        <span>AI Data 工作台仅接入真实控制面 API（G8 起交付）；演示构建未收录静态样例。请以真实模式访问。</span>
      </section>
    </div>
  )
}

function AIDataLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [products, setProducts] = useState<AIDataProduct[]>([])
  const [overview, setOverview] = useState<AIOverview | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    type: 'RAG_CORPUS' as AIDataProductType,
    owner: '',
    workflow: 'MEDICAL_RAG',
    source: '',
  })

  const listState = useApiResource({
    reloadKey: refreshTick,
    load: async (signal) => {
      const [items, overviewResponse] = await Promise.all([
        fetchAIDataProducts(signal),
        fetchAIOverview(signal).catch(() => null),
      ])
      return { items, overviewResponse }
    },
    onData: ({ items, overviewResponse }) => {
      setOverview(overviewResponse)
      setProducts(items)
      setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : items[0]?.id ?? ''))
    },
    onUnavailable: () => setProducts([]),
    timeoutMs: 15000,
  })

  // 目录分页（hook 在 listState 早退分支之前调用）：产品清单增长后侧栏不失控。
  const RAIL_PAGE_SIZE = 8
  const { page: railPage, setPage: setRailPage, paged: pagedProducts, pageCount: railPageCount } = usePaged(products, RAIL_PAGE_SIZE)

  function refresh() {
    setRefreshTick((tick) => tick + 1)
  }

  // 动作互斥统一；错误通道按 cause 特判引擎守护（未配置/不可达）。
  const { pendingKey, run: runAction } = useAction((message, cause) => {
    if (cause instanceof PortalHttpError && cause.code === 'AI_READY_ENGINE_NOT_CONFIGURED') {
      onNotice('评估引擎未配置（data-os.ai-ready.base-url）：build 不伪造成功')
    } else if (cause instanceof PortalHttpError && cause.status === 503) {
      onNotice('评估引擎暂不可达，请稍后重试')
    } else {
      onNotice(message)
    }
  })

  function submitCreate() {
    if (!form.name.trim() || !form.owner.trim() || !form.source.trim()) {
      onNotice('请完整填写名称、负责人与数据来源')
      return
    }
    void runAction('create', '创建失败', async () => {
      const product = await createAIDataProduct({
        name: form.name.trim(),
        type: form.type,
        owner: form.owner.trim(),
        workflow: form.workflow.trim(),
        source: form.source.trim(),
      })
      onNotice(`已创建 AI Data Product：${product.name}（${product.currentVersion}）`)
      setCreateOpen(false)
      setForm((current) => ({ ...current, name: '', owner: '', source: '' }))
      setSelectedId(product.id)
      refresh()
    })
  }

  function advance(product: AIDataProduct) {
    const target = nextLifecycleTarget(product.lifecycle)
    if (!target) {
      onNotice(`${lifecycleLabel[product.lifecycle]}状态没有主链下一步`)
      return
    }
    void runAction(`advance-${product.id}`, '流转失败', async () => {
      await transitionAIDataProduct(product.id, target)
      onNotice(`${product.name} 已流转到「${lifecycleLabel[target]}」`)
      refresh()
    })
  }

  function deprecate(product: AIDataProduct) {
    void runAction(`deprecate-${product.id}`, '弃用失败', async () => {
      await transitionAIDataProduct(product.id, 'DEPRECATED')
      onNotice(`${product.name} 已弃用`)
      refresh()
    })
  }

  function runEvaluation(product: AIDataProduct) {
    void runAction(`evaluate-${product.id}`, '评测失败', async () => {
      const report = await evaluateAIDataProduct(product.id)
      onNotice(`评测完成：MRR ${report.mrr?.toFixed?.(2) ?? '—'} · Recall@5 ${report.retrieval_recall_at_5?.toFixed?.(2) ?? '—'}（已并入版本报告）`)
      setSelectedId(product.id)
      refresh()
    })
  }

  function build(product: AIDataProduct) {
    void runAction(`build-${product.id}`, '构建失败', async () => {
      const summary = await buildAIDataProduct(product.id)
      onNotice(`评估完成：Overall ${summary.overall?.toFixed?.(2) ?? '—'} · ${summary.certification ?? ''}（已回写 ${product.currentVersion}）`)
      setSelectedId(product.id)
      refresh()
    })
  }

  if (listState !== 'live') {
    return (
      <div className={styles.integrationPage}>
        <PageHeader title="AI Data" eyebrow="AI Ready Data" subtitle="AI 数据产品的清单、版本与生命周期工作台" compact />
        <section className={styles.technicalNotice} role="status">
          <StatusTag tone="warning">{listState === 'loading' ? '读取中' : '待接入'}</StatusTag>
          <span>{listState === 'loading' ? '正在从控制面读取 AI Data 产品…' : '控制面暂不可用：AI Data 域需要控制面已配置并可访问。'}</span>
        </section>
      </div>
    )
  }

  const selected = products.find((item) => item.id === selectedId) ?? null

  return (
    <div className={styles.integrationPage}>
      <PageHeader title="AI Data" eyebrow="AI Ready Data" subtitle="AI 数据产品的清单、版本与生命周期工作台" compact />
      {overview ? (
        <div className={styles.lineageImpact} role="status" aria-label="AI Ready 概览">
          <div className={styles.impactItem}><span>AI Data 产品</span><strong>{overview.products}</strong></div>
          <div className={styles.impactItem}><span>已认证 / 服务中</span><strong>{overview.certified} / {overview.serving}</strong></div>
          <div className={styles.impactItem}><span>平均就绪度</span><strong>{overview.averageOverall.toFixed(2)}</strong></div>
          <div className={styles.impactItem}><span>最新评测 MRR</span><strong>{overview.latestMrr.toFixed(2)}</strong></div>
          <div className={styles.impactItem}><span>待处理反馈</span><strong>{overview.openFeedback}</strong></div>
        </div>
      ) : null}
      <div className={`${styles.integrationWorkspace} ${styles.integrationWorkspaceDuo}`}>
        <aside className={styles.catalogRail} aria-label="AI Data 产品目录">
          <div className={styles.railHeader}>
            <h2>AI Data Products</h2>
            <span className={styles.railCount}>{products.length} 项</span>
          </div>
          <div className={styles.railAction}>
            <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={13} aria-hidden="true" />新建产品</Button>
          </div>
          <div className={styles.schemaTabs}>
            <button className={styles.schemaTab} onClick={refresh}>
              <RefreshCw size={12} aria-hidden="true" /> 刷新
            </button>
          </div>
          <ul className={styles.catalogList}>
            {pagedProducts.map((product) => (
              <li key={product.id}>
                <button
                  className={`${styles.catalogItem} ${product.id === selectedId ? styles.catalogItemSelected : ''}`}
                  onClick={() => setSelectedId(product.id)}
                  aria-pressed={product.id === selectedId}
                >
                  <strong><BrainCircuit size={13} aria-hidden="true" /> {product.name}</strong>
                  <span>{productTypeLabel[product.productType]}</span>
                  <div className={styles.catalogMeta}>
                    <em>{product.currentVersion}</em>
                    <i className={styles.healthMark}>{lifecycleLabel[product.lifecycle]}</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {products.length === 0 ? <div className={styles.emptyRail}>暂无 AI Data Product，点击「新建产品」创建第一个。</div> : null}
          <Pager label="产品目录分页" page={railPage} pageCount={railPageCount} pageSize={RAIL_PAGE_SIZE} onPageChange={setRailPage} />
        </aside>

        <section className={styles.workspaceMain} aria-label="AI Data 产品详情">
          {selected ? (
            <AIDataDetailPage
              key={selected.id}
              productId={selected.id}
              onNotice={onNotice}
              onAdvance={() => advance(selected)}
              onDeprecate={() => deprecate(selected)}
              onBuild={() => build(selected)}
              onChanged={refresh}
            />
          ) : (
            <div className={styles.technicalNotice} role="status">
              <StatusTag tone="neutral">未选择</StatusTag>
              <span>从左侧选择一个 AI Data Product 查看版本历史与生命周期。</span>
            </div>
          )}
        </section>
      </div>

      {createOpen ? <Drawer
        titleId="ai-product-create-title"
        eyebrow="AI Data Product 登记"
        title="新建 AI Data Product"
        closeLabel="关闭新建 AI Data Product"
        onClose={() => setCreateOpen(false)}
        footer={<><button className={formStyles.secondaryButton} type="button" onClick={() => setCreateOpen(false)}>取消</button><button className={formStyles.primaryButton} type="submit" form="ai-product-create-form" disabled={pendingKey === 'create'}><Plus size={14} />{pendingKey === 'create' ? '创建中…' : `创建（${lifecycleLabel.DRAFT} + v0.1.0）`}</button></>}
      >
        <form id="ai-product-create-form" className={formStyles.drawerForm} onSubmit={(event) => { event.preventDefault(); void submitCreate() }}>
          <div className={formStyles.drawerNotice}><Sparkles size={16} /><span>创建后从「{lifecycleLabel.DRAFT} + v0.1.0」起步：构建与评估委托 AI Ready 引擎执行，结论回写当前版本的就绪度。</span></div>
          <div className={formStyles.drawerFormGrid}>
            <div className={formStyles.formField}><label htmlFor="ai-product-name">名称</label><input id="ai-product-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：临床指南 RAG 语料库" /></div>
            <div className={formStyles.formField}><label htmlFor="ai-product-type">类型</label><select id="ai-product-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as AIDataProductType })}>{PRODUCT_TYPES.map((type) => <option key={type} value={type}>{productTypeLabel[type]}</option>)}</select></div>
          </div>
          <div className={formStyles.drawerFormGrid}>
            <div className={formStyles.formField}><label htmlFor="ai-product-owner">负责人</label><input id="ai-product-owner" required value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="如：data-team" /></div>
            <div className={formStyles.formField}><label htmlFor="ai-product-workflow">工作流</label><input id="ai-product-workflow" value={form.workflow} onChange={(event) => setForm({ ...form, workflow: event.target.value })} placeholder="如：MEDICAL_RAG" /></div>
          </div>
          <div className={formStyles.formField}><label htmlFor="ai-product-source">数据来源</label><input id="ai-product-source" required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="如：ods_ep 处方与诊断（合成口径）" /></div>
        </form>
      </Drawer> : null}
    </div>
  )
}

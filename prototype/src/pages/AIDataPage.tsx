import { Surface } from '../components/ui/Surface'
import { BrainCircuit, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Drawer, Form, Input, Select, Skeleton, Tag } from 'antd'
import { PageHeader } from '../components/ui/PageHeader'
import {
  aiCertificationLabel,
  createAIDataProduct,
  evaluateAIDataProduct,
  fetchAIOverview,
  fetchAIDataProducts,
  fetchBuildJobs,
  isBuildJobActive,
  lifecycleLabel,
  nextLifecycleTarget,
  parseBuildResult,
  productTypeLabel,
  transitionAIDataProduct,
  submitAIBuild,
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
import local from './AIDataPage.module.css'
// 抽屉表单体系与数据接入/数据服务页同源，保持一处维护。
import formStyles from './Pages.module.css'

const PRODUCT_TYPES = Object.keys(productTypeLabel) as AIDataProductType[]
const DRAWER_WIDTH = 'min(540px, 44vw)'

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
      <PageHeader title="AI 数据产品" eyebrow="AI 数据产品" subtitle="AI 数据产品的清单、版本与生命周期工作台" compact />
      <section className={`${styles.technicalNotice} ${local.statusNotice}`} role="status">
        <Tag>演示边界</Tag>
        <span>AI Data 工作台仅接入真实控制面 API（G8 起交付）；演示构建未收录静态样例。请以真实模式访问。</span>
      </section>
    </div>
  )
}

function AIDataLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [products, setProducts] = useState<AIDataProduct[]>([])
  const [overview, setOverview] = useState<AIOverview | null>(null)
  // 深链（G18）：?product= 直达选中，对齐 ?asset=/?issue= 口径；清单到达后校验有效性。
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(window.location.search).get('product') ?? '',
  )
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

  function selectProduct(id: string) {
    setSelectedId(id)
    window.history.replaceState({}, '', `${window.location.pathname}?product=${encodeURIComponent(id)}`)
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
      setForm((current) => ({ ...current, name: '', type: current.type, owner: '', source: '' }))
      selectProduct(product.id)
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

  function demote(product: AIDataProduct) {
    void runAction(`demote-${product.id}`, '撤下失败', async () => {
      await transitionAIDataProduct(product.id, 'ASSESSED')
      onNotice(`${product.name} 已撤下重评估（原服务停止）：重新提交认证审批通过后可再上架`)
      refresh()
    })
  }

  function runEvaluation(product: AIDataProduct) {
    void runAction(`evaluate-${product.id}`, '评测失败', async () => {
      const report = await evaluateAIDataProduct(product.id)
      onNotice(`评测完成：MRR ${report.mrr?.toFixed?.(2) ?? '—'} · Recall@5 ${report.retrieval_recall_at_5?.toFixed?.(2) ?? '—'}（已并入版本报告）`)
      selectProduct(product.id)
      refresh()
    })
  }

  function build(product: AIDataProduct) {
    // G20 任务态：投递（202）→ 轮询至终态 → 结果通知与刷新。轮询挂在动作互斥里，
    // 「构建 / 评估」按钮全程禁用，终态由控制面 worker 落库（断线可经任务列表追读）。
    const POLL_INTERVAL_MS = 2000
    const MAX_POLLS = 150
    void runAction(`build-${product.id}`, '构建失败', async () => {
      const submitted = await submitAIBuild(product.id)
      onNotice(`构建任务已投递（${submitted.versionSn}${submitted.recipeRef ? ` · ${submitted.recipeRef}` : ''}），排队执行中…`)
      let current = submitted
      for (let polls = 0; isBuildJobActive(current) && polls < MAX_POLLS; polls++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        const jobs = await fetchBuildJobs(product.id)
        current = jobs.find((item) => item.id === submitted.id) ?? current
      }
      if (current.status === 'FAILED') {
        onNotice(`构建失败：${current.error ?? '未知错误'}（版本构建状态已标失败，可重新发起）`)
        return
      }
      if (isBuildJobActive(current)) {
        onNotice('构建任务仍在执行（超过轮询窗口）：请稍后从「构建任务」区块或刷新查看结果')
        return
      }
      const summary = parseBuildResult(current)
      const certification = summary?.certification ? (aiCertificationLabel[summary.certification] ?? summary.certification) : '—'
      onNotice(summary?.build
        ? `构建完成：${summary.build.chunks} 个 chunk（RustFS ${summary.build.rustfs?.version ?? '—'}）→ 评估 Overall ${summary.overall?.toFixed?.(2) ?? '—'} · ${certification}（已回写 ${current.versionSn}）`
        : `评估完成：Overall ${summary?.overall?.toFixed?.(2) ?? '—'} · ${certification}（已回写 ${current.versionSn}）`)
      selectProduct(product.id)
      refresh()
    })
  }

  if (listState !== 'live') {
    return (
      <div className={styles.integrationPage}>
        <PageHeader title="AI 数据产品" eyebrow="AI 数据产品" subtitle="AI 数据产品的清单、版本与生命周期工作台" compact />
        <section className={`${styles.technicalNotice} ${local.statusNotice}`} role="status">
          <Tag color={listState === 'loading' ? undefined : 'warning'}>{listState === 'loading' ? '读取中' : '待接入'}</Tag>
          <span>{listState === 'loading' ? '正在读取 AI 数据产品目录与就绪度…' : '暂时无法读取产品目录，请检查控制面连接后重试。'}</span>
          {listState === 'unavailable' ? <Button size="small" onClick={refresh}>重新加载</Button> : null}
        </section>
        {listState === 'loading' ? <div className={local.loadingWorkspace} role="status" aria-label="正在读取产品目录"><Skeleton active paragraph={{ rows: 6 }} /></div> : null}
      </div>
    )
  }

  const selected = products.find((item) => item.id === selectedId) ?? null

  return (
    <div className={styles.integrationPage}>
      <PageHeader title="AI 数据产品" eyebrow="AI 数据产品" subtitle="AI 数据产品的清单、版本与生命周期工作台" compact />
      {overview ? (
        <div className={`${styles.lineageImpact} ${local.overview}`} role="status" aria-label="AI Ready 概览">
          <div className={styles.impactItem}><span>AI Data 产品</span><strong>{overview.products}</strong></div>
          <div className={styles.impactItem}><span>已认证 / 服务中</span><strong>{overview.certified} / {overview.serving}</strong></div>
          <div className={styles.impactItem}><span>平均就绪度</span><strong>{overview.averageOverall.toFixed(2)}</strong></div>
          <div className={styles.impactItem}><span>最新评测 MRR</span><strong>{overview.latestMrr.toFixed(2)}</strong></div>
          <div className={styles.impactItem}><span>待处理反馈</span><strong>{overview.openFeedback}</strong></div>
        </div>
      ) : null}
      <div className={`${styles.integrationWorkspace} ${styles.integrationWorkspaceDuo} ${local.workspace}`}>
        <Surface><aside className={styles.catalogRail} aria-label="AI Data 产品目录">
          <div className={styles.railHeader}>
            <h2>AI 数据产品</h2>
            <span className={styles.railCount}>{products.length} 项</span>
          </div>
          <div className={styles.railAction}>
            <Button type="primary" size="small" onClick={() => setCreateOpen(true)}><Plus size={13} aria-hidden="true" />新建产品</Button>
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
                  onClick={() => selectProduct(product.id)}
                  aria-pressed={product.id === selectedId}
                >
                  <strong><BrainCircuit size={13} aria-hidden="true" /> {product.name}</strong>
                  <span>{productTypeLabel[product.productType]}</span>
                  <div className={styles.catalogMeta}>
                    <em>{product.currentVersion}</em>
                    <i className={`${styles.healthMark} ${product.lifecycle === 'CERTIFIED' || product.lifecycle === 'SERVING' ? '' : local.neutralState}`}>{lifecycleLabel[product.lifecycle]}</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {products.length === 0 ? <div className={styles.emptyRail}>暂无 AI Data Product，点击「新建产品」创建第一个。</div> : null}
          <Pager label="产品目录分页" page={railPage} pageCount={railPageCount} pageSize={RAIL_PAGE_SIZE} onPageChange={setRailPage} />
        </aside></Surface>

        <section className={`${styles.workspaceMain} ${local.productMain}`} aria-label="AI Data 产品详情">
          {selected ? (
            <AIDataDetailPage
              key={selected.id}
              productId={selected.id}
              onNotice={onNotice}
              onAdvance={() => advance(selected)}
              onDeprecate={() => deprecate(selected)}
              onDemote={() => demote(selected)}
              onBuild={() => build(selected)}
              onChanged={refresh}
            />
          ) : (
            <div className={styles.technicalNotice} role="status">
              <Tag>未选择</Tag>
              <span>从左侧选择一个 AI Data Product 查看版本历史与生命周期。</span>
            </div>
          )}
        </section>
      </div>

      <Drawer
        open={createOpen}
        destroyOnHidden
        width={DRAWER_WIDTH}
        title={<DrawerTitle eyebrow="AI 数据产品登记" title="新建 AI 数据产品" />}
        onClose={() => setCreateOpen(false)}
        footer={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button type="primary" htmlType="submit" form="ai-product-create-form" loading={pendingKey === 'create'} icon={<Plus size={14} />}>{pendingKey === 'create' ? '创建中…' : `创建（${lifecycleLabel.DRAFT} + v0.1.0）`}</Button></>}
      >
        <Form id="ai-product-create-form" layout="vertical" onFinish={() => void submitCreate()}>
          <div className={formStyles.drawerNotice}><Sparkles size={16} /><span>创建后从「{lifecycleLabel.DRAFT} + v0.1.0」起步：构建与评估委托 AI Ready 引擎执行，结论回写当前版本的就绪度。</span></div>
          <div className={formStyles.drawerFormGrid}>
            <Form.Item label="名称" required>
              <Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：临床指南 RAG 语料库" />
            </Form.Item>
            <Form.Item label="类型">
              <Select value={form.type} onChange={(value) => setForm({ ...form, type: value as AIDataProductType })}
                options={PRODUCT_TYPES.map((type) => ({ value: type, label: productTypeLabel[type] }))} />
            </Form.Item>
          </div>
          <div className={formStyles.drawerFormGrid}>
            <Form.Item label="负责人" required>
              <Input required value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="如：data-team" />
            </Form.Item>
            <Form.Item label="工作流">
              <Input value={form.workflow} onChange={(event) => setForm({ ...form, workflow: event.target.value })} placeholder="如：MEDICAL_RAG" />
            </Form.Item>
          </div>
          <Form.Item label="数据来源" required>
            <Input required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="如：ods_ep 处方与诊断（合成口径）" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}

/** 抽屉标题：眉标 + 主标题，对齐原自研 Drawer 的标题结构。 */
function DrawerTitle({ eyebrow, title }: { eyebrow: ReactNode; title: ReactNode }) {
  return <div><span className={formStyles.drawerEyebrow}>{eyebrow}</span><h2 className={formStyles.drawerTitleText}>{title}</h2></div>
}

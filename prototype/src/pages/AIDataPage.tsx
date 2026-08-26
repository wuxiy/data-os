import { BrainCircuit, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  createAIDataProduct,
  fetchAIDataProducts,
  lifecycleLabel,
  nextLifecycleTarget,
  productTypeLabel,
  transitionAIDataProduct,
  buildAIDataProduct,
  AIDataError,
  type AIDataProduct,
  type AIDataProductType,
} from '../data/aiDataApi'
import { frontendDemoMode } from '../data/runtimeMode'
import { useApiResource } from '../hooks/useApiResource'
import { AIDataDetailPage } from './AIDataDetailPage'
import styles from './IntegrationPages.module.css'

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
  const [selectedId, setSelectedId] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    type: 'RAG_CORPUS' as AIDataProductType,
    owner: '',
    workflow: 'MEDICAL_RAG',
    source: '',
  })

  const listState = useApiResource({
    reloadKey: refreshTick,
    load: (signal) => fetchAIDataProducts(signal),
    onData: (items) => {
      setProducts(items)
      setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : items[0]?.id ?? ''))
    },
    onUnavailable: () => setProducts([]),
    timeoutMs: 15000,
  })

  function refresh() {
    setRefreshTick((tick) => tick + 1)
  }

  async function submitCreate() {
    if (!form.name.trim() || !form.owner.trim() || !form.source.trim()) {
      onNotice('请完整填写名称、负责人与数据来源')
      return
    }
    try {
      const product = await createAIDataProduct({
        name: form.name.trim(),
        type: form.type,
        owner: form.owner.trim(),
        workflow: form.workflow.trim(),
        source: form.source.trim(),
      })
      onNotice(`已创建 AI Data Product：${product.name}（${product.currentVersion}）`)
      setCreating(false)
      setForm((current) => ({ ...current, name: '', owner: '', source: '' }))
      setSelectedId(product.id)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '创建失败')
    }
  }

  async function advance(product: AIDataProduct) {
    const target = nextLifecycleTarget(product.lifecycle)
    if (!target) {
      onNotice(`${lifecycleLabel[product.lifecycle]}状态没有主链下一步`)
      return
    }
    try {
      await transitionAIDataProduct(product.id, target)
      onNotice(`${product.name} 已流转到「${lifecycleLabel[target]}」`)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '流转失败')
    }
  }

  async function deprecate(product: AIDataProduct) {
    try {
      await transitionAIDataProduct(product.id, 'DEPRECATED')
      onNotice(`${product.name} 已弃用`)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '弃用失败')
    }
  }

  async function build(product: AIDataProduct) {
    try {
      await buildAIDataProduct(product.id)
      onNotice('构建已登记')
    } catch (error) {
      if (error instanceof AIDataError && error.code === 'AI_READY_ENGINE_NOT_CONFIGURED') {
        onNotice('评估引擎待接入（G9）：当前阶段仅登记域对象，build 不伪造成功')
      } else {
        onNotice(error instanceof Error ? error.message : '构建失败')
      }
    }
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
      <div className={styles.integrationWorkspace}>
        <aside className={styles.catalogRail} aria-label="AI Data 产品目录">
          <div className={styles.railHeader}>
            <h2>AI Data Products</h2>
            <span className={styles.railCount}>{products.length} 项</span>
          </div>
          <div className={styles.schemaTabs}>
            <button className={styles.schemaTab} onClick={() => setCreating((value) => !value)}>
              {creating ? '收起创建' : '新建产品'}
            </button>
            <button className={styles.schemaTab} onClick={refresh}>
              <RefreshCw size={12} aria-hidden="true" /> 刷新
            </button>
          </div>
          {creating ? (
            <form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); void submitCreate() }}>
              <label>
                名称
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：临床指南 RAG 语料库" />
              </label>
              <label>
                类型
                <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as AIDataProductType })}>
                  {PRODUCT_TYPES.map((type) => (
                    <option key={type} value={type}>{productTypeLabel[type]}</option>
                  ))}
                </select>
              </label>
              <label>
                负责人
                <input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="如：data-team" />
              </label>
              <label>
                工作流
                <input value={form.workflow} onChange={(event) => setForm({ ...form, workflow: event.target.value })} />
              </label>
              <label>
                数据来源
                <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="如：ods_ep 处方与诊断（合成口径）" />
              </label>
              <Button type="submit">创建（{lifecycleLabel.DRAFT} + v0.1.0）</Button>
            </form>
          ) : null}
          <ul className={styles.catalogList}>
            {products.map((product) => (
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
            />
          ) : (
            <div className={styles.technicalNotice} role="status">
              <StatusTag tone="neutral">未选择</StatusTag>
              <span>从左侧选择一个 AI Data Product 查看版本历史与生命周期。</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

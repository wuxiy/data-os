import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  fetchAIDataProduct,
  lifecycleLabel,
  nextLifecycleTarget,
  productTypeLabel,
  type AIDataProductDetail,
} from '../data/aiDataApi'
import styles from './IntegrationPages.module.css'

/**
 * AI Data Product 详情（G8）：版本历史 + 生命周期操作 + build 守护提示。
 * 引擎未装配（G9 前）时 build 返回 503，本页常驻说明而非伪造构建成功。
 */
export function AIDataDetailPage({ productId, onNotice, onAdvance, onDeprecate, onBuild }: {
  productId: string
  onNotice: (message: string) => void
  onAdvance: () => void
  onDeprecate: () => void
  onBuild: () => void
}) {
  const [detail, setDetail] = useState<AIDataProductDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    setDetail(null)
    fetchAIDataProduct(productId, controller.signal)
      .then((response) => {
        setDetail(response)
        setState('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState('error')
      })
    return () => controller.abort()
  }, [productId])

  if (state === 'loading' || state === 'error' || !detail) {
    return (
      <div className={styles.technicalNotice} role="status">
        <StatusTag tone={state === 'loading' ? 'neutral' : 'warning'}>
          {state === 'loading' ? '读取中' : '读取失败'}
        </StatusTag>
        <span>{state === 'loading' ? '正在读取产品详情与版本历史…' : '产品详情暂时不可读，请稍后重试。'}</span>
      </div>
    )
  }

  const { product, versions } = detail
  const nextTarget = nextLifecycleTarget(product.lifecycle)

  return (
    <>
      <div className={styles.assetToolbar}>
        <div className={styles.assetIdentity}>
          <div className={styles.assetIdentityTop}>
            <span className={styles.assetCode}>{productTypeLabel[product.productType]}</span>
            <StatusTag tone={product.lifecycle === 'DEPRECATED' ? 'warning' : 'healthy'}>
              {lifecycleLabel[product.lifecycle]}
            </StatusTag>
          </div>
          <h2>{product.name}</h2>
          <p>{product.id} · 当前版本 {product.currentVersion} · 负责人 {product.owner} · 工作流 {product.workflowType}</p>
        </div>
        <div className={styles.toolbarActions}>
          {nextTarget ? (
            <Button onClick={onAdvance}>推进到「{lifecycleLabel[nextTarget]}」</Button>
          ) : null}
          {product.lifecycle !== 'DEPRECATED' ? (
            <Button onClick={onDeprecate}>弃用</Button>
          ) : null}
          <Button onClick={onBuild}>构建 / 评估</Button>
        </div>
      </div>

      <div className={styles.assetBody}>
        <section className={styles.contentPanel}>
          <div className={styles.contentPanelHeader}>
            <h3>数据来源</h3>
            <span>登记口径（G8 域基础）</span>
          </div>
          <div className={styles.descriptionBlock}>
            <p>{product.sourceDesc}</p>
          </div>
        </section>

        <section className={styles.contentPanel}>
          <div className={styles.contentPanelHeader}>
            <h3>版本历史</h3>
            <span>{versions.length} 个版本 · 按创建时间升序</span>
          </div>
          <div className={styles.horizontalScroll}>
            <table className={styles.fieldTable}>
              <thead><tr><th>版本</th><th>构建状态</th><th>Recipe</th><th>Git Commit</th><th>快照日期</th><th>创建时间</th></tr></thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td>{version.versionSn}</td>
                    <td><StatusTag tone={version.buildStatus === 'REGISTERED' ? 'neutral' : 'healthy'}>{version.buildStatus}</StatusTag></td>
                    <td>{version.recipeRef ?? '—'}</td>
                    <td>{version.gitCommit ?? '—'}</td>
                    <td>{version.snapshotAt ?? '—'}</td>
                    <td>{new Date(version.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.technicalNotice} role="status">
          <StatusTag tone="warning">评估引擎待接入</StatusTag>
          <span>G8 交付域基础（清单 / 版本 / 生命周期）；就绪度评估与真实构建在 G9 引擎装配后开放，build 当前返回明确的「未装配」而不伪造成功。</span>
        </section>
      </div>
    </>
  )
}

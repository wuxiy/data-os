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

function readinessOf(version: { readinessJson: string | null }): { overall: number; certification: string } | null {
  if (!version.readinessJson) return null
  try {
    const payload = JSON.parse(version.readinessJson) as { overall?: number; gate?: { certification?: string } }
    if (typeof payload.overall !== 'number') return null
    return { overall: payload.overall, certification: payload.gate?.certification ?? '' }
  } catch {
    return null
  }
}

/** AI Data Product 详情（G8/G9）：版本历史 + 生命周期操作 + build 守护提示。 */
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
              <thead><tr><th>版本</th><th>构建状态</th><th>就绪度</th><th>Recipe</th><th>Git Commit</th><th>创建时间</th></tr></thead>
              <tbody>
                {versions.map((version) => {
                  const readiness = readinessOf(version)
                  return (
                    <tr key={version.id}>
                      <td>{version.versionSn}</td>
                      <td><StatusTag tone={version.buildStatus === 'REGISTERED' ? 'neutral' : 'healthy'}>{version.buildStatus}</StatusTag></td>
                      <td>
                        {readiness
                          ? <StatusTag tone={readiness.certification === 'BLOCKED' ? 'danger' : readiness.certification === 'CANDIDATE' ? 'healthy' : 'warning'}>
                              {readiness.overall.toFixed(2)} · {readiness.certification}
                            </StatusTag>
                          : <span>—</span>}
                      </td>
                      <td>{version.recipeRef ?? '—'}</td>
                      <td>{version.gitCommit ?? '—'}</td>
                      <td>{new Date(version.createdAt).toLocaleString('zh-CN')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.technicalNotice} role="status">
          <StatusTag tone="warning">评估引擎</StatusTag>
          <span>构建/评估委托 AI Ready 引擎（G9）执行：结论回写当前版本的就绪度列；引擎未配置时 build 返回明确的 503 而不伪造成功。</span>
        </section>
      </div>
    </>
  )
}

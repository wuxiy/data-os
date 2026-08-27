import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  decideCertification,
  fetchAIDataProduct,
  fetchCertificationRequests,
  fetchFeedback,
  resolveFeedback,
  submitCertification,
  submitFeedback,
  lifecycleLabel,
  nextLifecycleTarget,
  productTypeLabel,
  type AICertificationRequest,
  type AIDataProductDetail,
  type AIEvaluationFeedbackItem,
} from '../data/aiDataApi'
import styles from './IntegrationPages.module.css'

interface Props {
  productId: string
  onNotice: (message: string) => void
  onAdvance: () => void
  onDeprecate: () => void
  onBuild: () => void
  onChanged?: () => void
}

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
export function AIDataDetailPage({ productId, onNotice, onAdvance, onDeprecate, onBuild, onChanged }: Props) {
  const [detail, setDetail] = useState<AIDataProductDetail | null>(null)
  const [certifications, setCertifications] = useState<AICertificationRequest[]>([])
  const [feedback, setFeedback] = useState<AIEvaluationFeedbackItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    setDetail(null)
    setCertifications([])
    setFeedback([])
    Promise.all([
      fetchAIDataProduct(productId, controller.signal),
      fetchCertificationRequests(productId, controller.signal).catch(() => []),
      fetchFeedback(productId, controller.signal).catch(() => []),
    ])
      .then(([response, requests, feedbackItems]) => {
        setDetail(response)
        setCertifications(requests)
        setFeedback(feedbackItems)
        setState('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState('error')
      })
    return () => controller.abort()
  }, [productId])

  async function handleSubmitCertification() {
    try {
      await submitCertification(productId)
      onNotice('认证审批已提交（等待审批）')
      onChanged?.()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '提交失败')
    }
  }

  async function handleResolveFeedback(feedbackId: string, consume: boolean) {
    try {
      await resolveFeedback(feedbackId, consume, consume ? '已吸收进下一版本改进' : '证据不足驳回')
      onNotice(consume ? '反馈已标记吸收（由人工触发新版本与语料调整）' : '反馈已驳回')
      onChanged?.()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '处置失败')
    }
  }

  async function handleSubmitFeedback() {
    try {
      await submitFeedback(productId, {
        question: window.prompt('失败样本问题（评测明细中的问题）') ?? '',
        metric: 'faithfulness',
        feedbackType: 'CHUNK_QUALITY',
      })
      onNotice('反馈已提交（进入 Learning Plane 队列）')
      onChanged?.()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '提交失败')
    }
  }

  async function handleDecision(request: AICertificationRequest, approve: boolean) {
    try {
      await decideCertification(request.id, approve, approve ? '同意认证' : '退回：证据不足')
      onNotice(approve ? '已批准，产品进入「已认证」' : '已退回，保持「已评估」')
      onChanged?.()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '审批失败')
    }
  }

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
          {product.lifecycle === 'ASSESSED' ? (
            <Button onClick={() => void handleSubmitCertification()}>提交认证审批</Button>
          ) : null}
          {product.lifecycle !== 'DEPRECATED' ? (
            <Button onClick={onDeprecate}>弃用</Button>
          ) : null}
          <Button onClick={onBuild}>构建 / 评估</Button>
          <Button onClick={() => void handleSubmitFeedback()}>反馈失败样本</Button>
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

        {(() => {
          const evaluation = (() => {
            if (!detail) return null
            const version = detail.versions.find((item) => item.versionSn === product.currentVersion)
            if (!version?.readinessJson) return null
            try {
              const payload = JSON.parse(version.readinessJson) as { evaluation?: Record<string, number> }
              return payload.evaluation ?? null
            } catch {
              return null
            }
          })()
          if (!evaluation) return null
          return (
            <section className={styles.contentPanel}>
              <div className={styles.contentPanelHeader}>
                <h3>评测指标（RAG Eval · 合成评测集）</h3>
                <span>评测集 {evaluation.eval_set_size ?? evaluation.evalSetSize ?? '—'} 问</span>
              </div>
              <div className={styles.lineageImpact}>
                <div className={styles.impactItem}><span>Recall@5</span><strong>{Number(evaluation.retrieval_recall_at_5 ?? evaluation.retrievalRecallAt5 ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>Precision@5</span><strong>{Number(evaluation.precision_at_5 ?? evaluation.precisionAt5 ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>MRR</span><strong>{Number(evaluation.mrr ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>引用正确率</span><strong>{Number(evaluation.citation_correctness ?? evaluation.citationCorrectness ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>忠实度</span><strong>{Number(evaluation.faithfulness ?? 0).toFixed(2)}</strong></div>
              </div>
            </section>
          )
        })()}

        {(() => {
          // 版本对比（G12 飞轮呈现面）：相邻版本的 Overall/MRR/Faithfulness 变化
          const rows = detail.versions.map((version) => {
            if (!version.readinessJson) return null
            try {
              const payload = JSON.parse(version.readinessJson) as {
                overall?: number
                evaluation?: { mrr?: number; faithfulness?: number }
              }
              return { versionSn: version.versionSn, overall: payload.overall ?? null,
                       mrr: payload.evaluation?.mrr ?? null, faith: payload.evaluation?.faithfulness ?? null }
            } catch {
              return null
            }
          }).filter(Boolean) as { versionSn: string; overall: number | null; mrr: number | null; faith: number | null }[]
          if (rows.length < 2) return null
          return (
            <section className={styles.contentPanel}>
              <div className={styles.contentPanelHeader}>
                <h3>版本对比（数据飞轮）</h3>
                <span>就绪度与评测指标随版本演进</span>
              </div>
              <div className={styles.horizontalScroll}>
                <table className={styles.fieldTable}>
                  <thead><tr><th>版本</th><th>Overall</th><th>MRR</th><th>忠实度</th></tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.versionSn}>
                        <td>{row.versionSn}</td>
                        <td>{row.overall?.toFixed(4) ?? '—'}</td>
                        <td>{row.mrr?.toFixed(2) ?? '—'}</td>
                        <td>{row.faith?.toFixed(2) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })()}

        {feedback.length > 0 ? (
          <section className={styles.contentPanel}>
            <div className={styles.contentPanelHeader}>
              <h3>评测反馈（数据飞轮 · Learning Plane）</h3>
              <span>失败样本驱动版本改进；处置只改状态，候选不自动上线</span>
            </div>
            <div className={styles.horizontalScroll}>
              <table className={styles.fieldTable}>
                <thead><tr><th>问题</th><th>指标</th><th>类型</th><th>状态</th><th>处置说明</th><th>操作</th></tr></thead>
                <tbody>
                  {feedback.map((item) => (
                    <tr key={item.id}>
                      <td>{item.question}</td>
                      <td>{item.metric || '—'}</td>
                      <td>{item.feedbackType}</td>
                      <td>
                        <StatusTag tone={item.status === 'CREATED' ? 'warning' : item.status === 'CONSUMED' ? 'healthy' : 'neutral'}>
                          {item.status === 'CREATED' ? '待处置' : item.status === 'CONSUMED' ? '已吸收' : '已驳回'}
                        </StatusTag>
                      </td>
                      <td>{item.resolution ?? item.detail ?? '—'}</td>
                      <td>
                        {item.status === 'CREATED' ? (
                          <span className={styles.toolbarActions}>
                            <Button onClick={() => void handleResolveFeedback(item.id, true)}>吸收</Button>
                            <Button onClick={() => void handleResolveFeedback(item.id, false)}>驳回</Button>
                          </span>
                        ) : (item.resolvedBy ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {certifications.length > 0 ? (
          <section className={styles.contentPanel}>
            <div className={styles.contentPanelHeader}>
              <h3>认证审批</h3>
              <span>{certifications.length} 条记录 · CERTIFIED 仅可经审批流转</span>
            </div>
            <div className={styles.horizontalScroll}>
              <table className={styles.fieldTable}>
                <thead><tr><th>版本</th><th>就绪度</th><th>状态</th><th>提交人</th><th>审批人</th><th>操作</th></tr></thead>
                <tbody>
                  {certifications.map((request) => (
                    <tr key={request.id}>
                      <td>{request.versionSn}</td>
                      <td>{request.readinessOverall?.toFixed?.(2) ?? '—'}</td>
                      <td>
                        <StatusTag tone={request.decision === 'APPROVED' ? 'healthy' : request.decision === 'REJECTED' ? 'danger' : 'warning'}>
                          {request.decision === 'PENDING' ? '待审批' : request.decision === 'APPROVED' ? '已批准' : '已退回'}
                        </StatusTag>
                      </td>
                      <td>{request.requestedBy}</td>
                      <td>{request.decidedBy ?? '—'}</td>
                      <td>
                        {request.decision === 'PENDING' ? (
                          <span className={styles.toolbarActions}>
                            <Button onClick={() => void handleDecision(request, true)}>批准</Button>
                            <Button onClick={() => void handleDecision(request, false)}>退回</Button>
                          </span>
                        ) : (request.decisionNote ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className={styles.technicalNotice} role="status">
          <StatusTag tone="warning">评估引擎</StatusTag>
          <span>构建/评估委托 AI Ready 引擎（G9）执行：结论回写当前版本的就绪度列；引擎未配置时 build 返回明确的 503 而不伪造成功。</span>
        </section>
      </div>
    </>
  )
}

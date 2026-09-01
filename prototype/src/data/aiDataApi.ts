import { getAccessToken } from './oidc'

/**
 * AI Data Product API 客户端（控制面 G8 域，见 docs/ai-ready-g8-review-and-plan-20260826.md）。
 * 类型与 control-plane `ai` 包的 record 一一对应；lifecycle/type 词汇以
 * CONTEXT.md「AI Ready Data」为准。
 */

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

export type AIDataProductType =
  | 'RAG_CORPUS'
  | 'TRAINING_DATASET'
  | 'INSTRUCTION_DATASET'
  | 'PREFERENCE_DATASET'
  | 'FEATURE_DATASET'
  | 'AGENT_CONTEXT'
  | 'EVALUATION_DATASET'
  | 'MULTIMODAL_DATASET'

export type AIDataProductLifecycle =
  | 'DRAFT'
  | 'CURATED'
  | 'ASSESSED'
  | 'CERTIFIED'
  | 'SERVING'
  | 'DEPRECATED'

export interface AIDataProduct {
  id: string
  tenantId: string
  name: string
  productType: AIDataProductType
  owner: string
  workflowType: string
  sourceDesc: string
  currentVersion: string
  lifecycle: AIDataProductLifecycle
  createdAt: string
  updatedAt: string
}

export interface ReadinessEvaluation {
  evalSetSize: number | null
  retrievalRecallAt5: number | null
  precisionAt5: number | null
  mrr: number | null
  citationCorrectness: number | null
  faithfulness: number | null
}

/** readiness_json 的只读投影：就绪度报告（ai-ready-service models.py）是
 *  camelCase，RAG 评测段（/evaluate 回写）是 snake_case——历史两代拼写
 *  都在版本行里，边界处一次解析并归一为 camelCase 视图，页面不再碰原文。 */
export interface ReadinessView {
  overall: number | null
  certification: string | null
  evaluation: ReadinessEvaluation | null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key]
  }
  return undefined
}

export function parseReadiness(readinessJson: string | null | undefined): ReadinessView | null {
  if (!readinessJson) return null
  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readinessJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    payload = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const gate = payload.gate
  const evaluationRaw = payload.evaluation
  let evaluation: ReadinessEvaluation | null = null
  if (evaluationRaw && typeof evaluationRaw === 'object' && !Array.isArray(evaluationRaw)) {
    const section = evaluationRaw as Record<string, unknown>
    evaluation = {
      evalSetSize: num(pick(section, 'evalSetSize', 'eval_set_size')),
      retrievalRecallAt5: num(pick(section, 'retrievalRecallAt5', 'retrieval_recall_at_5')),
      precisionAt5: num(pick(section, 'precisionAt5', 'precision_at_5')),
      mrr: num(section.mrr),
      citationCorrectness: num(pick(section, 'citationCorrectness', 'citation_correctness')),
      faithfulness: num(section.faithfulness),
    }
  }
  const certification = (gate && typeof gate === 'object' && !Array.isArray(gate)
    ? (gate as Record<string, unknown>).certification : undefined)
  return {
    overall: num(payload.overall),
    certification: typeof certification === 'string' ? certification : null,
    evaluation,
  }
}

export interface AIDataProductVersion {
  id: string
  productId: string
  versionSn: string
  recipeRef: string | null
  gitCommit: string | null
  snapshotAt: string | null
  readiness: ReadinessView | null
  buildStatus: string
  createdAt: string
}

export interface AIDataProductDetail {
  product: AIDataProduct
  versions: AIDataProductVersion[]
}

export class AIDataError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = '') {
    super(message)
    this.name = 'AIDataError'
    this.status = status
    this.code = code
  }
}

async function aiFetch(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal })
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
  }
  return response
}

async function parseOrThrow(response: Response, prefix: string): Promise<unknown> {
  if (!response.ok) {
    let detail = ''
    let code = ''
    try {
      const payload = await response.json() as { message?: string; code?: string }
      detail = payload.message ?? ''
      code = payload.code ?? ''
    } catch {
      // 非 JSON 错误体时仅保留 HTTP 状态
    }
    throw new AIDataError(`${prefix}${detail ? `：${detail}` : ''}（HTTP ${response.status}）`, response.status, code)
  }
  return response.json()
}

export async function fetchAIDataProducts(signal?: AbortSignal): Promise<AIDataProduct[]> {
  const payload = await parseOrThrow(await aiFetch('/v1/ai-data-products', {}, signal), 'AI Data 产品列表读取失败')
  return (payload as { items: AIDataProduct[] }).items ?? []
}

export async function fetchAIDataProduct(id: string, signal?: AbortSignal): Promise<AIDataProductDetail> {
  const payload = await parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}`, {}, signal),
    'AI Data 产品详情读取失败',
  ) as {
    product: AIDataProduct
    versions: Array<Omit<AIDataProductVersion, 'readiness'> & { readinessJson: string | null }>
  }
  // 边界投影：原文 readinessJson 不出 API client。
  return {
    product: payload.product,
    versions: payload.versions.map(({ readinessJson, ...rest }) => ({
      ...rest,
      readiness: parseReadiness(readinessJson),
    })),
  }
}

export async function createAIDataProduct(request: {
  name: string
  type: AIDataProductType
  owner: string
  workflow: string
  source: string
}, signal?: AbortSignal): Promise<AIDataProduct> {
  return parseOrThrow(
    await aiFetch('/v1/ai-data-products', { method: 'POST', body: JSON.stringify(request) }, signal),
    'AI Data 产品创建失败',
  ) as Promise<AIDataProduct>
}

export async function transitionAIDataProduct(id: string, target: AIDataProductLifecycle): Promise<AIDataProduct> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
    '生命周期流转失败',
  ) as Promise<AIDataProduct>
}

/** 工作台概览（G12 Dashboard 首批指标）。 */
export interface AIOverview {
  products: number
  certified: number
  serving: number
  averageOverall: number
  latestMrr: number
  openFeedback: number
}

export async function fetchAIOverview(signal?: AbortSignal): Promise<AIOverview> {
  return parseOrThrow(
    await aiFetch('/v1/ai-data-products/overview', {}, signal),
    '工作台概览读取失败',
  ) as Promise<AIOverview>
}

export interface AIEvaluationFeedbackItem {
  id: string
  productId: string
  versionSn: string
  question: string
  metric: string
  outcome: string
  feedbackType: string
  detail: string | null
  status: 'CREATED' | 'CONSUMED' | 'DISMISSED'
  resolution: string | null
  createdBy: string
  resolvedBy: string | null
  createdAt: string
}

export async function fetchFeedback(id: string, signal?: AbortSignal): Promise<AIEvaluationFeedbackItem[]> {
  const payload = await parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/feedback`, {}, signal),
    '反馈队列读取失败',
  )
  return Array.isArray(payload) ? payload : []
}

export async function submitFeedback(id: string, body: {
  question: string; metric?: string; outcome?: string; feedbackType?: string; detail?: string
}): Promise<AIEvaluationFeedbackItem> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/feedback`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    '反馈提交失败',
  ) as Promise<AIEvaluationFeedbackItem>
}

export async function resolveFeedback(feedbackId: string, consume: boolean, resolution: string): Promise<AIEvaluationFeedbackItem> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/feedback/${encodeURIComponent(feedbackId)}/resolve`, {
      method: 'POST', body: JSON.stringify({ consume, resolution }),
    }),
    '反馈处置失败',
  ) as Promise<AIEvaluationFeedbackItem>
}

/** RAG 评测报告（G11：五指标）。引擎 /evaluate 返回 snake_case 原文
 *  （evaluation 模块）；入库的 evaluation 段同此拼写。 */
export interface AIReadyEvaluationReport {
  product: string
  version: string
  eval_set_size: number
  retrieval_recall_at_5: number
  precision_at_5: number
  mrr: number
  citation_correctness: number
  faithfulness: number
}

export interface AICertificationRequest {
  id: string
  productId: string
  versionSn: string
  readinessOverall: number
  certification: string
  decision: 'PENDING' | 'APPROVED' | 'REJECTED'
  decisionNote: string | null
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

export async function fetchCertificationRequests(id: string, signal?: AbortSignal): Promise<AICertificationRequest[]> {
  const payload = await parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/certification-requests`, {}, signal),
    '认证审批历史读取失败',
  )
  return Array.isArray(payload) ? payload : []
}

export async function submitCertification(id: string): Promise<AICertificationRequest> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/certification-requests`, {
      method: 'POST', body: JSON.stringify({}),
    }),
    '认证审批提交失败',
  ) as Promise<AICertificationRequest>
}

export async function decideCertification(requestId: string, approve: boolean, note: string): Promise<{ productId: string; lifecycle: string }> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/certification-requests/${encodeURIComponent(requestId)}/decision`, {
      method: 'POST', body: JSON.stringify({ approve, note }),
    }),
    '审批失败',
  ) as Promise<{ productId: string; lifecycle: string }>
}

export async function evaluateAIDataProduct(id: string): Promise<AIReadyEvaluationReport> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/evaluate`, {
      method: 'POST', body: JSON.stringify({}),
    }),
    '评测执行失败',
  ) as Promise<AIReadyEvaluationReport>
}

/** build 返回评估摘要（G9：完整报告在版本 readiness_json）。 */
export interface AIReadyBuildSummary {
  product: string
  version: string
  profile: string
  overall: number
  certification: string
  assessedAt: string
}

export async function buildAIDataProduct(id: string, recipeRef?: string): Promise<AIReadyBuildSummary> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/build`, {
      method: 'POST',
      body: JSON.stringify({ recipeRef: recipeRef ?? null }),
    }),
    '评估执行失败',
  ) as Promise<AIReadyBuildSummary>
}

/** 生命周期主链：DRAFT → CURATED → ASSESSED → CERTIFIED → SERVING（终态 DEPRECATED 另算）。 */
export const lifecycleMainChain: AIDataProductLifecycle[] = ['DRAFT', 'CURATED', 'ASSESSED', 'CERTIFIED', 'SERVING']

export function nextLifecycleTarget(current: AIDataProductLifecycle): AIDataProductLifecycle | null {
  const index = lifecycleMainChain.indexOf(current)
  if (index < 0 || index >= lifecycleMainChain.length - 1) return null
  return lifecycleMainChain[index + 1]
}

/** 产品类型中文口径（CONTEXT.md「AI Ready Data」）。 */
export const productTypeLabel: Record<AIDataProductType, string> = {
  RAG_CORPUS: 'RAG 语料库',
  TRAINING_DATASET: '训练数据集',
  INSTRUCTION_DATASET: '指令数据集',
  PREFERENCE_DATASET: '偏好数据集',
  FEATURE_DATASET: '特征数据集',
  AGENT_CONTEXT: '智能体上下文',
  EVALUATION_DATASET: '评测数据集',
  MULTIMODAL_DATASET: '多模态数据集',
}

/** 生命周期中文口径。 */
export const lifecycleLabel: Record<AIDataProductLifecycle, string> = {
  DRAFT: '草案',
  CURATED: '已加工',
  ASSESSED: '已评估',
  CERTIFIED: '已认证',
  SERVING: '服务中',
  DEPRECATED: '已弃用',
}

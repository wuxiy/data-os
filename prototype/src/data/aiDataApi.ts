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

export interface AIDataProductVersion {
  id: string
  productId: string
  versionSn: string
  recipeRef: string | null
  gitCommit: string | null
  snapshotAt: string | null
  readinessJson: string | null
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
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}`, {}, signal),
    'AI Data 产品详情读取失败',
  ) as Promise<AIDataProductDetail>
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

export async function buildAIDataProduct(id: string, recipeRef?: string): Promise<{ runId: string }> {
  return parseOrThrow(
    await aiFetch(`/v1/ai-data-products/${encodeURIComponent(id)}/build`, {
      method: 'POST',
      body: JSON.stringify({ recipeRef: recipeRef ?? null }),
    }),
    '构建登记失败',
  ) as Promise<{ runId: string }>
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

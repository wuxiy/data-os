import { fetchJson, parseJsonOrThrow, portalFetch } from './http'

/**
 * 受控智能问数（G26）API 客户端：已验证问题清单 / 提问（拒答也走统一信封）/
 * 反馈（回写审计行）。回答只可能来自已发布数据服务的受限执行，真实构建
 * 不存在演示答案回退。
 */

export interface AssistantParamContract {
  name: string
  type: 'date' | 'number' | 'boolean' | 'string' | string
  required?: boolean
  defaultValue?: string
  values?: string[]
  description?: string
}

export interface AssistantQuestionView {
  code: string
  question: string
  aliases: string[]
  paramSchema: AssistantParamContract[]
  serviceCode: string
}

export interface AssistantEvidence {
  serviceCode: string
  serviceVersion: string
  statisticsWindow: Record<string, unknown>
  rowCount: number
  truncated: boolean
  elapsedMs: number
  executedAt: string
  executionPath: string
}

/** 回答信封：answered=false 即拒答（outcome + reason + 可问清单）。 */
export interface AssistantAnswer {
  answered: boolean
  auditId: string
  question?: AssistantQuestionView
  answer?: string
  columns?: string[]
  rows?: unknown[][]
  rowCount?: number
  truncated?: boolean
  evidence?: AssistantEvidence
  outcome?: string
  reason?: string
  supportedQuestions?: string[]
}

export const REFUSAL_LABEL: Record<string, string> = {
  REFUSED_NO_MATCH: '没有匹配的已验证问题',
  REFUSED_PARAM_INVALID: '参数不满足问题口径',
  REFUSED_FORBIDDEN: '无权访问该口径',
  REFUSED_SERVICE_OFFLINE: '数据服务已下线',
  REFUSED_RATE_LIMITED: '问数限流中',
  REFUSED_UNAVAILABLE: '问数执行面暂不可用',
}

export async function fetchAssistantQuestions(signal: AbortSignal | undefined): Promise<AssistantQuestionView[]> {
  const payload = await fetchJson<{ questions: AssistantQuestionView[] }>('/v1/assistant/questions', signal, '问数问题清单读取失败')
  return payload.questions ?? []
}

export async function askAssistantQuery(text: string, parameters: Record<string, string | number | boolean>): Promise<AssistantAnswer> {
  const response = await portalFetch('/v1/assistant/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, parameters }),
  })
  return parseJsonOrThrow(response, '问数提问失败') as Promise<AssistantAnswer>
}

export async function submitAssistantFeedback(auditId: string, rating: 'helpful' | 'not_helpful', note = ''): Promise<{ recorded: boolean }> {
  const response = await portalFetch('/v1/assistant/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auditId, rating, note }),
  })
  return parseJsonOrThrow(response, '反馈提交失败') as Promise<{ recorded: boolean }>
}

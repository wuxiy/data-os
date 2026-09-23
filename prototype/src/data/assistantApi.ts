import { fetchJson, parseJsonOrThrow, portalFetch, throwHttpError } from './http'

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

// ---- 治理面（G27）：问题生命周期管理 ----

/** 治理列表项（全状态；verified=最近成功试运行晚于最后编辑，即可发布）。 */
export interface AssistantAdminQuestionView {
  code: string
  question: string
  aliases: string[]
  paramSchema: AssistantParamContract[]
  serviceCode: string
  answerTemplate: string
  status: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED' | string
  createdBy: string
  createdAt: string
  updatedAt: string
  lastPassedTestRun: string | null
  verified: boolean
}

export interface AssistantQuestionEventView {
  action: string
  actor: string
  detail: string
  createdAt: string
}

/** 审计行视图（管理面只读；不含结果数据——审计本就不存结果行）。 */
export interface AssistantAuditView {
  id: string
  createdAt: string
  userId: string
  institutionId: string
  questionText: string
  questionCode: string
  serviceCode: string
  outcome: string
  rowCount: number
  elapsedMs: number
  detail: string
  feedbackRating: string | null
  feedbackNote: string | null
}

export const AUDIT_OUTCOME_OPTIONS = [
  { value: '', label: '全部结局' },
  { value: 'ANSWERED', label: '已回答' },
  { value: 'REFUSED_NO_MATCH', label: '拒答·无匹配' },
  { value: 'REFUSED_PARAM_INVALID', label: '拒答·参数不合法' },
  { value: 'REFUSED_FORBIDDEN', label: '拒答·越权' },
  { value: 'REFUSED_SERVICE_OFFLINE', label: '拒答·服务下线' },
  { value: 'REFUSED_RATE_LIMITED', label: '拒答·限流' },
  { value: 'REFUSED_UNAVAILABLE', label: '拒答·执行面不可用' },
]

/** 问题草稿（新建/编辑共用；code 唯一且不可改）。 */
export interface AssistantQuestionDraft {
  code: string
  question: string
  aliases: string[]
  paramSchema: AssistantParamContract[]
  serviceCode: string
  answerTemplate: string
}

export const QUESTION_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  DEPRECATED: '已停用',
}

export async function fetchAssistantAdminQuestions(signal: AbortSignal | undefined): Promise<AssistantAdminQuestionView[]> {
  const payload = await fetchJson<{ questions: AssistantAdminQuestionView[] }>('/v1/assistant/admin/questions', signal, '问数治理清单读取失败')
  return payload.questions ?? []
}

export async function saveAssistantQuestion(draft: AssistantQuestionDraft, code?: string): Promise<{ code: string; status: string }> {
  const response = await portalFetch(code ? `/v1/assistant/admin/questions/${encodeURIComponent(code)}` : '/v1/assistant/admin/questions', {
    method: code ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  })
  return parseJsonOrThrow(response, '问题保存失败') as Promise<{ code: string; status: string }>
}

export async function testAssistantQuestion(code: string, parameters: Record<string, string | number | boolean>): Promise<AssistantAnswer> {
  const response = await portalFetch(`/v1/assistant/admin/questions/${encodeURIComponent(code)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parameters }),
  })
  return parseJsonOrThrow(response, '试运行失败') as Promise<AssistantAnswer>
}

export async function assistantQuestionAction(code: string, action: 'publish' | 'deprecate' | 'reopen'): Promise<{ code: string; status: string }> {
  const response = await portalFetch(`/v1/assistant/admin/questions/${encodeURIComponent(code)}/${action}`, { method: 'POST' })
  return parseJsonOrThrow(response, '问题状态变更失败') as Promise<{ code: string; status: string }>
}

export async function deleteAssistantQuestion(code: string): Promise<{ deleted: boolean }> {
  const response = await portalFetch(`/v1/assistant/admin/questions/${encodeURIComponent(code)}`, { method: 'DELETE' })
  return parseJsonOrThrow(response, '问题删除失败') as Promise<{ deleted: boolean }>
}

export async function fetchAssistantQuestionEvents(code: string, signal: AbortSignal | undefined): Promise<{ total: number; returned: number; events: AssistantQuestionEventView[] }> {
  const payload = await fetchJson<{ total: number; returned: number; events: AssistantQuestionEventView[] }>(`/v1/assistant/admin/questions/${encodeURIComponent(code)}/events`, signal, '问题事件读取失败')
  return { total: payload.total ?? 0, returned: payload.returned ?? 0, events: payload.events ?? [] }
}

export async function fetchAssistantAudits(outcome: string, page: number, pageSize: number, signal: AbortSignal | undefined): Promise<{ total: number; audits: AssistantAuditView[] }> {
  const query = `?outcome=${encodeURIComponent(outcome)}&page=${page}&pageSize=${pageSize}`
  const payload = await fetchJson<{ total: number; audits: AssistantAuditView[] }>(`/v1/assistant/admin/audits${query}`, signal, '问数审计读取失败')
  return { total: payload.total ?? 0, audits: payload.audits ?? [] }
}

export async function downloadAssistantAuditCsv(outcome: string): Promise<void> {
  const response = await portalFetch(`/v1/assistant/admin/audits/export?outcome=${encodeURIComponent(outcome)}`)
  if (!response.ok) await throwHttpError(response, '审计导出失败')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'assistant-audits.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

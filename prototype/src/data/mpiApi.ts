import { getAccessToken } from './oidc'

/**
 * MPI 服务 API 客户端。`/api/v1/mpi/**` 由 nginx 直达 mpi-service
 * （不经控制面），认证口径与控制面一致（OIDC token 可选注入）。
 */

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

export interface MpiIdentityView {
  identity: string
  institution: string
  sourceSystem: string
  patientId: string
  cardNo: string
  name: string
  gender: string
  age: string
}

export interface MpiCandidateItem {
  taskId: string
  pairId: number
  status: string
  createdAt: string
  ruleId: string
  outcome: string
  identityA: MpiIdentityView
  identityB: MpiIdentityView
  evidence: string
}

export interface MpiCandidatesResponse {
  total: number
  page: number
  size: number
  items: MpiCandidateItem[]
}

export interface MpiMetrics {
  identitiesLoaded: number
  goldenPersons: number
  autoMatches: number
  reviewPending: number
  reviewResolved: number
}

export interface MpiRebuildResponse {
  identitiesLoaded: number
  identitiesSkipped: number
  candidatePairs: number
  blocking: { B3: number; B4: number; B6: number }
  outcomes: { autoMatch: number; review: number; noMatch: number; hardConflict: number }
}

export interface MpiPersonLinkView {
  SOURCE_IDENTIFIER: string
  DECISION_SOURCE: string
  LINK_STATUS: string
  VALID_FROM: string
}

export interface MpiAuditHistoryItem {
  ACTION: string
  ACTOR: string
  DETAIL: string
  CREATED_AT: string
}

export interface MpiPersonDetail {
  id: string
  goldenName: string
  goldenGender: string
  status: string
  createdAt: string
  links: MpiPersonLinkView[]
  history: MpiAuditHistoryItem[]
}

export interface MpiDecisionResponse {
  taskId: string
  resolution: 'SAME_PERSON' | 'DIFFERENT_PERSON'
  mergedPersonId: string
}

export class MpiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MpiError'
    this.status = status
  }
}

async function mpiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE_URL}/v1/mpi${path}`, { ...init, headers })
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
  }
  return response
}

async function parseOrThrow(response: Response, prefix: string): Promise<unknown> {
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json() as { message?: string }
      detail = payload.message ?? ''
    } catch {
      // 上游未返回 JSON 时保留 HTTP 状态。
    }
    throw new MpiError(`${prefix}${detail ? `：${detail}` : ''}（HTTP ${response.status}）`, response.status)
  }
  return response.json()
}

export async function fetchMpiMetrics(signal?: AbortSignal): Promise<MpiMetrics> {
  return parseOrThrow(await mpiFetch('/metrics', { signal }), 'MPI 指标读取失败') as Promise<MpiMetrics>
}

export async function fetchMpiCandidates(options: { status?: string; page?: number; size?: number } = {}, signal?: AbortSignal): Promise<MpiCandidatesResponse> {
  const params = new URLSearchParams()
  params.set('status', options.status ?? 'OPEN')
  params.set('page', String(options.page ?? 1))
  params.set('size', String(options.size ?? 50))
  return parseOrThrow(await mpiFetch(`/candidates?${params.toString()}`, { signal }), '候选队列读取失败') as Promise<MpiCandidatesResponse>
}

export async function fetchMpiPerson(personId: string, signal?: AbortSignal): Promise<MpiPersonDetail> {
  return parseOrThrow(await mpiFetch(`/persons/${encodeURIComponent(personId)}`, { signal }), '黄金人详情读取失败') as Promise<MpiPersonDetail>
}

export async function decideMpiTask(taskId: string, resolution: 'SAME_PERSON' | 'DIFFERENT_PERSON', reason: string): Promise<MpiDecisionResponse> {
  return parseOrThrow(await mpiFetch(`/links/${encodeURIComponent(taskId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ resolution, reason }),
  }), '复核决策提交失败') as Promise<MpiDecisionResponse>
}

export async function rebuildMpi(): Promise<MpiRebuildResponse> {
  return parseOrThrow(await mpiFetch('/rebuild', { method: 'POST' }), '主索引重算失败') as Promise<MpiRebuildResponse>
}

export async function splitMpiPerson(personId: string, identityGroup: string, reason: string): Promise<{ personId: string; newPersonId: string; splitIdentity: string }> {
  return parseOrThrow(await mpiFetch(`/persons/${encodeURIComponent(personId)}/split`, {
    method: 'POST',
    body: JSON.stringify({ identityGroup, reason }),
  }), '身份拆分失败') as Promise<{ personId: string; newPersonId: string; splitIdentity: string }>
}

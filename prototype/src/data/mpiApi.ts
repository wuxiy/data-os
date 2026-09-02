import { parseJsonOrThrow, portalFetch } from './http'

/**
 * MPI 服务 API 客户端。`/api/v1/mpi/**` 由 nginx 直达 mpi-service
 * （不经控制面），认证口径与控制面一致（传输层见 http.ts）。
 */

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

/** 匹配证据项（服务端已掩码；G14 影子评分的 v2Score 亦走此通道）。 */
export interface MpiEvidenceItem {
  field: string
  valueA: string
  valueB: string
  match: boolean
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
  /** 边界投影：原文 JSON 串不出 API client。 */
  evidence: MpiEvidenceItem[]
}

function parseEvidence(raw: string): MpiEvidenceItem[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as MpiEvidenceItem[] : []
  } catch {
    return []
  }
}

/** 召回/判定规则中文口径（CONTEXT.md「患者主索引」）。 */
export const mpiRuleLabel: Record<string, string> = {
  'M-ep1': '同机构同主键同人',
  'M-ep2': '同卡同人（自动合并）',
  'P-ep1': '卡号复用冲突',
  'P-ep2': '同名同性别待核',
  'H-ep1': '人工已判不同人',
  'H-ep2': '人工已拆分',
  'P-fallback': '弱证据待核',
}

/** 证据字段中文口径（G14 影子评分：valueA=分数(bit)、valueB=V2 三态）。 */
export const mpiEvidenceFieldLabel: Record<string, string> = {
  institution: '机构',
  patientId: '患者主键',
  cardNo: '卡号',
  name: '姓名',
  gender: '性别',
  contact: '联系方式',
  v2Score: 'V2 影子评分',
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
  sourceIdentifier: string
  decisionSource: string
  linkStatus: string
  validFrom: string
}

export interface MpiAuditHistoryItem {
  action: string
  actor: string
  detail: string
  createdAt: string
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

async function mpiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return portalFetch(`/v1/mpi${path}`, init)
}

export async function fetchMpiMetrics(signal?: AbortSignal): Promise<MpiMetrics> {
  return parseJsonOrThrow(await mpiFetch('/metrics', { signal }), 'MPI 指标读取失败') as Promise<MpiMetrics>
}

export async function fetchMpiCandidates(options: { status?: string; page?: number; size?: number } = {}, signal?: AbortSignal): Promise<MpiCandidatesResponse> {
  const params = new URLSearchParams()
  params.set('status', options.status ?? 'OPEN')
  params.set('page', String(options.page ?? 1))
  params.set('size', String(options.size ?? 50))
  const payload = await parseJsonOrThrow(
    await mpiFetch(`/candidates?${params.toString()}`, { signal }),
    '候选队列读取失败',
  ) as { total: number; page: number; size: number; items: Array<Omit<MpiCandidateItem, 'evidence'> & { evidence: string }> }
  // 边界投影：evidence 的 JSON 原文在此解析，页面只拿结构化数组。
  return { ...payload, items: payload.items.map(({ evidence, ...rest }) => ({ ...rest, evidence: parseEvidence(evidence) })) }
}

export async function fetchMpiPerson(personId: string, signal?: AbortSignal): Promise<MpiPersonDetail> {
  return parseJsonOrThrow(await mpiFetch(`/persons/${encodeURIComponent(personId)}`, { signal }), '黄金人详情读取失败') as Promise<MpiPersonDetail>
}

export async function decideMpiTask(taskId: string, resolution: 'SAME_PERSON' | 'DIFFERENT_PERSON', reason: string): Promise<MpiDecisionResponse> {
  return parseJsonOrThrow(await mpiFetch(`/links/${encodeURIComponent(taskId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ resolution, reason }),
  }), '复核决策提交失败') as Promise<MpiDecisionResponse>
}

export async function rebuildMpi(): Promise<MpiRebuildResponse> {
  return parseJsonOrThrow(await mpiFetch('/rebuild', { method: 'POST' }), '主索引重算失败') as Promise<MpiRebuildResponse>
}

export async function splitMpiPerson(personId: string, identityGroup: string, reason: string): Promise<{ personId: string; newPersonId: string; splitIdentity: string }> {
  return parseJsonOrThrow(await mpiFetch(`/persons/${encodeURIComponent(personId)}/split`, {
    method: 'POST',
    body: JSON.stringify({ identityGroup, reason }),
  }), '身份拆分失败') as Promise<{ personId: string; newPersonId: string; splitIdentity: string }>
}

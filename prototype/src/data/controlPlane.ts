import { getAccessToken } from './oidc'

export interface GovernanceApiMetric {
  key: string
  label: string
  value: number
  unit: string
  target: number | null
  detail: string
  tone: 'healthy' | 'warning' | 'danger' | 'neutral'
}

export interface GovernanceApiIssue {
  id: string
  title: string
  severity: string
  status: string
  datasetId: string
  ruleId: string
  ownerDepartment: string
  ownerName: string
  ticketId: string
  impact: string
  dueAt: string | null
  objectLabel?: string
  processingNote?: string | null
  updatedAt?: string | null
  lastActionAt?: string | null
  lastAction?: string | null
  slaOverdueAt?: string | null
}

export interface GovernanceApiSummary {
  asOf: string
  tenantId: string
  institutionId: string
  metrics: GovernanceApiMetric[]
  issues: GovernanceApiIssue[]
}

export interface GovernanceIssueEventApiItem {
  id: string
  issueId: string
  eventType: string
  note: string
  actor: string
  createdAt: string
}

export interface GovernanceQualityRunApiItem {
  id: string
  issueId: string
  tenantId: string
  institutionId: string
  ruleId: string
  datasetId: string
  executor: string
  status: string
  externalId: string | null
  executionBatchId: string
  passed: boolean | null
  resultMessage: string | null
  sampleEvidence: Array<Record<string, unknown>>
  artifactUri: string | null
  reconciliationStatus: string | null
  reconciliationMessage: string | null
  submittedAt: string
  startedAt: string | null
  finishedAt: string | null
  attemptCount: number
  nextPollAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface GovernanceNotificationApiItem {
  id: string
  issueId: string
  eventId: string | null
  channel: string
  recipient: string
  subject: string
  body: string
  status: string
  idempotencyKey: string
  attemptCount: number
  lastError: string | null
  nextAttemptAt: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GovernanceIssueDetailApiResponse {
  issue: GovernanceApiIssue
  events: GovernanceIssueEventApiItem[]
  latestRun: GovernanceQualityRunApiItem | null
  runs: GovernanceQualityRunApiItem[]
  notifications: GovernanceNotificationApiItem[]
}

export interface GovernanceIssueListApiResponse {
  items: GovernanceApiIssue[]
  total: number
}

export interface RuntimeStatusApiResponse {
  mode: 'LIVE' | 'DEMO'
  seedDemoEnabled: boolean
  qualityExecutor: string
  qualityExecutorConfigured: boolean
  demoQualityExecutorEnabled: boolean
  seatunnelConfigured: boolean
  notificationConfigured: boolean
  warnings: string[]
}

export type PlatformServiceStatus = 'UP' | 'DOWN' | 'NOT_CONFIGURED'

export interface PlatformServiceApiItem {
  key: 'seatunnel' | 'dolphinscheduler' | 'rustfs'
  name: string
  role: string
  status: PlatformServiceStatus
  description: string
  checkedAt: string
  detail: string
  uiUrl: string | null
  metrics: Record<string, string>
}

export interface PlatformOperationsApiResponse {
  technicalAccess: boolean
  checkedAt: string
  services: PlatformServiceApiItem[]
}

export interface SourceApiItem {
  id: string
  tenantId: string
  institutionId: string
  name: string
  systemType: string
  protocol: string
  status: string
  createdAt: string
  lastCheckedAt: string | null
  lastCheckMessage: string | null
}

export interface IngestionJobApiItem {
  id: string
  sourceId: string
  name: string
  mode: string
  executor: string
  status: string
  createdAt: string
  latestRunStatus: string | null
  lastRunAt: string | null
  templateKey: string | null
  templateVersion: number | null
  configured: boolean
}

export type JobConfig = Record<string, unknown>

export interface IngestionJobConfigApiItem {
  jobId: string
  templateKey: string
  templateVersion: number
  config: JobConfig
  updatedAt: string
}

export interface CreateIngestionJobInput {
  sourceId: string
  name: string
  mode: string
  executor: string
  templateKey: string
  templateVersion: number
  config: JobConfig
}

export interface IngestionRunApiItem {
  id: string
  jobId: string
  status: string
  executor: string
  externalId: string | null
  message: string
  reconciliationStatus: string | null
  reconciliationMessage: string | null
  submittedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface IngestionRunListApiResponse {
  items: IngestionRunApiItem[]
  total: number
}

export interface WorkflowTemplateApiItem {
  key: string
  version: number
  displayName: string
  systemType: string
  protocol: string
  executor: string
  mode: string
  description: string
  requiredCredentialRoles: string[]
  sampleConfig: JobConfig
}

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
  }
  return response
}

export class ControlPlaneError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ControlPlaneError'
    this.status = status
  }
}

async function responseError(response: Response, prefix: string): Promise<never> {
  let detail = ''
  try {
    const payload = await response.json() as { message?: string; detail?: string }
    detail = payload.message ?? payload.detail ?? ''
  } catch {
    // Keep the HTTP status when the upstream did not return JSON.
  }
  throw new ControlPlaneError(`${prefix}${detail ? `：${detail}` : ''}（HTTP ${response.status}）`, response.status)
}

export async function fetchGovernanceSummary(signal?: AbortSignal): Promise<GovernanceApiSummary> {
  const response = await apiFetch('/v1/governance/summary', { signal })
  if (!response.ok) {
    throw new Error(`治理摘要请求失败：${response.status}`)
  }
  return response.json() as Promise<GovernanceApiSummary>
}

export async function fetchRuntimeStatus(signal?: AbortSignal): Promise<RuntimeStatusApiResponse> {
  return getJson('/v1/system/status', signal)
}

export async function fetchPlatformOperations(signal?: AbortSignal): Promise<PlatformOperationsApiResponse> {
  return getJson('/v1/platform-operations', signal)
}

export async function fetchGovernanceIssues(options: {
  status?: string
  query?: string
  signal?: AbortSignal
} = {}): Promise<GovernanceIssueListApiResponse> {
  const params = new URLSearchParams()
  if (options.status) params.set('status', options.status)
  if (options.query) params.set('query', options.query)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return getJson(`/v1/governance/issues${suffix}`, options.signal)
}

export async function fetchGovernanceIssue(issueId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  return getJson(`/v1/governance/issues/${encodeURIComponent(issueId)}`, signal)
}

export async function updateGovernanceIssueWorkflow(issueId: string, input: {
  status: string
  note: string
}, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await apiFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/workflow`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await responseError(response, '治理问题更新失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function requestGovernanceIssueRecheck(issueId: string, note?: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await apiFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/recheck`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { note } : {}),
    signal,
  })
  if (!response.ok) await responseError(response, '治理问题复检请求失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function syncGovernanceIssueRun(issueId: string, runId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await apiFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/runs/${encodeURIComponent(runId)}/sync`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '质量复检结果同步失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function reconcileGovernanceIssueRun(issueId: string, runId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await apiFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/runs/${encodeURIComponent(runId)}/reconcile`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '质量执行批次重新对账失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function confirmGovernanceIssueRunAbsent(issueId: string, runId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await apiFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/runs/${encodeURIComponent(runId)}/reconcile/confirm-absent`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '确认质量执行批次不存在失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function remindGovernanceIssueOwner(issueId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `reminder-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const response = await apiFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/notifications/remind`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Idempotency-Key': idempotencyKey },
    signal,
  })
  if (!response.ok) await responseError(response, '责任人提醒请求失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(path, { signal })
  if (!response.ok) await responseError(response, '控制面请求失败')
  return response.json() as Promise<T>
}

export async function fetchSources(signal?: AbortSignal): Promise<{ items: SourceApiItem[]; total: number }> {
  return getJson('/v1/sources', signal)
}

export async function fetchIngestionJobs(signal?: AbortSignal): Promise<{ items: IngestionJobApiItem[]; total: number }> {
  return getJson('/v1/jobs', signal)
}

export async function fetchWorkflowTemplates(signal?: AbortSignal): Promise<WorkflowTemplateApiItem[]> {
  return getJson('/v1/workflow-templates', signal)
}

export async function createSource(input: {
  name: string
  systemType: string
  protocol: string
}, signal?: AbortSignal): Promise<SourceApiItem> {
  const response = await apiFetch('/v1/sources', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await responseError(response, '数据源创建失败')
  return response.json() as Promise<SourceApiItem>
}

export async function checkSource(sourceId: string, config: JobConfig, signal?: AbortSignal): Promise<SourceApiItem> {
  const response = await apiFetch(`/v1/sources/${sourceId}/check`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
    signal,
  })
  if (!response.ok) await responseError(response, '数据源检查失败')
  return response.json() as Promise<SourceApiItem>
}

export async function createIngestionJob(input: CreateIngestionJobInput, signal?: AbortSignal): Promise<IngestionJobApiItem> {
  const response = await apiFetch('/v1/jobs', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await responseError(response, '采集任务创建失败')
  return response.json() as Promise<IngestionJobApiItem>
}

export async function updateIngestionJobStatus(jobId: string, status: string, signal?: AbortSignal): Promise<IngestionJobApiItem> {
  const response = await apiFetch(`/v1/jobs/${jobId}/status`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  })
  if (!response.ok) await responseError(response, '任务状态更新失败')
  return response.json() as Promise<IngestionJobApiItem>
}

export async function fetchJobConfig(jobId: string, signal?: AbortSignal): Promise<IngestionJobConfigApiItem> {
  return getJson(`/v1/jobs/${jobId}/config`, signal)
}

export async function saveJobConfig(jobId: string, input: {
  templateKey: string
  templateVersion: number
  config: JobConfig
}, signal?: AbortSignal): Promise<IngestionJobConfigApiItem> {
  const response = await apiFetch(`/v1/jobs/${jobId}/config`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await responseError(response, '采集任务配置保存失败')
  return response.json() as Promise<IngestionJobConfigApiItem>
}

export async function startIngestionRun(jobId: string, options: {
  signal?: AbortSignal
  idempotencyKey?: string
  config?: JobConfig
} = {}): Promise<IngestionRunApiItem> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  const response = await apiFetch(`/v1/jobs/${jobId}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ config: options.config ?? {} }),
    signal: options.signal,
  })
  if (!response.ok) await responseError(response, '运行请求失败')
  return response.json() as Promise<IngestionRunApiItem>
}

export async function fetchIngestionRuns(jobId: string, signal?: AbortSignal): Promise<IngestionRunListApiResponse> {
  return getJson(`/v1/jobs/${jobId}/runs`, signal)
}

export async function syncIngestionRun(jobId: string, runId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await apiFetch(`/v1/jobs/${jobId}/runs/${runId}/sync`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '运行状态同步失败')
  return response.json() as Promise<IngestionRunApiItem>
}

export async function confirmIngestionRunAbsent(jobId: string, runId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await apiFetch(`/v1/jobs/${jobId}/runs/${runId}/reconcile/confirm-absent`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '确认外部运行不存在失败')
  return response.json() as Promise<IngestionRunApiItem>
}

export async function retryIngestionRun(jobId: string, runId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await apiFetch(`/v1/jobs/${jobId}/runs/${runId}/retry`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '运行重试失败')
  return response.json() as Promise<IngestionRunApiItem>
}

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

export interface GovernanceIssueDetailApiResponse {
  issue: GovernanceApiIssue
  events: GovernanceIssueEventApiItem[]
}

export interface GovernanceIssueListApiResponse {
  items: GovernanceApiIssue[]
  total: number
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
  submittedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface IngestionRunListApiResponse {
  items: IngestionRunApiItem[]
  total: number
}

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

class ControlPlaneError extends Error {
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
  const response = await fetch(`${API_BASE_URL}/v1/governance/summary`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(`治理摘要请求失败：${response.status}`)
  }
  return response.json() as Promise<GovernanceApiSummary>
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
  const response = await fetch(`${API_BASE_URL}/v1/governance/issues/${encodeURIComponent(issueId)}/workflow`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await responseError(response, '治理问题更新失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function requestGovernanceIssueRecheck(issueId: string, note?: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/governance/issues/${encodeURIComponent(issueId)}/recheck`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { note } : {}),
    signal,
  })
  if (!response.ok) await responseError(response, '治理问题复检请求失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '控制面请求失败')
  return response.json() as Promise<T>
}

export async function fetchSources(signal?: AbortSignal): Promise<{ items: SourceApiItem[]; total: number }> {
  return getJson('/v1/sources', signal)
}

export async function fetchIngestionJobs(signal?: AbortSignal): Promise<{ items: IngestionJobApiItem[]; total: number }> {
  return getJson('/v1/jobs', signal)
}

export async function createSource(input: {
  name: string
  systemType: string
  protocol: string
}, signal?: AbortSignal): Promise<SourceApiItem> {
  const response = await fetch(`${API_BASE_URL}/v1/sources`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await responseError(response, '数据源创建失败')
  return response.json() as Promise<SourceApiItem>
}

export async function checkSource(sourceId: string, config: JobConfig, signal?: AbortSignal): Promise<SourceApiItem> {
  const response = await fetch(`${API_BASE_URL}/v1/sources/${sourceId}/check`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
    signal,
  })
  if (!response.ok) await responseError(response, '数据源检查失败')
  return response.json() as Promise<SourceApiItem>
}

export async function createIngestionJob(input: CreateIngestionJobInput, signal?: AbortSignal): Promise<IngestionJobApiItem> {
  const response = await fetch(`${API_BASE_URL}/v1/jobs`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await responseError(response, '采集任务创建失败')
  return response.json() as Promise<IngestionJobApiItem>
}

export async function updateIngestionJobStatus(jobId: string, status: string, signal?: AbortSignal): Promise<IngestionJobApiItem> {
  const response = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/status`, {
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
  const response = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/config`, {
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
  const response = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/runs`, {
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
  const response = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/runs/${runId}/sync`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '运行状态同步失败')
  return response.json() as Promise<IngestionRunApiItem>
}

export async function retryIngestionRun(jobId: string, runId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/runs/${runId}/retry`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await responseError(response, '运行重试失败')
  return response.json() as Promise<IngestionRunApiItem>
}

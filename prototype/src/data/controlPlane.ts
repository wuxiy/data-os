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
}

export interface GovernanceApiSummary {
  asOf: string
  tenantId: string
  institutionId: string
  metrics: GovernanceApiMetric[]
  issues: GovernanceApiIssue[]
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
}

export interface IngestionJobApiItem {
  id: string
  sourceId: string
  name: string
  mode: string
  executor: string
  status: string
  createdAt: string
  lastRunAt: string | null
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

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`控制面请求失败：${response.status}`)
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
  if (!response.ok) throw new Error(`数据源创建失败：${response.status}`)
  return response.json() as Promise<SourceApiItem>
}

export async function startIngestionRun(jobId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/runs`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal,
  })
  if (!response.ok) throw new Error(`运行请求失败：${response.status}`)
  return response.json() as Promise<IngestionRunApiItem>
}

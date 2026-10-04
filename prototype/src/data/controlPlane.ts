import { fetchJson, portalFetch, throwHttpError } from './http'

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
  operational: OperationalFactsApiResponse
  warnings: string[]
}

export type OperationalState = 'READY' | 'DEGRADED' | 'UNKNOWN'

export interface OperationalFactsApiResponse {
  state: OperationalState
  ready: number
  degraded: number
  unknown: number
  total: number
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
  operational: OperationalFactsApiResponse
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
  connection: Record<string, unknown> | null
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
  structured: StructuredTaskSpec | null
  lastSuccessWatermark: string | null
}

/** 结构化任务意图（G2G 批次 1 第二刀）：门户只声明表单形态，服务端编译产物。 */
export interface StructuredTaskSpec {
  form: 'TABLE' | 'SQL'
  sourceId: string
  catalog?: string
  tables?: string[]
  columns?: string[]
  orderKey?: string
  mode: 'FULL' | 'INCREMENTAL'
  customSql?: string
  targetDatabase?: string
  targetTable?: string
  sinkFenodes: string
  sinkCredentialRef: string
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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return fetchJson<T>(path, signal, '控制面请求失败')
}

export async function fetchGovernanceSummary(signal?: AbortSignal): Promise<GovernanceApiSummary> {
  const response = await portalFetch('/v1/governance/summary', { signal })
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
  const response = await portalFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/workflow`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '治理问题更新失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function requestGovernanceIssueRecheck(issueId: string, note?: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await portalFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/recheck`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { note } : {}),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '治理问题复检请求失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function syncGovernanceIssueRun(issueId: string, runId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await portalFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/runs/${encodeURIComponent(runId)}/sync`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '质量复检结果同步失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function reconcileGovernanceIssueRun(issueId: string, runId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await portalFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/runs/${encodeURIComponent(runId)}/reconcile`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '质量执行批次重新对账失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function confirmGovernanceIssueRunAbsent(issueId: string, runId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const response = await portalFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/runs/${encodeURIComponent(runId)}/reconcile/confirm-absent`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '确认质量执行批次不存在失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
}

export async function remindGovernanceIssueOwner(issueId: string, signal?: AbortSignal): Promise<GovernanceIssueDetailApiResponse> {
  const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `reminder-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const response = await portalFetch(`/v1/governance/issues/${encodeURIComponent(issueId)}/notifications/remind`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Idempotency-Key': idempotencyKey },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '责任人提醒请求失败')
  return response.json() as Promise<GovernanceIssueDetailApiResponse>
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
  const response = await portalFetch('/v1/sources', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '数据源创建失败')
  return response.json() as Promise<SourceApiItem>
}

export async function checkSource(sourceId: string, config: JobConfig, signal?: AbortSignal): Promise<SourceApiItem> {
  const response = await portalFetch(`/v1/sources/${encodeURIComponent(sourceId)}/check`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '数据源检查失败')
  return response.json() as Promise<SourceApiItem>
}

// —— 数据源浏览与受控查询（G2G 批次 1）——

export interface SourceTableApiItem {
  name: string
  type: string
  remark: string
}

export interface SourceColumnApiItem {
  name: string
  typeName: string
  nullable: boolean
  remark: string
}

export interface SourceQueryResultApiItem {
  columns: string[]
  rows: (string | null)[][]
  truncated: boolean
}

/** 登记非敏感连接配置（jdbcUrl / username / credentialRef）；明文凭据由服务端拒绝。 */
export async function saveSourceConnection(sourceId: string, config: JobConfig, signal?: AbortSignal): Promise<SourceApiItem> {
  const response = await portalFetch(`/v1/sources/${encodeURIComponent(sourceId)}/connection`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '连接登记失败')
  return response.json() as Promise<SourceApiItem>
}

export async function fetchSourceCatalogs(sourceId: string, signal?: AbortSignal): Promise<{ catalogs: string[]; truncated: boolean }> {
  return getJson(`/v1/sources/${encodeURIComponent(sourceId)}/catalogs`, signal)
}

export async function fetchSourceTables(sourceId: string, catalog: string, signal?: AbortSignal): Promise<{ tables: SourceTableApiItem[]; truncated: boolean }> {
  const query = `?catalog=${encodeURIComponent(catalog)}`
  return getJson(`/v1/sources/${encodeURIComponent(sourceId)}/tables${query}`, signal)
}

export async function fetchSourceColumns(sourceId: string, catalog: string, table: string, signal?: AbortSignal): Promise<{ columns: SourceColumnApiItem[] }> {
  const query = `?catalog=${encodeURIComponent(catalog)}&table=${encodeURIComponent(table)}`
  return getJson(`/v1/sources/${encodeURIComponent(sourceId)}/columns${query}`, signal)
}

/** 受控查询：仅单条 SELECT/WITH；行数上限与超时由服务端强制。 */
export async function runSourceQuery(sourceId: string, input: { sql: string; catalog?: string; maxRows?: number }, signal?: AbortSignal): Promise<SourceQueryResultApiItem> {
  const response = await portalFetch(`/v1/sources/${encodeURIComponent(sourceId)}/query`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '查询执行失败')
  return response.json() as Promise<SourceQueryResultApiItem>
}

// —— 动态质量规则管理（G2G 批次 2）——

export type QualityRuleType =
  | 'NOT_NULL' | 'UNIQUE' | 'VAL_SET' | 'VAL_MINMAX' | 'VAL_LEN' | 'STR_REGEX' | 'FK_REF' | 'SQL'
  | 'CROSS_VAL_COMPARE' | 'STAT_VAL_COMPARE' | 'SQL_STAT_VAL' | 'DETAIL_STAT'
  | 'FIELD_LOGIC' | 'UPDATE_TIME' | 'TIME_CONTINUITY'

export interface QualityRuleTypeView {
  type: QualityRuleType
  label: string
  dimension: string
  /** 失败列由编译器派生（门户不提交证据白名单）。 */
  computedEvidence: boolean
}

export interface QualityRuleDefinitionApiItem {
  ruleId: string
  ruleType: QualityRuleType
  datasetId: string
  targetColumn: string
  params: Record<string, unknown>
  evidenceColumns: QualityEvidenceColumn[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface QualityEvidenceColumn {
  name: string
  classification: 'IDENTIFIER' | 'CATEGORY' | 'SAFE' | 'REDACTED'
}

export interface SaveQualityRuleInput {
  ruleType: QualityRuleType
  datasetId: string
  targetColumn: string
  params: Record<string, unknown>
  evidenceColumns: QualityEvidenceColumn[]
}

export async function fetchQualityRuleTypes(signal?: AbortSignal): Promise<QualityRuleTypeView[]> {
  return getJson('/v1/quality/rules/types', signal)
}

export async function fetchQualityRules(signal?: AbortSignal): Promise<{ items: QualityRuleDefinitionApiItem[]; total: number }> {
  return getJson('/v1/quality/rules', signal)
}

export async function saveQualityRule(ruleId: string, input: SaveQualityRuleInput, signal?: AbortSignal): Promise<QualityRuleDefinitionApiItem> {
  const response = await portalFetch(`/v1/quality/rules/${encodeURIComponent(ruleId)}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '质量规则保存失败')
  return response.json() as Promise<QualityRuleDefinitionApiItem>
}

export async function setQualityRuleEnabled(ruleId: string, enabled: boolean, signal?: AbortSignal): Promise<QualityRuleDefinitionApiItem> {
  const action = enabled ? 'enable' : 'disable'
  const response = await portalFetch(`/v1/quality/rules/${encodeURIComponent(ruleId)}/${action}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, enabled ? '规则启用失败' : '规则停用失败')
  return response.json() as Promise<QualityRuleDefinitionApiItem>
}

export async function deleteQualityRule(ruleId: string, signal?: AbortSignal): Promise<void> {
  const response = await portalFetch(`/v1/quality/rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok && response.status !== 404) await throwHttpError(response, '规则删除失败')
}

// —— 质量评分（G2G 批次 3）——

export interface QualityGradeView {
  grade: string
  lowScore: number
}

export interface QualityScoreStandard {
  passScore: number
  weights: Record<string, number>
  grades: QualityGradeView[]
  updatedAt: string
}

export interface QualityDimensionScore {
  dimension: string
  score: number
  ruleCount: number
}

export interface QualityRuleScoreItem {
  ruleId: string
  datasetId: string
  score: number | null
  passed: boolean | null
}

export interface QualityScoreSummary {
  standard: QualityScoreStandard
  dimensions: QualityDimensionScore[]
  totalScore: number | null
  grade: string | null
  rules: QualityRuleScoreItem[]
}

export async function fetchQualityScore(signal?: AbortSignal): Promise<QualityScoreSummary> {
  return getJson('/v1/quality/score', signal)
}

export async function updateQualityScoreStandard(input: {
  passScore?: number
  weights?: Record<string, number>
  grades?: QualityGradeView[]
}, signal?: AbortSignal): Promise<QualityScoreStandard> {
  const response = await portalFetch('/v1/quality/score/standard', {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '评分标准更新失败')
  return response.json() as Promise<QualityScoreStandard>
}

// —— 前置机节点（G2G 批次 4）——

export interface EdgeNodeApiItem {
  id: string
  name: string
  groupName: string
  site: string
  host: string
  port: number
  version: string
  lastProbeAt: string | null
  lastProbeOk: boolean | null
  lastProbeMessage: string | null
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
  state: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
}

export interface SaveEdgeNodeInput {
  name: string
  groupName?: string
  site?: string
  host: string
  port: number
  version?: string
  config?: Record<string, unknown>
}

export async function fetchEdgeNodes(signal?: AbortSignal): Promise<{ items: EdgeNodeApiItem[]; total: number }> {
  return getJson('/v1/edge/nodes', signal)
}

export async function saveEdgeNode(input: SaveEdgeNodeInput, nodeId?: string, signal?: AbortSignal): Promise<EdgeNodeApiItem> {
  const path = nodeId ? `/v1/edge/nodes/${encodeURIComponent(nodeId)}` : '/v1/edge/nodes'
  const response = await portalFetch(path, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '前置机节点保存失败')
  return response.json() as Promise<EdgeNodeApiItem>
}

/** 中心侧 TCP 探测：结果回写为最近一次探测并返回衍生状态。 */
export async function probeEdgeNode(nodeId: string, signal?: AbortSignal): Promise<EdgeNodeApiItem> {
  const response = await portalFetch(`/v1/edge/nodes/${encodeURIComponent(nodeId)}/probe`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '前置机探测失败')
  return response.json() as Promise<EdgeNodeApiItem>
}

export async function deleteEdgeNode(nodeId: string, signal?: AbortSignal): Promise<void> {
  const response = await portalFetch(`/v1/edge/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok && response.status !== 404) await throwHttpError(response, '前置机节点删除失败')
}

export interface EdgeDeploymentApiItem {
  id: string
  nodeId: string
  version: string
  artifactRef: string
  note: string
  deployedBy: string
  deployedAt: string
}

export interface EdgeWatermarkTable {
  key: string
  dataset: string
  totalRows: number
  latestWriteAt: string | null
  dailyCounts: { date: string; count: number }[]
}

export interface EdgeWatermarksApiResponse {
  asOf: string
  tables: EdgeWatermarkTable[]
}

export async function fetchEdgeDeployments(nodeId: string, signal?: AbortSignal): Promise<EdgeDeploymentApiItem[]> {
  return getJson(`/v1/edge/nodes/${encodeURIComponent(nodeId)}/deployments`, signal)
}

export async function recordEdgeDeployment(nodeId: string, input: { version: string; artifactRef?: string; note?: string }, signal?: AbortSignal): Promise<EdgeDeploymentApiItem[]> {
  const response = await portalFetch(`/v1/edge/nodes/${encodeURIComponent(nodeId)}/deployments`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '发布登记失败')
  return response.json() as Promise<EdgeDeploymentApiItem[]>
}

/** 采集水位：代理质量执行器的白名单聚合只读端点（边缘表）。 */
export async function fetchEdgeWatermarks(signal?: AbortSignal): Promise<EdgeWatermarksApiResponse> {
  return getJson('/v1/edge/nodes/watermarks', signal)
}

export async function createIngestionJob(input: CreateIngestionJobInput, signal?: AbortSignal): Promise<IngestionJobApiItem> {
  const response = await portalFetch('/v1/jobs', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '采集任务创建失败')
  return response.json() as Promise<IngestionJobApiItem>
}

export async function updateIngestionJobStatus(jobId: string, status: string, signal?: AbortSignal): Promise<IngestionJobApiItem> {
  const response = await portalFetch(`/v1/jobs/${jobId}/status`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '任务状态更新失败')
  return response.json() as Promise<IngestionJobApiItem>
}

export async function fetchJobConfig(jobId: string, signal?: AbortSignal): Promise<IngestionJobConfigApiItem> {
  return getJson(`/v1/jobs/${encodeURIComponent(jobId)}/config`, signal)
}

export async function saveJobConfig(jobId: string, input: {
  templateKey: string
  templateVersion: number
  config: JobConfig
}, signal?: AbortSignal): Promise<IngestionJobConfigApiItem> {
  const response = await portalFetch(`/v1/jobs/${encodeURIComponent(jobId)}/config`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '采集任务配置保存失败')
  return response.json() as Promise<IngestionJobConfigApiItem>
}

/** 结构化保存：门户只提交表单意图；编译产物由控制面生成并落库。 */
export async function saveStructuredJobConfig(jobId: string, structured: StructuredTaskSpec, signal?: AbortSignal): Promise<IngestionJobConfigApiItem> {
  const response = await portalFetch(`/v1/jobs/${encodeURIComponent(jobId)}/config`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateKey: 'STRUCTURED_JDBC_TO_DORIS', structured }),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '采集任务配置保存失败')
  return response.json() as Promise<IngestionJobConfigApiItem>
}

/** 任务复制：结构化任务重定向目标源重编译；JSON 任务原样复制。 */
export async function copyIngestionJob(jobId: string, input: { sourceId?: string; name?: string }, signal?: AbortSignal): Promise<IngestionJobApiItem> {
  const response = await portalFetch(`/v1/jobs/${encodeURIComponent(jobId)}/copy`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) await throwHttpError(response, '任务复制失败')
  return response.json() as Promise<IngestionJobApiItem>
}

export async function startIngestionRun(jobId: string, options: {
  signal?: AbortSignal
  idempotencyKey?: string
  config?: JobConfig
} = {}): Promise<IngestionRunApiItem> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  const response = await portalFetch(`/v1/jobs/${jobId}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ config: options.config ?? {} }),
    signal: options.signal,
  })
  if (!response.ok) await throwHttpError(response, '运行请求失败')
  return response.json() as Promise<IngestionRunApiItem>
}

export async function fetchIngestionRuns(jobId: string, signal?: AbortSignal): Promise<IngestionRunListApiResponse> {
  return getJson(`/v1/jobs/${jobId}/runs`, signal)
}

export async function syncIngestionRun(jobId: string, runId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await portalFetch(`/v1/jobs/${jobId}/runs/${runId}/sync`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '运行状态同步失败')
  return response.json() as Promise<IngestionRunApiItem>
}

export async function confirmIngestionRunAbsent(jobId: string, runId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await portalFetch(`/v1/jobs/${jobId}/runs/${runId}/reconcile/confirm-absent`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '确认外部运行不存在失败')
  return response.json() as Promise<IngestionRunApiItem>
}

export async function retryIngestionRun(jobId: string, runId: string, signal?: AbortSignal): Promise<IngestionRunApiItem> {
  const response = await portalFetch(`/v1/jobs/${jobId}/runs/${runId}/retry`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) await throwHttpError(response, '运行重试失败')
  return response.json() as Promise<IngestionRunApiItem>
}

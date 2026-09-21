import { fetchJson, portalFetch, throwHttpError } from './http'

/**
 * 数据标准中心（G22）API 客户端：列表/详情/版本生命周期/导入（dry-run 先行）/
 * 对比/影响/FHIR 导出。错误统一走 http 出口（401 广播、业务文案透出）。
 */

export interface StandardLatestVersion {
  versionNo: number
  status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'DEPRECATED'
  syncStatus: string
}

export interface StandardListItem {
  id: string
  code: string
  name: string
  description: string
  owner: string
  updatedAt: string
  versionCount: number
  latestVersion: StandardLatestVersion
}

export interface StandardValueView {
  code: string
  displayName: string
  validFrom: string
  validTo: string
}

export interface StandardElementView {
  id: string
  code: string
  name: string
  dataType: string
  required: boolean
  definition: string
  sensitivity: string
  assetRef: string
  values: StandardValueView[]
}

export interface StandardVersionView {
  id: string
  versionNo: number
  status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'DEPRECATED'
  syncStatus: string
  createdBy: string
  createdAt: string
  submittedAt?: string
  publishedAt?: string
  deprecatedAt?: string
}

export interface StandardEventView {
  id: string
  eventType: string
  actor: string
  detail: string
  createdAt: string
}

export interface StandardDetailView {
  standard: { id: string; code: string; name: string; description: string; owner: string; updatedAt: string }
  versions: StandardVersionView[]
  version: { id: string; versionNo: number; status: StandardVersionView['status']; syncStatus: string; elements: StandardElementView[] }
  events: StandardEventView[]
}

export interface ElementPayload {
  code: string
  name: string
  dataType: string
  required: boolean
  definition: string
  sensitivity: string
  assetRef: string
  values: { code: string; displayName: string; validFrom?: string; validTo?: string }[]
}

export interface StandardCreatePayload {
  code: string
  name: string
  description: string
  owner: string
  elements: ElementPayload[]
}

export interface ImportReport {
  dryRun: boolean
  standardCode: string
  elementCount: number
  valueCount: number
  problems: string[]
  created?: StandardDetailView
}

export interface VersionCompare {
  left: { versionId: string; versionNo: number }
  right: { versionId: string; versionNo: number }
  added: { code: string; name: string; dataType: string; valueCount: number }[]
  removed: { code: string; name: string; dataType: string; valueCount: number }[]
  changed: { code: string; name: string; differences: string[] }[]
}

export interface VersionImpact {
  versionId: string
  versionNo: number
  status: string
  elementCount: number
  referencedAssets: string[]
  notes: string[]
}

export async function fetchStandards(signal: AbortSignal | undefined, query = '', status = ''): Promise<StandardListItem[]> {
  const params = new URLSearchParams()
  if (query.trim()) params.set('query', query.trim())
  if (status.trim()) params.set('status', status.trim())
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const payload = await fetchJson<{ items: StandardListItem[] }>(`/v1/data-standards${suffix}`, signal, '数据标准列表读取失败')
  return payload.items ?? []
}

export async function fetchStandardDetail(signal: AbortSignal | undefined, id: string, versionId = ''): Promise<StandardDetailView> {
  const suffix = versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
  return fetchJson<StandardDetailView>(`/v1/data-standards/${encodeURIComponent(id)}${suffix}`, signal, '数据标准详情读取失败')
}

export async function createStandard(payload: StandardCreatePayload): Promise<StandardDetailView> {
  const response = await portalFetch('/v1/data-standards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await throwHttpError(response, '数据标准创建失败')
  return response.json()
}

export async function createStandardVersion(id: string, baseVersionId = ''): Promise<StandardDetailView> {
  const response = await portalFetch(`/v1/data-standards/${encodeURIComponent(id)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersionId }),
  })
  if (!response.ok) await throwHttpError(response, '标准新版本创建失败')
  return response.json()
}

export async function updateStandardVersion(
  versionId: string,
  payload: { standardName?: string; description?: string; owner?: string; elements?: ElementPayload[] },
): Promise<StandardDetailView> {
  const response = await portalFetch(`/v1/data-standard-versions/${encodeURIComponent(versionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await throwHttpError(response, '标准草稿修改失败')
  return response.json()
}

async function postVersionAction(versionId: string, action: 'submit' | 'publish' | 'deprecate' | 'sync', label: string): Promise<StandardDetailView> {
  const response = await portalFetch(`/v1/data-standard-versions/${encodeURIComponent(versionId)}/${action}`, { method: 'POST' })
  if (!response.ok) await throwHttpError(response, `${label}失败`)
  return response.json()
}

export const submitStandardVersion = (versionId: string) => postVersionAction(versionId, 'submit', '提交评审')
export const publishStandardVersion = (versionId: string) => postVersionAction(versionId, 'publish', '发布')
export const deprecateStandardVersion = (versionId: string) => postVersionAction(versionId, 'deprecate', '停用')
export const retryStandardSync = (versionId: string) => postVersionAction(versionId, 'sync', '术语投影重试')

export async function importStandards(body: string, dryRun: boolean): Promise<ImportReport> {
  const isJson = body.trim().startsWith('{')
  const response = await portalFetch(`/v1/data-standards/import?dryRun=${dryRun}`, {
    method: 'POST',
    headers: { 'Content-Type': isJson ? 'application/json' : 'text/csv' },
    body,
  })
  if (!response.ok) await throwHttpError(response, '标准导入失败')
  return response.json()
}

export async function compareStandardVersions(versionId: string, otherVersionId: string): Promise<VersionCompare> {
  const response = await portalFetch(
    `/v1/data-standard-versions/${encodeURIComponent(versionId)}/compare/${encodeURIComponent(otherVersionId)}`, { method: 'GET' })
  if (!response.ok) await throwHttpError(response, '版本对比失败')
  return response.json()
}

export async function fetchVersionImpact(signal: AbortSignal | undefined, versionId: string): Promise<VersionImpact> {
  return fetchJson<VersionImpact>(`/v1/data-standard-versions/${encodeURIComponent(versionId)}/impact`, signal, '影响范围读取失败')
}

export async function fetchFhirBundle(versionId: string): Promise<Record<string, unknown>> {
  const response = await portalFetch(`/v1/data-standard-versions/${encodeURIComponent(versionId)}/fhir-bundle`, { method: 'GET' })
  if (!response.ok) await throwHttpError(response, 'FHIR 导出失败')
  return response.json()
}

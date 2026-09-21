import { fetchJson, portalFetch, throwHttpError } from './http'

/**
 * 标准映射（G23）API 客户端：映射集/版本生命周期/导入（dry-run 先行）/
 * 聚合验证/生效（checksum 门控）/回退/影响范围/覆盖率投影。
 */

export interface MappingSetActiveVersion {
  versionNo: number
  status: string
  checksum: string
}

export interface MappingSetListItem {
  id: string
  code: string
  name: string
  sourceAsset: string
  dataset: string
  standard: { id: string; code: string; name: string }
  versionCount: number
  activeVersion: MappingSetActiveVersion | Record<string, never>
  updatedAt: string
}

export interface MappingVersionView {
  id: string
  versionNo: number
  status: 'DRAFT' | 'IN_REVIEW' | 'ACTIVE' | 'RETIRED'
  checksum: string
  createdAt: string
}

export interface MappingItemView {
  id: string
  sourceColumn: string
  targetElementCode: string
  transform: 'COPY' | 'TRIM' | 'UPPER' | 'DATE_FORMAT' | 'VALUE_MAP' | string
  transformParam: string
  conclusion: string
  note: string
}

export interface MappingValidationView {
  id: string
  status: 'PASS' | 'WARN' | 'FAIL' | string
  checksum: string
  dataTime: string
  createdAt: string
  result: string
}

export interface MappingDetailView {
  set: MappingSetListItem
  versions: MappingVersionView[]
  version: {
    id: string
    versionNo: number
    status: MappingVersionView['status']
    checksum: string
    items: MappingItemView[]
    validations: MappingValidationView[]
  }
  events: { id: string; eventType: string; actor: string; detail: string; createdAt: string }[]
}

export interface ItemPayload {
  sourceColumn: string
  targetElementCode: string
  transform: string
  transformParam: string
  conclusion?: string
  note?: string
}

export interface MappingCreatePayload {
  code: string
  name: string
  sourceAsset: string
  dataset: string
  standardId: string
  items: ItemPayload[]
}

export interface ImportReport {
  dryRun: boolean
  itemCount: number
  problems: string[]
  checksum: string
  applied?: boolean
}

export interface MappingImpact {
  versionId: string
  versionNo: number
  status: string
  sourceAsset: string
  dataset: string
  standard: { id: string; code: string; name: string }
  itemCount: number
  mappedElements: Record<string, number>
  unpublishedUncoveredElements: string[]
  latestValidation: MappingValidationView | Record<string, never>
}

export interface MappingCoverage {
  asOf: string
  activeMappingVersions: number
  publishedCodeElements: number
  coveredCodeElements: number
  coverage: number | null
}

export async function fetchMappingSets(signal: AbortSignal | undefined, query = ''): Promise<MappingSetListItem[]> {
  const suffix = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ''
  const payload = await fetchJson<{ items: MappingSetListItem[] }>(`/v1/standard-mappings${suffix}`, signal, '映射集列表读取失败')
  return payload.items ?? []
}

export async function fetchMappingDetail(signal: AbortSignal | undefined, setId: string, versionId = ''): Promise<MappingDetailView> {
  const suffix = versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
  return fetchJson<MappingDetailView>(`/v1/standard-mappings/${encodeURIComponent(setId)}${suffix}`, signal, '映射集详情读取失败')
}

export async function fetchMappingCoverage(signal: AbortSignal | undefined): Promise<MappingCoverage> {
  return fetchJson<MappingCoverage>('/v1/standard-mappings/coverage', signal, '映射覆盖率读取失败')
}

export async function createMappingSet(payload: MappingCreatePayload): Promise<MappingDetailView> {
  const response = await portalFetch('/v1/standard-mappings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await throwHttpError(response, '映射集创建失败')
  return response.json()
}

export async function createMappingVersion(setId: string, baseVersionId = ''): Promise<MappingDetailView> {
  const response = await portalFetch(`/v1/standard-mappings/${encodeURIComponent(setId)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersionId }),
  })
  if (!response.ok) await throwHttpError(response, '映射新版本创建失败')
  return response.json()
}

export async function updateMappingVersion(versionId: string, payload: { setName?: string; items?: ItemPayload[] }): Promise<MappingDetailView> {
  const response = await portalFetch(`/v1/standard-mapping-versions/${encodeURIComponent(versionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await throwHttpError(response, '映射草稿修改失败')
  return response.json()
}

export async function importMappingItems(versionId: string, body: string, dryRun: boolean): Promise<ImportReport> {
  const isJson = body.trim().startsWith('{')
  const response = await portalFetch(`/v1/standard-mapping-versions/${encodeURIComponent(versionId)}/import?dryRun=${dryRun}`, {
    method: 'POST',
    headers: { 'Content-Type': isJson ? 'application/json' : 'text/csv' },
    body,
  })
  if (!response.ok) await throwHttpError(response, '映射导入失败')
  return response.json()
}

async function postAction(path: string, label: string): Promise<MappingDetailView> {
  const response = await portalFetch(path, { method: 'POST' })
  if (!response.ok) await throwHttpError(response, `${label}失败`)
  return response.json()
}

export const submitMappingVersion = (versionId: string) =>
  postAction(`/v1/standard-mapping-versions/${encodeURIComponent(versionId)}/submit`, '提交评审')
export const validateMappingVersion = (versionId: string) =>
  postAction(`/v1/standard-mapping-versions/${encodeURIComponent(versionId)}/validate`, '聚合验证')
export const activateMappingVersion = (versionId: string) =>
  postAction(`/v1/standard-mapping-versions/${encodeURIComponent(versionId)}/activate`, '生效')
export const retireMappingVersion = (versionId: string) =>
  postAction(`/v1/standard-mapping-versions/${encodeURIComponent(versionId)}/retire`, '停用')
export const rollbackMapping = (setId: string, versionId: string) =>
  postAction(`/v1/standard-mappings/${encodeURIComponent(setId)}/rollback/${encodeURIComponent(versionId)}`, '回退')

export async function fetchMappingImpact(signal: AbortSignal | undefined, versionId: string): Promise<MappingImpact> {
  return fetchJson<MappingImpact>(`/v1/standard-mapping-versions/${encodeURIComponent(versionId)}/impact`, signal, '影响范围读取失败')
}

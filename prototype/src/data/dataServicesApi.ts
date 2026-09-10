import { parseJsonOrThrow, PortalHttpError, portalFetch } from './http'

/**
 * 数据服务管理面 API 客户端（控制面 G13 dataservice 域）。
 * 类型与 control-plane `dataservice` 包的 record 一一对应。
 */


export type DataServiceStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'

export interface DataServiceParameterContract {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
  required: boolean
  description?: string
  values?: string[]
  defaultValue?: string
}

export interface DataServiceColumnContract {
  name: string
  type: string
  description?: string
}

export interface DataService {
  id: string
  tenantId: string
  code: string
  name: string
  description: string
  versionSn: string
  status: DataServiceStatus
  sqlTemplate: string
  parametersJson: string
  columnsJson: string
  maxRows: number
  timeoutSeconds: number
  owner: string
  createdAt: string
  updatedAt: string
}

export interface DataServiceKeySummary {
  id: string
  callerName: string
  keyPrefix: string
  allowedHospitals: string
  dailyQuota: number
  status: 'ACTIVE' | 'REVOKED'
  createdAt: string
  lastUsedAt: string
}

export interface DataServiceDetail {
  service: DataService
  keys: DataServiceKeySummary[]
  totalCalls: number
}

export interface DataServiceCallItem {
  id: string
  keyId: string
  rowCount: number
  truncated: boolean
  elapsedMs: number
  statusCode: number
  calledAt: string
}

export interface DataServiceExportItem {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'
  rowCount: number
  fileBytes: number
  error: string
  createdAt: string
  expiresAt: string
}

export interface DataServiceContractEventItem {
  eventId: string
  changeType: 'PUBLISHED' | 'UPDATED' | 'DEPRECATED' | 'TEST'
  fromVersion: string
  toVersion: string
  diff: string
  occurredAt: string
}

export interface DataServiceSubscriptionItem {
  id: string
  callerName: string
  webhookUrl: string
  status: 'ACTIVE' | 'REVOKED'
  createdAt: string
  revokedAt: string
}

export interface DataServiceOverview {
  total: number
  published: number
  draft: number
  activeKeys: number
  callsToday: number
}

export const dataServiceStatusLabel: Record<DataServiceStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  DEPRECATED: '已下线',
}

async function dsFetch(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  return portalFetch(path, { ...init, signal })
}

export function parseContracts<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json) as T[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function fetchDataServices(signal?: AbortSignal): Promise<DataService[]> {
  const payload = await parseJsonOrThrow(await dsFetch('/v1/data-services', {}, signal), '数据服务列表读取失败')
  return (payload as { items: DataService[] }).items ?? []
}

export async function fetchDataServiceDetail(id: string, signal?: AbortSignal): Promise<DataServiceDetail> {
  return parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}`, {}, signal),
    '数据服务详情读取失败',
  ) as Promise<DataServiceDetail>
}

export async function fetchDataServiceCalls(id: string, signal?: AbortSignal): Promise<DataServiceCallItem[]> {
  const payload = await parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/calls?limit=10`, {}, signal),
    '调用审计读取失败',
  )
  return (payload as { items: DataServiceCallItem[] }).items ?? []
}

export async function fetchDataServiceExports(id: string, signal?: AbortSignal): Promise<DataServiceExportItem[]> {
  const payload = await parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/exports?limit=10`, {}, signal),
    '导出任务读取失败',
  )
  return (payload as { items: DataServiceExportItem[] }).items ?? []
}

export async function fetchDataServiceContractEvents(id: string, signal?: AbortSignal): Promise<DataServiceContractEventItem[]> {
  const payload = await parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/contract-events?limit=10`, {}, signal),
    '合同事件读取失败',
  )
  return (payload as { items: DataServiceContractEventItem[] }).items ?? []
}

export async function fetchDataServiceSubscriptions(id: string, signal?: AbortSignal): Promise<DataServiceSubscriptionItem[]> {
  const payload = await parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/subscriptions`, {}, signal),
    '合同订阅读取失败',
  )
  return (payload as { items: DataServiceSubscriptionItem[] }).items ?? []
}

export async function fetchDataServiceOverview(signal?: AbortSignal): Promise<DataServiceOverview> {
  return parseJsonOrThrow(await dsFetch('/v1/data-services/overview', {}, signal), '数据服务概览读取失败') as Promise<DataServiceOverview>
}

export async function createDataService(request: {
  code: string
  name: string
  description: string
  sqlTemplate: string
  parameters: DataServiceParameterContract[]
  columns: DataServiceColumnContract[]
  maxRows: number
  timeoutSeconds: number
  owner: string
}): Promise<DataService> {
  return parseJsonOrThrow(
    await dsFetch('/v1/data-services', { method: 'POST', body: JSON.stringify(request) }),
    '数据服务创建失败',
  ) as Promise<DataService>
}

export async function publishDataService(id: string): Promise<DataService> {
  return parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/publish`, { method: 'POST' }),
    '数据服务发布失败',
  ) as Promise<DataService>
}

export async function deprecateDataService(id: string): Promise<DataService> {
  return parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/deprecate`, { method: 'POST' }),
    '数据服务下线失败',
  ) as Promise<DataService>
}

export async function issueDataServiceKey(id: string, callerName: string, allowedHospitals: string[], dailyQuota: number): Promise<{
  keyId: string
  callerName: string
  apiKey: string
  dailyQuota: number
}> {
  return parseJsonOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/keys`, {
      method: 'POST',
      body: JSON.stringify({ callerName, allowedHospitals, dailyQuota }),
    }),
    'API Key 发放失败',
  ) as Promise<{ keyId: string; callerName: string; apiKey: string; dailyQuota: number }>
}

export async function revokeDataServiceKey(id: string, keyId: string): Promise<void> {
  const response = await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 204) {
    throw new PortalHttpError(`API Key 吊销失败（HTTP ${response.status}）`, response.status)
  }
}

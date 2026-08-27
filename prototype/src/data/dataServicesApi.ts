import { getAccessToken } from './oidc'

/**
 * 数据服务管理面 API 客户端（控制面 G13 dataservice 域）。
 * 类型与 control-plane `dataservice` 包的 record 一一对应。
 */

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

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

export class DataServiceError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = '') {
    super(message)
    this.name = 'DataServiceError'
    this.status = status
    this.code = code
  }
}

async function dsFetch(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal })
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
  }
  return response
}

async function parseOrThrow(response: Response, prefix: string): Promise<unknown> {
  if (!response.ok) {
    let detail = ''
    let code = ''
    try {
      const payload = await response.json() as { message?: string; code?: string }
      detail = payload.message ?? ''
      code = payload.code ?? ''
    } catch {
      // 非 JSON 错误体时仅保留 HTTP 状态
    }
    throw new DataServiceError(`${prefix}${detail ? `：${detail}` : ''}（HTTP ${response.status}）`, response.status, code)
  }
  return response.json()
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
  const payload = await parseOrThrow(await dsFetch('/v1/data-services', {}, signal), '数据服务列表读取失败')
  return (payload as { items: DataService[] }).items ?? []
}

export async function fetchDataServiceDetail(id: string, signal?: AbortSignal): Promise<DataServiceDetail> {
  return parseOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}`, {}, signal),
    '数据服务详情读取失败',
  ) as Promise<DataServiceDetail>
}

export async function fetchDataServiceCalls(id: string, signal?: AbortSignal): Promise<DataServiceCallItem[]> {
  const payload = await parseOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/calls?limit=10`, {}, signal),
    '调用审计读取失败',
  )
  return (payload as { items: DataServiceCallItem[] }).items ?? []
}

export async function fetchDataServiceOverview(signal?: AbortSignal): Promise<DataServiceOverview> {
  return parseOrThrow(await dsFetch('/v1/data-services/overview', {}, signal), '数据服务概览读取失败') as Promise<DataServiceOverview>
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
  return parseOrThrow(
    await dsFetch('/v1/data-services', { method: 'POST', body: JSON.stringify(request) }),
    '数据服务创建失败',
  ) as Promise<DataService>
}

export async function publishDataService(id: string): Promise<DataService> {
  return parseOrThrow(
    await dsFetch(`/v1/data-services/${encodeURIComponent(id)}/publish`, { method: 'POST' }),
    '数据服务发布失败',
  ) as Promise<DataService>
}

export async function deprecateDataService(id: string): Promise<DataService> {
  return parseOrThrow(
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
  return parseOrThrow(
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
    throw new DataServiceError(`API Key 吊销失败（HTTP ${response.status}）`, response.status)
  }
}

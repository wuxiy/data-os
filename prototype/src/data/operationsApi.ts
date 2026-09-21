import { fetchJson } from './http'

/**
 * 运营只读投影（G24）API 客户端：管理驾驶舱与运营中心共用同一事实源；
 * 每项待办带 sourceType/sourceId/deepLink，可下钻到对应工作台。
 */

export interface OperationsSummary {
  asOf: string
  workItemsOpen: number
  components: { state: 'READY' | 'DEGRADED' | 'UNKNOWN'; ready: number; degraded: number; unknown: number; total: number }
  domains: {
    ingestion: { failedRuns: number; stalledRuns: number }
    governance: { openIssues: number; slaOverdue: number }
    notifications: { backlog: number }
    contracts: { deliveryBacklog: number }
    mpi: { availability: 'UP' | 'UNKNOWN' | 'NOT_CONFIGURED'; reviewPending: number }
    dataApi: { failedCalls24h: number }
    aiData: { activeBuilds: number; failedBuilds24h: number }
  }
}

export interface OperationsWorkItem {
  type: string
  title: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string
  sourceType: string
  sourceId: string
  deepLink: string
  asOf: string
}

export interface OperationsEventItem {
  domain: string
  type: string
  detail: string
  asOf: string
}

export const WORK_ITEM_TYPES = [
  'INGESTION_FAILED_RUN',
  'INGESTION_STALLED_RUN',
  'GOVERNANCE_ISSUE',
  'NOTIFICATION_BACKLOG',
  'CONTRACT_DELIVERY_BACKLOG',
  'DATA_API_FAILURES',
  'AI_BUILD_FAILED',
  'MPI_REVIEW_PENDING',
] as const

export async function fetchOperationsSummary(signal: AbortSignal | undefined): Promise<OperationsSummary> {
  return fetchJson<OperationsSummary>('/v1/operations/summary', signal, '运营摘要读取失败')
}

export async function fetchWorkItems(signal: AbortSignal | undefined, type = ''): Promise<OperationsWorkItem[]> {
  const suffix = type ? `?type=${encodeURIComponent(type)}` : ''
  const payload = await fetchJson<{ items: OperationsWorkItem[] }>(`/v1/operations/work-items${suffix}`, signal, '运营待办读取失败')
  return payload.items ?? []
}

export async function fetchOperationsEvents(signal: AbortSignal | undefined): Promise<OperationsEventItem[]> {
  const payload = await fetchJson<{ items: OperationsEventItem[] }>('/v1/operations/events', signal, '运营事件读取失败')
  return payload.items ?? []
}

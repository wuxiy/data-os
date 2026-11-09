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

/** 待办来源域中文名（对齐控制面 OperationsProjection 的 sourceType）；uuid 片段不展示。 */
export const WORK_ITEM_SOURCE_LABEL: Record<string, string> = {
  run: '数据接入',
  issue: '治理问题',
  notification: '通知投递',
  delivery: '合同投递',
  dataService: '数据服务',
  aiBuildJob: 'AI 构建',
  mpiMetrics: '患者主索引',
}

/** 事件域中文名（与 OperationsProjection 的事件源对齐；未收录域按原样回显）。 */
export const EVENT_DOMAIN_LABEL: Record<string, string> = {
  STANDARD: '数据标准',
  MAPPING: '标准映射',
  CONTRACT: '数据合同',
  AI_BUILD: 'AI 构建',
  NOTIFICATION: '通知投递',
  INGESTION: '数据接入',
  GOVERNANCE: '数据治理',
}

/** 事件类型中文名（管理驾驶舱与运营中心共用；未收录类型按原样回显）。 */
export const EVENT_TYPE_LABEL: Record<string, string> = {
  VERSION_CREATED: '新建版本',
  ROLLED_BACK: '回退',
  RETIRED: '停用',
  ACTIVATED: '启用',
  PUBLISHED: '发布',
  DEPRECATED: '废弃',
  DRAFT: '转草稿',
  DRAFT_UPDATED: '草稿更新',
  CREATED: '新建',
  DELETED: '删除',
  IMPORTED: '导入',
  ITEM_ADDED: '映射项新增',
  ITEM_REMOVED: '映射项移除',
  SNAPSHOT_CREATED: '快照生成',
  SUBMITTED: '提交评审',
  SUBMIT_BLOCKED: '提交受阻',
  SYNC_PENDING: '同步待定',
  SLA_OVERDUE: 'SLA 逾期',
  SUCCEEDED: '成功',
  FAILED: '失败',
  SENT: '已发送',
  RECHECK_REQUESTED: '发起复检',
  RECHECK_CONFIRMED_ABSENT: '复检批次确认不存在',
  RECHECK_SUBMIT_FAILED: '复检提交失败',
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

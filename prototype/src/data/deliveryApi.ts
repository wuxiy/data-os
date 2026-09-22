import { fetchJson, portalFetch, throwHttpError } from './http'

/**
 * 交付中心（G25）API 客户端：项目生命周期、交付项、证据快照（幂等）、
 * 提交（逐项阻断面）、验收/归档与证据包下载。动作类请求按约定生成
 * Idempotency-Key（每次调用一个新键；重试语义由服务端幂等保证）。
 */

export type DeliveryStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'READY_FOR_ACCEPTANCE'
  | 'ACCEPTED'
  | 'ARCHIVED'

export type DeliveryRefType = 'ASSET' | 'DASHBOARD' | 'DATA_SERVICE' | 'AI_DATA_PRODUCT'

export const DELIVERY_REF_TYPES: DeliveryRefType[] = ['ASSET', 'DASHBOARD', 'DATA_SERVICE', 'AI_DATA_PRODUCT']

export const REF_TYPE_LABEL: Record<DeliveryRefType, string> = {
  ASSET: '数据资产',
  DASHBOARD: '仪表盘',
  DATA_SERVICE: '数据服务',
  AI_DATA_PRODUCT: 'AI 数据产品',
}

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  DRAFT: '草稿',
  IN_PROGRESS: '进行中',
  READY_FOR_ACCEPTANCE: '待验收',
  ACCEPTED: '已验收',
  ARCHIVED: '已归档',
}

export function statusTone(status: string): 'healthy' | 'warning' | 'neutral' {
  if (status === 'ACCEPTED') return 'healthy' as const
  if (status === 'READY_FOR_ACCEPTANCE') return 'warning' as const
  return 'neutral' as const
}

export interface DeliveryProjectView {
  id: string
  code: string
  name: string
  scope: string
  owner: string
  targetDate: string
  status: DeliveryStatus | string
  acceptedSnapshotId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface DeliveryItemView {
  id: string
  refType: DeliveryRefType | string
  refId: string
  note: string
  createdBy: string
  createdAt: string
}

export interface DeliverySnapshotMeta {
  id: string
  checksum: string
  createdAt: string
  createdBy: string
}

export interface DeliveryEventView {
  eventType: string
  actor: string
  detail: string
  createdAt: string
}

export interface DeliveryDetailView {
  project: DeliveryProjectView
  items: DeliveryItemView[]
  snapshots: DeliverySnapshotMeta[]
  events: DeliveryEventView[]
}

export interface DeliveryBlocker {
  refType: string
  refId: string
  reasons: string[]
}

export async function fetchDeliveries(signal: AbortSignal | undefined, query = ''): Promise<DeliveryProjectView[]> {
  const suffix = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ''
  const payload = await fetchJson<{ projects: DeliveryProjectView[] }>(`/v1/deliveries${suffix}`, signal, '交付项目读取失败')
  return payload.projects ?? []
}

export async function fetchDeliveryDetail(signal: AbortSignal | undefined, id: string): Promise<DeliveryDetailView> {
  return fetchJson<DeliveryDetailView>(`/v1/deliveries/${encodeURIComponent(id)}`, signal, '交付项目详情读取失败')
}

export async function createDeliveryProject(payload: {
  code: string
  name: string
  scope?: string
  owner?: string
  targetDate?: string
}): Promise<DeliveryDetailView> {
  const response = await portalFetch('/v1/deliveries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await throwHttpError(response, '交付项目创建失败')
  return response.json()
}

export async function updateDeliveryProject(id: string, payload: {
  name: string
  scope?: string
  owner?: string
  targetDate?: string
}): Promise<DeliveryDetailView> {
  const response = await portalFetch(`/v1/deliveries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await throwHttpError(response, '交付项目更新失败')
  return response.json()
}

export async function addDeliveryItem(id: string, payload: {
  refType: string
  refId: string
  note?: string
}): Promise<DeliveryDetailView> {
  const response = await portalFetch(`/v1/deliveries/${encodeURIComponent(id)}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await throwHttpError(response, '交付项追加失败')
  return response.json()
}

export async function removeDeliveryItem(id: string, itemId: string): Promise<DeliveryDetailView> {
  const response = await portalFetch(`/v1/deliveries/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) await throwHttpError(response, '交付项移除失败')
  return response.json()
}

function newIdempotencyKey(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}

async function postWithKey<T = Record<string, unknown>>(path: string, label: string): Promise<T> {
  const response = await portalFetch(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('portal') },
  })
  if (!response.ok) await throwHttpError(response, `${label}失败`)
  return response.json() as Promise<T>
}

export const startDelivery = (id: string) =>
  postWithKey(`/v1/deliveries/${encodeURIComponent(id)}/start`, '启动交付')
export const acceptDelivery = (id: string) =>
  postWithKey(`/v1/deliveries/${encodeURIComponent(id)}/accept`, '验收')
export const archiveDelivery = (id: string) =>
  postWithKey(`/v1/deliveries/${encodeURIComponent(id)}/archive`, '归档')

export interface SnapshotResult {
  replayed: boolean
  snapshotId: string
  checksum: string
  createdAt: string
}

export async function snapshotDelivery(id: string): Promise<SnapshotResult> {
  return postWithKey<SnapshotResult>(`/v1/deliveries/${encodeURIComponent(id)}/snapshot`, '证据快照生成')
}

export interface SubmitResult {
  ok: boolean
  detail?: DeliveryDetailView
  blockers?: DeliveryBlocker[]
  message?: string
}

/** 提交验收：409 DELIVERY_BLOCKED 时解析逐项阻断面（门户渲染阻断清单）。 */
export async function submitDelivery(id: string): Promise<SubmitResult> {
  const response = await portalFetch(`/v1/deliveries/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('portal') },
  })
  if (response.ok) {
    return { ok: true, detail: await response.json() as DeliveryDetailView }
  }
  let payload: { code?: string; message?: string; blockers?: DeliveryBlocker[] } = {}
  try {
    payload = await response.json() as typeof payload
  } catch {
    // 非 JSON 错误体走统一抛错
  }
  if (response.status === 409 && Array.isArray(payload.blockers)) {
    return { ok: false, blockers: payload.blockers, message: payload.message }
  }
  return throwHttpError(response, '提交验收失败')
}

/** 证据包下载：认证头必须经 portalFetch，落 blob 触发浏览器下载。 */
export async function downloadEvidenceZip(id: string): Promise<void> {
  const response = await portalFetch(`/v1/deliveries/${encodeURIComponent(id)}/evidence.zip`)
  if (!response.ok) await throwHttpError(response, '证据包下载失败')
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = match?.[1] ?? `delivery-${id}-evidence.zip`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

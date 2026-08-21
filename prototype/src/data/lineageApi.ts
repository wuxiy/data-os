import { getAccessToken } from './oidc'

/**
 * 血缘/资产读 API 客户端（控制面 BFF → OpenMetadata，见 G1/G2 方案）。
 * 数据形状与 control-plane `lineage.LineageAssetService` 的投影 record 一一对应。
 */

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

export interface LineageAssetSummary {
  name: string
  fullyQualifiedName: string
  displayName: string
  columnCount: number
  updatedAt: string
  updatedBy: string
}

export interface LineageAssetCatalog {
  service: string
  schema: string
  assets: LineageAssetSummary[]
  fetchedAt: string
}

export interface LineageAssetColumn {
  name: string
  dataType: string
  description: string
}

export interface LineageAssetDetail {
  name: string
  fullyQualifiedName: string
  displayName: string
  description: string
  columns: LineageAssetColumn[]
  updatedAt: string
}

export interface LineageNodeView {
  fullyQualifiedName: string
  type: 'table' | 'dataModel' | 'dashboard' | 'chart' | 'unknown'
  displayName: string
}

export interface LineageAssetLineage {
  root: string
  upstreams: LineageNodeView[]
  downstreams: LineageNodeView[]
}

export interface LineageDashboardSummary {
  fullyQualifiedName: string
  displayName: string
  updatedAt: string
}

export interface LineageSummaryView {
  service: string
  schemas: string[]
  tableCount: number
  columnCount: number
  dashboardService: string
  dashboards: LineageDashboardSummary[]
}

export class LineageError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LineageError'
    this.status = status
  }
}

async function lineageFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' })
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE_URL}${path}`, { headers, signal })
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
  }
  return response
}

async function parseOrThrow(response: Response, prefix: string): Promise<unknown> {
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json() as { message?: string }
      detail = payload.message ?? ''
    } catch {
      // 非 JSON 错误体时仅保留 HTTP 状态。
    }
    throw new LineageError(`${prefix}${detail ? `：${detail}` : ''}（HTTP ${response.status}）`, response.status)
  }
  return response.json()
}

export async function fetchLineageCatalog(schema?: string, signal?: AbortSignal): Promise<LineageAssetCatalog> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : ''
  return parseOrThrow(await lineageFetch(`/v1/assets${query}`, signal), '资产目录读取失败') as Promise<LineageAssetCatalog>
}

export async function fetchLineageAsset(fullyQualifiedName: string, signal?: AbortSignal): Promise<LineageAssetDetail> {
  return parseOrThrow(
    await lineageFetch(`/v1/assets/${encodeURIComponent(fullyQualifiedName)}`, signal),
    '资产详情读取失败',
  ) as Promise<LineageAssetDetail>
}

export async function fetchLineageGraph(fullyQualifiedName: string, signal?: AbortSignal): Promise<LineageAssetLineage> {
  return parseOrThrow(
    await lineageFetch(`/v1/assets/${encodeURIComponent(fullyQualifiedName)}/lineage`, signal),
    '血缘读取失败',
  ) as Promise<LineageAssetLineage>
}

export async function fetchLineageSummary(signal?: AbortSignal): Promise<LineageSummaryView> {
  return parseOrThrow(await lineageFetch('/v1/lineage/summary', signal), '血缘摘要读取失败') as Promise<LineageSummaryView>
}

/** 展示名：全限定名去掉服务前缀（superset-dataos.model.2 → model.2）。 */
export function shortNodeName(node: LineageNodeView): string {
  const parts = node.fullyQualifiedName.split('.')
  return parts.length > 1 ? parts.slice(1).join('.') : node.fullyQualifiedName
}

/** 节点类型中文口径（CONTEXT.md「血缘锚点」）。 */
export const lineageNodeKindLabel: Record<LineageNodeView['type'], string> = {
  table: '数据表',
  dataModel: '数据模型',
  dashboard: '仪表盘',
  chart: '图表',
  unknown: '对象',
}

/** 资产目录库的中文口径（G6 三库；未登记的库回退物理库名）。 */
const knownSchemaLabels: Record<string, string> = {
  ods_ep: '电子处方 ODS',
  dataos_quality_acceptance: '质量验收库',
  dataos_mpi: '患者主索引库',
}

export function lineageSchemaLabel(schema: string): string {
  return knownSchemaLabels[schema] ?? schema
}

import { parseJsonOrThrow, portalFetch } from './http'

/**
 * 血缘/资产读 API 客户端（控制面 BFF → OpenMetadata，见 G1/G2 方案）。
 * 数据形状与 control-plane `lineage.LineageAssetService` 的投影 record 一一对应。
 */

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

export interface LineageColumnMapping {
  fromColumns: string[]
  toColumn: string
}

export interface LineageNodeView {
  fullyQualifiedName: string
  type: 'table' | 'dataModel' | 'dashboard' | 'chart' | 'unknown'
  displayName: string
  /** 声明式列级血缘（G7）：边的 columnsLineage 短列名投影；无映射为空数组。 */
  columnMappings: LineageColumnMapping[]
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

async function lineageFetch(path: string, signal?: AbortSignal): Promise<Response> {
  return portalFetch(path, { signal })
}

export async function fetchLineageCatalog(schema?: string, signal?: AbortSignal): Promise<LineageAssetCatalog> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : ''
  return parseJsonOrThrow(await lineageFetch(`/v1/assets${query}`, signal), '资产目录读取失败') as Promise<LineageAssetCatalog>
}

export async function fetchLineageAsset(fullyQualifiedName: string, signal?: AbortSignal): Promise<LineageAssetDetail> {
  return parseJsonOrThrow(
    await lineageFetch(`/v1/assets/${encodeURIComponent(fullyQualifiedName)}`, signal),
    '资产详情读取失败',
  ) as Promise<LineageAssetDetail>
}

export async function fetchLineageGraph(fullyQualifiedName: string, signal?: AbortSignal): Promise<LineageAssetLineage> {
  return parseJsonOrThrow(
    await lineageFetch(`/v1/assets/${encodeURIComponent(fullyQualifiedName)}/lineage`, signal),
    '血缘读取失败',
  ) as Promise<LineageAssetLineage>
}

export async function fetchLineageSummary(signal?: AbortSignal): Promise<LineageSummaryView> {
  return parseJsonOrThrow(await lineageFetch('/v1/lineage/summary', signal), '血缘摘要读取失败') as Promise<LineageSummaryView>
}

/** 资产的质量测试与最近结论（G7：控制面自有质量域，非 OM）。 */
export interface AssetQualityTest {
  ruleId: string
  datasetId: string
  selector: string
  lastRun: { status: string; passed: boolean; finishedAt: string | null } | null
}

export async function fetchAssetQualityTests(
  fullyQualifiedName: string,
  signal?: AbortSignal,
): Promise<AssetQualityTest[]> {
  const payload = await parseJsonOrThrow(
    await lineageFetch(`/v1/assets/${encodeURIComponent(fullyQualifiedName)}/quality-tests`, signal),
    '质量测试读取失败',
  ) as { tests?: AssetQualityTest[] }
  return payload.tests ?? []
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

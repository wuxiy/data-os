import {
  Boxes,
  BrainCircuit,
  Cable,
  ChartNoAxesCombined,
  Database,
  Fingerprint,
  House,
  Landmark,
  type LucideIcon,
  MessageSquareText,
  PackageCheck,
  ServerCog,
  Workflow,
} from 'lucide-react'

import { workPaths } from '../data/routes'

/**
 * 导航单一来源：侧栏分组、命令面板、顶栏页签与文档标题都从这里取。
 * 路径以 data/routes.ts 为唯一声明处；这里只补展示信息。
 */
export interface PortalRoute {
  key: string
  label: string
  path: string
  icon: LucideIcon
  /** 侧栏分组。 */
  group: string
  /** 治理子导航（展开态），仅数据质量/驾驶舱等共享一个高亮。 */
  sub?: boolean
  /** 参数化工作页的页签标题模板。 */
  pattern?: RegExp
  /** 工作页不进入侧栏（只参与页签与标题解析）。 */
  hidden?: boolean
  tabLabel?: string
}

export const portalRoutes: PortalRoute[] = [
  { key: 'management', label: '总览', path: '/', icon: House, group: '工作概览' },
  { key: 'operationsCenter', label: '运营中心', path: '/operations-center', icon: Workflow, group: '工作概览' },
  { key: 'deliveryCenter', label: '交付中心', path: '/delivery-center', icon: PackageCheck, group: '工作概览' },

  { key: 'ingestion', label: '数据接入', path: '/ingestion', icon: Cable, group: '数据管理' },
  { key: 'assets', label: '数据资产', path: '/assets', icon: Database, group: '数据管理' },
  { key: 'governance', label: '数据治理', path: '/governance', icon: Landmark, group: '数据管理' },
  { key: 'standards', label: '数据标准', path: '/governance/standards', icon: Landmark, group: '数据管理', sub: true },
  { key: 'mapping', label: '标准映射', path: '/governance/mapping', icon: Landmark, group: '数据管理', sub: true },
  { key: 'quality', label: '数据质量', path: '/governance/quality', icon: Landmark, group: '数据管理', sub: true },
  { key: 'assetTechnical', label: '血缘与影响', path: '/assets/technical', icon: Landmark, group: '数据管理', sub: true },
  { key: 'dataServices', label: '数据合同', path: '/data-services', icon: Landmark, group: '数据管理', sub: true },
  { key: 'mpi', label: '患者主索引', path: '/mpi/review', icon: Fingerprint, group: '数据管理' },

  { key: 'dataServicesApp', label: '数据服务', path: '/data-services', icon: Boxes, group: '数据应用' },
  { key: 'analytics', label: '分析看板', path: '/analysis', icon: ChartNoAxesCombined, group: '数据应用' },
  { key: 'aiData', label: 'AI Data', path: '/ai-data', icon: BrainCircuit, group: '数据应用' },
  { key: 'assistant', label: '智能问数', path: '/assistant', icon: MessageSquareText, group: '数据应用' },

  { key: 'operations', label: '平台运维', path: '/operations', icon: ServerCog, group: '平台管理' },

  // 新增工作页：不进入侧栏，参与页签标题与文档标题解析。
  { key: 'ingestionNew', hidden: true, label: '新建采集任务', path: workPaths.ingestionNew, icon: Cable, group: '数据管理' },
  { key: 'ingestionSourceExplorer', hidden: true, label: '数据源浏览', path: '/ingestion/sources', icon: Cable, group: '数据管理', pattern: /^\/ingestion\/sources\/[^/]+\/explorer$/, tabLabel: '数据源浏览' },
  { key: 'ingestionJob', hidden: true, label: '采集任务', path: '/ingestion/jobs', icon: Cable, group: '数据管理', pattern: /^\/ingestion\/jobs\/[^/]+$/, tabLabel: '采集任务详情' },
  { key: 'qualityRuleNew', hidden: true, label: '新建质量规则', path: workPaths.qualityRuleNew, icon: Landmark, group: '数据管理' },
  { key: 'qualityRuleEdit', hidden: true, label: '编辑质量规则', path: '/governance/quality/rules', icon: Landmark, group: '数据管理', pattern: /^\/governance\/quality\/rules\/[^/]+\/edit$/, tabLabel: '编辑质量规则' },
  { key: 'qualityScoring', hidden: true, label: '质量评分设置', path: workPaths.qualityScoring, icon: Landmark, group: '数据管理' },
  { key: 'dataServiceNew', hidden: true, label: '新建数据服务', path: workPaths.dataServiceNew, icon: Boxes, group: '数据应用' },
  { key: 'assistantWorkspace', hidden: true, label: '问数专业工作区', path: '/assistant/workspace', icon: MessageSquareText, group: '数据应用' },
  { key: 'assistantQuestionNew', hidden: true, label: '新建已验证问题', path: workPaths.assistantQuestionNew, icon: MessageSquareText, group: '数据应用' },
  { key: 'assistantQuestion', hidden: true, label: '已验证问题', path: '/assistant/workspace/questions', icon: MessageSquareText, group: '数据应用', pattern: /^\/assistant\/workspace\/questions\/[^/]+$/, tabLabel: '已验证问题' },
  { key: 'assistantAudit', hidden: true, label: '问数审计', path: workPaths.assistantAudit, icon: MessageSquareText, group: '数据应用' },
]

/** 侧栏可见入口（排除治理子项与工作页）。 */
export const navGroups = ['工作概览', '数据管理', '数据应用', '平台管理'].map((title) => ({
  title,
  items: portalRoutes.filter((route) => route.group === title && !route.sub && !route.hidden && !route.pattern),
}))

/** 治理展开后的子导航顺序（批准原型：驾驶舱、标准、映射、质量、血缘、合同）。 */
export const governanceChildren: { label: string; path: string; match: (pathname: string) => boolean }[] = [
  { label: '治理驾驶舱', path: '/governance', match: (path) => path === '/governance' },
  { label: '数据标准', path: '/governance/standards', match: (path) => path.startsWith('/governance/standards') },
  { label: '标准映射', path: '/governance/mapping', match: (path) => path.startsWith('/governance/mapping') },
  { label: '数据质量', path: '/governance/quality', match: (path) => path.startsWith('/governance/quality') },
  { label: '血缘与影响', path: '/assets/technical', match: (path) => path.startsWith('/assets/technical') },
  { label: '数据合同', path: '/data-services', match: (path) => path === '/data-services' || path === '/data-services/new' },
]

/** 按 pathname 找路由展示信息（含参数化工作页）。 */
export function routeForPath(pathname: string): PortalRoute | undefined {
  // 同一路径同时作为治理子项和独立页面时，标题取独立页面名称。
  const exact = portalRoutes.find((route) => route.path === pathname && !route.sub)
    ?? portalRoutes.find((route) => route.path === pathname)
  if (exact) return exact
  return portalRoutes.find((route) => route.pattern?.test(pathname))
}

/** 当前页面在侧栏应高亮的入口。 */
export function activeNavKey(pathname: string): string {
  if (pathname.startsWith('/ingestion')) return 'ingestion'
  if (pathname === '/assets') return 'assets'
  if (pathname.startsWith('/assets/technical')) return 'assets'
  if (pathname.startsWith('/governance')) return 'governance'
  if (pathname.startsWith('/mpi')) return 'mpi'
  if (pathname.startsWith('/assistant')) return 'assistant'
  if (pathname.startsWith('/data-services')) return 'dataServicesApp'
  if (pathname.startsWith('/ai-data')) return 'aiData'
  if (pathname.startsWith('/analysis')) return 'analytics'
  if (pathname.startsWith('/operations-center')) return 'operationsCenter'
  if (pathname.startsWith('/delivery-center')) return 'deliveryCenter'
  if (pathname.startsWith('/operations')) return 'operations'
  return 'management'
}

/** 是否处于治理分组（展开子导航并保持「数据治理」高亮）。 */
export function isGovernancePath(pathname: string): boolean {
  return pathname.startsWith('/governance') || pathname.startsWith('/assets/technical')
}

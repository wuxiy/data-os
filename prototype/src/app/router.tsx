import { Link, Outlet, createRootRoute, createRoute, createRouter, useRouter } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { EmptyState } from '../components/ui/states'
import { Button } from '../components/ui/button'
import { OverviewPage } from '../features/overview/overview-page'
import { IngestionPage } from '../features/ingestion/ingestion-page'
import { JobEditorPage } from '../features/ingestion/job-editor-page'
import { JobDetailPage } from '../features/ingestion/job-detail-page'
import { SourceExplorerPage } from '../features/ingestion/source-explorer-page'
import { GovernanceDashboardPage } from '../features/governance/governance-dashboard-page'
import { QualityPage } from '../features/governance/quality-page'
import { RuleEditorPage } from '../features/governance/rule-editor-page'
import { ScoringPage } from '../features/governance/scoring-page'
import { StandardsPage } from '../features/governance/standards-page'
import { MappingPage } from '../features/governance/mapping-page'
import { AssetCatalogPage } from '../features/assets/asset-catalog-page'
import { AssetTechnicalPage } from '../features/assets/asset-technical-page'
import { MpiReviewPage } from '../features/mpi/mpi-review-page'
import { AIDataPage } from '../features/ai-data/ai-data-page'
import { DataServicesPage } from '../features/data-services/data-services-page'
import { ServiceEditorPage } from '../features/data-services/service-editor-page'
import { AnalyticsPage } from '../features/analytics/analytics-page'
import { AssistantPage } from '../features/assistant/assistant-page'
import { QuestionEditorPage } from '../features/assistant/question-editor-page'
import { AssistantAuditPage } from '../features/assistant/audit-page'
import { AppShell } from './shell/app-shell'
import { LegacyPortalPage } from './legacy/legacy-page'

/**
 * 路由单一来源：path 字面量来自 data/routes.ts 的同名常量语义（静态入口不重命名）。
 * search 只声明可分享的筛选/对象键；自由文本、患者检索、问数参数与密钥不入 URL。
 */
const rootRoute = createRootRoute({
  component: ShellLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
})

function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function NotFoundPage() {
  return (
    <section className="min-w-0 overflow-clip rounded-panel border border-line bg-paper">
      <EmptyState
        icon={<TriangleAlert />}
        title="页面不存在"
        description="地址中的工作区不存在，或该深链已失效。可以返回总览，或从左侧导航进入已有工作区。"
        action={<Link to="/" className="inline-flex min-h-[33px] items-center rounded-control border border-blue bg-blue px-3 text-body-sm font-medium text-white hover:bg-blue-hover">返回总览</Link>}
      />
    </section>
  )
}

function RouteErrorPage({ error }: { error: unknown }) {
  const router = useRouter()
  const message = error instanceof Error ? error.message : String(error)
  return (
    <section className="min-w-0 overflow-clip rounded-panel border border-line bg-paper">
      <EmptyState
        icon={<TriangleAlert />}
        title="页面加载失败"
        description="当前工作区渲染出错。可以返回总览或重试；若持续失败，请联系平台管理员并提供页面地址。"
        action={
          <div className="flex items-center gap-2">
            <Button onClick={() => { void router.invalidate() }}>重新加载</Button>
            <Link to="/" className="inline-flex min-h-[33px] items-center rounded-control border border-line-strong bg-paper px-3 text-body-sm text-ink-soft">返回总览</Link>
          </div>
        }
      />
      <p className="px-10 pb-6 text-center font-mono text-meta text-[#98a2ae]">{message}</p>
    </section>
  )
}

const optString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const legacyRouteKeys = [
  'management', 'ingestion', 'governance', 'standards', 'mapping', 'quality', 'mpi',
  'assets', 'assetTechnical', 'analytics', 'aiData', 'dataServices', 'assistant',
  'assistantWorkspace', 'operationsCenter', 'deliveryCenter', 'operations',
] as const

type LegacyKey = (typeof legacyRouteKeys)[number]

function legacy(path: string, key: LegacyKey, validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    validateSearch: validateSearch ?? ((search: Record<string, unknown>) => search),
    component: () => <LegacyPortalPage route={key} />,
  })
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewPage,
})
const ingestionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ingestion',
  component: IngestionPage,
})
const ingestionNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ingestion/new',
  component: () => <JobEditorPage />,
})
const ingestionSourceExplorerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ingestion/sources/$sourceId/explorer',
  component: IngestionSourceExplorerRouteComponent,
})
const ingestionJobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ingestion/jobs/$jobId',
  validateSearch: (search: Record<string, unknown>) => ({ tab: optString(search.tab) }),
  component: IngestionJobRouteComponent,
})

function IngestionSourceExplorerRouteComponent() {
  const { sourceId } = ingestionSourceExplorerRoute.useParams()
  return <SourceExplorerPage sourceId={sourceId} />
}

function IngestionJobRouteComponent() {
  const { jobId } = ingestionJobRoute.useParams()
  return <JobDetailPage jobId={jobId} />
}
const governanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance',
  component: GovernanceDashboardPage,
})
const qualityRulesNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance/quality/rules/new',
  component: () => <RuleEditorPage />,
})
const qualityRuleEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance/quality/rules/$ruleId/edit',
  component: QualityRuleEditRouteComponent,
})
const qualityScoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance/quality/scoring',
  component: ScoringPage,
})

function QualityRuleEditRouteComponent() {
  const { ruleId } = qualityRuleEditRoute.useParams()
  return <RuleEditorPage ruleId={ruleId} />
}
const standardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance/standards',
  component: StandardsPage,
})
const mappingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance/mapping',
  component: MappingPage,
})
const qualityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance/quality',
  validateSearch: (search: Record<string, unknown>) => ({ issue: optString(search.issue) }),
  component: QualityPage,
})
const mpiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mpi/review',
  validateSearch: (search: Record<string, unknown>) => ({ task: optString(search.task) }),
  component: MpiReviewPage,
})
const assetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assets',
  validateSearch: (search: Record<string, unknown>) => ({ db: optString(search.db), asset: optString(search.asset) }),
  component: AssetCatalogPage,
})
const assetTechnicalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assets/technical',
  validateSearch: (search: Record<string, unknown>) => ({ asset: optString(search.asset), db: optString(search.db) }),
  component: AssetTechnicalPage,
})
const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analysis',
  component: AnalyticsPage,
})
const aiDataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ai-data',
  validateSearch: (search: Record<string, unknown>) => ({ product: optString(search.product) }),
  component: AIDataPage,
})
const dataServicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/data-services',
  component: DataServicesPage,
})
const dataServiceNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/data-services/new',
  component: ServiceEditorPage,
})
const assistantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assistant',
  component: () => <AssistantPage />,
})
const assistantWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assistant/workspace',
  component: () => <AssistantPage professional />,
})
const assistantQuestionNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assistant/workspace/questions/new',
  component: () => <QuestionEditorPage />,
})
const assistantQuestionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assistant/workspace/questions/$questionCode',
  validateSearch: (search: Record<string, unknown>) => ({ tab: optString(search.tab) }),
  component: AssistantQuestionRouteComponent,
})
const assistantAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assistant/workspace/audit',
  component: AssistantAuditPage,
})

function AssistantQuestionRouteComponent() {
  const { questionCode } = assistantQuestionRoute.useParams()
  return <QuestionEditorPage questionCode={questionCode} />
}
const operationsCenterRoute = legacy('/operations-center', 'operationsCenter')
const deliveryCenterRoute = legacy('/delivery-center', 'deliveryCenter')
const operationsRoute = legacy('/operations', 'operations')

const routeTree = rootRoute.addChildren([
  indexRoute,
  ingestionRoute,
  ingestionNewRoute,
  ingestionSourceExplorerRoute,
  ingestionJobRoute,
  governanceRoute,
  standardsRoute,
  mappingRoute,
  qualityRoute,
  qualityRulesNewRoute,
  qualityRuleEditRoute,
  qualityScoringRoute,
  mpiRoute,
  assetsRoute,
  assetTechnicalRoute,
  analyticsRoute,
  aiDataRoute,
  dataServicesRoute,
  dataServiceNewRoute,
  assistantRoute,
  assistantWorkspaceRoute,
  assistantQuestionNewRoute,
  assistantQuestionRoute,
  assistantAuditRoute,
  operationsCenterRoute,
  deliveryCenterRoute,
  operationsRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: false,
  // 页签/深链返回时恢复滚动位置；进入新页面仍滚到顶部。
  scrollRestoration: true,
  // 未知路径渲染壳内的「页面不存在」，而不是静默显示首页。
  notFoundMode: 'root',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

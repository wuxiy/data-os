import { Link, Outlet, createRootRoute, createRoute, createRouter, useRouter } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { Suspense, lazy } from 'react'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { AppShell } from './shell/app-shell'

/**
 * 路由单一来源：path 字面量来自 data/routes.ts 的同名常量语义（静态入口不重命名）。
 * search 只声明可分享的筛选/对象键；自由文本、患者检索、问数参数与密钥不入 URL。
 * 页面按路由懒加载（FE7）：入口只带壳与基础组件，业务页随 chunk 到达。
 */
// 零 props 包装让所有懒页面统一为 ComponentType<{}>；带参页面经下方包装组件传参。
const OverviewPage = lazy(() => import('../features/overview/overview-page').then((m) => ({ default: () => <m.OverviewPage /> })))
const IngestionPage = lazy(() => import('../features/ingestion/ingestion-page').then((m) => ({ default: () => <m.IngestionPage /> })))
const JobEditorPage = lazy(() => import('../features/ingestion/job-editor-page').then((m) => ({ default: (props: { jobId?: string }) => <m.JobEditorPage jobId={props.jobId} /> })))
const JobDetailPage = lazy(() => import('../features/ingestion/job-detail-page').then((m) => ({ default: (props: { jobId: string }) => <m.JobDetailPage jobId={props.jobId} /> })))
const SourceExplorerPage = lazy(() => import('../features/ingestion/source-explorer-page').then((m) => ({ default: (props: { sourceId: string }) => <m.SourceExplorerPage sourceId={props.sourceId} /> })))
const GovernanceDashboardPage = lazy(() => import('../features/governance/governance-dashboard-page').then((m) => ({ default: () => <m.GovernanceDashboardPage /> })))
const QualityPage = lazy(() => import('../features/governance/quality-page').then((m) => ({ default: () => <m.QualityPage /> })))
const RuleEditorPage = lazy(() => import('../features/governance/rule-editor-page').then((m) => ({ default: (props: { ruleId?: string }) => <m.RuleEditorPage ruleId={props.ruleId} /> })))
const ScoringPage = lazy(() => import('../features/governance/scoring-page').then((m) => ({ default: () => <m.ScoringPage /> })))
const StandardsPage = lazy(() => import('../features/governance/standards-page').then((m) => ({ default: () => <m.StandardsPage /> })))
const MappingPage = lazy(() => import('../features/governance/mapping-page').then((m) => ({ default: () => <m.MappingPage /> })))
const AssetCatalogPage = lazy(() => import('../features/assets/asset-catalog-page').then((m) => ({ default: () => <m.AssetCatalogPage /> })))
const AssetTechnicalPage = lazy(() => import('../features/assets/asset-technical-page').then((m) => ({ default: () => <m.AssetTechnicalPage /> })))
const MpiReviewPage = lazy(() => import('../features/mpi/mpi-review-page').then((m) => ({ default: () => <m.MpiReviewPage /> })))
const AIDataPage = lazy(() => import('../features/ai-data/ai-data-page').then((m) => ({ default: () => <m.AIDataPage /> })))
const DataServicesPage = lazy(() => import('../features/data-services/data-services-page').then((m) => ({ default: () => <m.DataServicesPage /> })))
const ServiceEditorPage = lazy(() => import('../features/data-services/service-editor-page').then((m) => ({ default: () => <m.ServiceEditorPage /> })))
const AnalyticsPage = lazy(() => import('../features/analytics/analytics-page').then((m) => ({ default: () => <m.AnalyticsPage /> })))
const AssistantPage = lazy(() => import('../features/assistant/assistant-page').then((m) => ({ default: (props: { professional?: boolean }) => <m.AssistantPage professional={props.professional} /> })))
const QuestionEditorPage = lazy(() => import('../features/assistant/question-editor-page').then((m) => ({ default: (props: { questionCode?: string }) => <m.QuestionEditorPage questionCode={props.questionCode} /> })))
const AssistantAuditPage = lazy(() => import('../features/assistant/audit-page').then((m) => ({ default: () => <m.AssistantAuditPage /> })))
const OperationsCenterPage = lazy(() => import('../features/operations/operations-center-page').then((m) => ({ default: () => <m.OperationsCenterPage /> })))
const DeliveryCenterPage = lazy(() => import('../features/operations/delivery-center-page').then((m) => ({ default: () => <m.DeliveryCenterPage /> })))
const PlatformOperationsPage = lazy(() => import('../features/operations/platform-operations-page').then((m) => ({ default: () => <m.PlatformOperationsPage /> })))

const rootRoute = createRootRoute({
  component: ShellLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
})

function ShellLayout() {
  return (
    <AppShell>
      {/* 懒加载路由在此挂起：壳（侧栏/顶栏/横幅）立即呈现，页面 chunk 到达后替换占位。 */}
      <Suspense fallback={<RouteLoading />}>
        <Outlet />
      </Suspense>
    </AppShell>
  )
}

function RouteLoading() {
  return (
    <section className="flex min-h-[320px] items-center justify-center rounded-panel border border-line bg-paper" aria-busy="true" role="status">
      <p className="text-label text-muted-foreground">正在进入工作区…</p>
    </section>
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
            <Button variant="outline" onClick={() => { void router.invalidate() }}>重新加载</Button>
            <Link to="/" className="inline-flex min-h-[33px] items-center rounded-control border border-line-strong bg-paper px-3 text-body-sm text-ink-soft">返回总览</Link>
          </div>
        }
      />
      <p className="px-10 pb-6 text-center font-mono text-meta text-muted-foreground">{message}</p>
    </section>
  )
}

const optString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

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

const operationsCenterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/operations-center',
  component: OperationsCenterPage,
})
const deliveryCenterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/delivery-center',
  component: DeliveryCenterPage,
})
const operationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/operations',
  component: PlatformOperationsPage,
})

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

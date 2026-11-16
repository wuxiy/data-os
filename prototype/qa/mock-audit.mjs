import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const src = (path) => readFileSync(resolve(root, path), 'utf8')

// FE2 起逐域迁移：迁移后的页面要么读真实 API，要么显式演示；不再需要 DemoDataBoundary
// 兜底，因此从本清单移除，改由下方「迁移页不得引用演示数据」锁覆盖。
const staticPages = [
  'src/pages/DataStandardsPage.tsx',
  'src/pages/StandardMappingPage.tsx',

  'src/pages/AnalyticsPage.tsx',
  'src/pages/AssistantPage.tsx',
  'src/pages/DeliveryCenterPage.tsx',
]

for (const page of staticPages) {
  assert.match(src(page), /DemoDataBoundary/, `${page} 必须显式声明 mock 数据边界`)
}

// FE3 锁迁移：治理驾驶舱迁到 features/governance；演示样例不再进入新页面。
const governance = src('src/features/governance/governance-dashboard-page.tsx')
assert.match(src('src/features/governance/queries.ts'), /fetchGovernanceSummary/, '治理驾驶舱必须读取真实摘要 API')
assert.doesNotMatch(governance, /fallbackIssues|演示数据 · 控制面暂不可用/, '治理驾驶舱不得在 API 失败时静默展示问题 mock')
assert.match(governance, /控制面暂不可用 · 未加载真实治理指标或问题/, '治理驾驶舱必须展示真实不可用状态')
assert.doesNotMatch(governance, /showStaticSamples|TrendChart/, '迁移后的驾驶舱不得回退静态演示样例')
assert.match(src('src/data/runtimeMode.ts'), /showStaticSamples/, '运行模式模块仍保留静态样例可见性谓词（旧页兼容 seam）')
assert.match(src('src/data/runtimeMode.ts'), /frontendDemoMode && apiState === 'live'/, '静态样例可见性谓词必须由运行模式模块单一实现')

// G22/G24 接真锁：标准中心与管理驾驶舱在真实构建必须切到 Live 组件（不再只显示「暂未接入」）
assert.match(src('src/features/governance/standards-page.tsx'), /standardsQuery/, '数据标准页必须经 Query 读取标准清单（原锁在 DataStandardsLive）')
assert.match(src('src/features/governance/queries.ts'), /fetchStandards/, '标准 Query 必须调用标准 API')
// FE2 锁迁移：总览已由 features/overview 承担，旧 Page+Live 双件退役（文件保留到 FE7）。
assert.match(src('src/features/overview/queries.ts'), /fetchOperationsSummary/, '总览必须读取运营投影摘要（原锁在 ManagementDashboardLive）')
assert.match(src('src/features/overview/overview-page.tsx'), /operationsSummaryQuery/, '总览必须经 Query 层读取运营投影')
assert.doesNotMatch(src('src/features/overview/overview-page.tsx'), /managementMetrics|riskRanking/, '总览不得读取静态事实')
assert.match(src('src/pages/OperationsCenterPage.tsx'), /fetchWorkItems/, '运营中心必须读取运营待办投影')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /组件就绪/, '运行状态横幅必须显示组件覆盖数')

// G23 接真锁：标准映射真实构建切 Live、治理导航三入口不再是无动作占位
assert.match(src('src/features/governance/mapping-page.tsx'), /fetchMappingSets|mappingSetsQuery/, '标准映射页必须读取映射 API（原锁在 StandardMappingLive）')
assert.match(src('src/features/governance/mapping-page.tsx'), /validateMappingVersion|activateMappingVersion/, '标准映射页必须提供验证与生效动作')
// FE3 锁迁移：治理子导航由壳的 app/navigation.ts 承担（旧 GovernanceTabs 随迁移退役）。
const governanceNav = src('src/app/navigation.ts')
assert.match(governanceNav, /label: '血缘与影响', path: '\/assets\/technical'/, '治理导航「血缘与影响」必须进入资产技术视图')
// P1-4 收敛（2026-10-05）：「数据质量」是质量工作台唯一入口（旧「问题闭环」
// 同指 quality 路由致双 aria-current 高亮），并锁定子导航路由不重复。
assert.match(governanceNav, /label: '数据质量', path: '\/governance\/quality'/, '治理导航「数据质量」必须进入质量问题工作台')
assert.doesNotMatch(governanceNav, /问题闭环/, '治理导航不得再有与「数据质量」同路由的重复入口（双高亮回归）')
assert.match(governanceNav, /label: '数据合同', path: '\/data-services'/, '治理导航「数据合同」必须进入数据服务合同视图')
assert.doesNotMatch(governanceNav, /规划中/, '治理导航不得再有无动作占位')

// G25 接真锁：交付中心真实构建切 Live、一级路由可达、不回静态数据
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /frontendDemoMode[\s\S]*DeliveryCenterLive/, '交付中心页真实构建必须渲染 DeliveryCenterLive')
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /fetchDeliveries/, '交付中心真实页必须读取交付项目 API')
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /submitDelivery|acceptDelivery/, '交付中心真实页必须提供提交与验收动作')
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /downloadEvidenceZip/, '交付中心真实页必须提供证据包下载')
assert.match(src('src/data/routes.ts'), /deliveryCenter/, '路由表必须注册交付中心路径')
// FE1 锁迁移：旧 AppShell 的一级导航数组并入 app/navigation.ts，断言改指新家，
// 业务不变量不变——交付中心必须是一级入口且挂真实路由。
assert.match(src('src/app/navigation.ts'), /key: 'deliveryCenter', label: '交付中心', path: '\/delivery-center'/, '一级导航「交付中心」必须挂真实路由（不再是规划中占位）')

// G26 接真锁：智能问数真实构建切 Live、拒答显式呈现、不回退演示场景
// FE5 锁迁移：问数页迁到 features/assistant，路由直接渲染新页。
assert.match(src('src/app/router.tsx'), /component: \(\) => <AssistantPage \/>/, '问数路由必须挂载 AssistantPage')
assert.match(src('src/features/assistant/assistant-page.tsx'), /AssistantLive/, '问数页必须渲染 AssistantLive 工作区')
assert.match(src('src/features/assistant/queries.ts'), /fetchAssistantQuestions/, '问数必须读取已验证问题清单（原锁在 AssistantLive）')
assert.match(src('src/pages/AssistantLive.tsx'), /askAssistantQuery|submitAssistantFeedback/, '问数真实页必须提供提问与反馈动作')
assert.match(src('src/pages/AssistantLive.tsx'), /REFUSED_|answered/, '问数真实页必须显式呈现拒答信封')
assert.doesNotMatch(src('src/pages/AssistantLive.tsx'), /assistantScenarios/, '问数真实页不得回退演示场景数据')
// G27 治理面：专业工作区在治理角色内呈现问题治理区块；治理动作走真实接口
assert.match(src('src/pages/AssistantLive.tsx'), /AssistantGovernance/, '专业工作区必须接入问数治理区块（G27）')
assert.match(src('src/features/assistant/queries.ts'), /fetchAssistantAdminQuestions/, '治理面必须读取治理清单接口（原锁在 AssistantGovernance）')
assert.match(src('src/features/assistant/question-editor-page.tsx'), /testAssistantQuestion|assistantQuestionAction/, '治理面必须提供试运行与生命周期动作')
assert.match(src('src/features/assistant/governance-section.tsx'), /verified/, '治理面必须呈现发布门验证状态')
assert.match(src('src/features/assistant/audit-page.tsx'), /fetchAssistantAudits|downloadAssistantAuditCsv/, '治理面必须提供审计管理面（G27 余项）')
assert.match(src('src/features/assistant/governance-section.tsx'), /TablePagination/, '治理列表必须分页')
assert.match(src('src/features/assistant/audit-page.tsx'), /TablePagination/, '审计面必须服务端分页')
assert.doesNotMatch(src('src/features/assistant/governance-section.tsx'), /assistantScenarios/, '治理面不得使用演示场景数据')

// FE2 锁迁移：接入域已迁到 features/ingestion，两条不变量随实现迁移。
const ingestionEditor = src('src/features/ingestion/job-editor-page.tsx')
assert.match(ingestionEditor, /真实模式不允许使用 FakeSource 演示模板/, '真实模式不得保存 FakeSource 演示采集模板')
assert.match(src('src/features/ingestion/labels.ts'), /defaultTemplateKey\(DEFAULT_TEMPLATE_KEY, LIVE_TEMPLATE_KEY\)/, '采集任务默认模板必须随运行模式切换')

// 迁移页不得把演示/静态数据带回真实路径（计划 §1 完成定义 3）。
for (const page of [
  'src/features/overview/overview-page.tsx',
  'src/features/assets/asset-catalog-page.tsx',
  'src/features/assets/asset-technical-page.tsx',
  'src/features/mpi/mpi-review-page.tsx',
  'src/pages/MpiReviewLive.tsx',
  'src/features/ingestion/ingestion-page.tsx',
  'src/features/ingestion/job-editor-page.tsx',
  'src/features/ingestion/job-detail-page.tsx',
  'src/features/ingestion/source-explorer-page.tsx',
]) {
  assert.doesNotMatch(src(page), /from ['"][^'"]*data\/mock['"]/, `${page} 不得引用演示数据`)
  assert.doesNotMatch(src(page), /assistantScenarios|managementMetrics/, `${page} 不得引用旧静态样例`)
}

const runtime = src('src/data/runtimeMode.ts')
assert.match(runtime, /VITE_DATAOS_DEMO_MODE/, '前端演示模式必须通过显式构建变量启用')
assert.match(src('src/data/controlPlane.ts'), /fetchRuntimeStatus/, '门户必须读取控制面运行状态')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /演示运行模式/, '门户必须展示当前运行模式')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /真实运行模式/, '门户必须展示真实运行模式')
assert.match(src('src/components/ui/DemoDataBoundary.tsx'), /不写入控制面/, '演示模式必须明确动作不会产生真实业务副作用')
assert.match(src('src/data/controlPlane.ts'), /confirmIngestionRunAbsent/, '采集 UNKNOWN 必须有人工确认不存在接口')

// 2026-10-05 复评收口锁（P1-1 + 责任链 v1）：驾驶舱首屏叙事——待办先行、
// 责任链认领质量工作台证据链、评分无数据收一行、死告示不得回归
const dashboardPage = src('src/features/governance/governance-dashboard-page.tsx')
assert.match(dashboardPage, /治理责任链 · v1/, '驾驶舱必须渲染责任链 v1 入口（认领质量工作台证据链）')
assert.doesNotMatch(dashboardPage, /责任链详情待接入真实溯源服务/, '驾驶舱不得再渲染「责任链待接入」死告示')
assert.ok(dashboardPage.indexOf('治理待办') < dashboardPage.indexOf('<QualityScorePanel'), '驾驶舱待办表必须先于质量评分渲染（首屏叙事）')
assert.match(src('src/features/governance/quality-score-panel.tsx'), /rules\.every\(\(rule\) => rule\.score == null\)/, '质量评分无带评分规则时必须收成一行空态')

console.log(`mock audit passed: ${staticPages.length} static pages gated, governance fallback removed, runtime mode visible`)

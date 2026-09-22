import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const src = (path) => readFileSync(resolve(root, path), 'utf8')

const staticPages = [
  'src/pages/ManagementDashboardPage.tsx',
  'src/pages/DataStandardsPage.tsx',
  'src/pages/StandardMappingPage.tsx',
  'src/pages/MpiReviewPage.tsx',
  'src/pages/AssetCatalogPage.tsx',
  'src/pages/AssetTechnicalPage.tsx',
  'src/pages/AnalyticsPage.tsx',
  'src/pages/AssistantPage.tsx',
  'src/pages/DeliveryCenterPage.tsx',
]

for (const page of staticPages) {
  assert.match(src(page), /DemoDataBoundary/, `${page} 必须显式声明 mock 数据边界`)
}

const governance = src('src/pages/GovernanceDashboardPage.tsx')
assert.match(governance, /fetchGovernanceSummary/, '治理驾驶舱必须读取真实摘要 API')
assert.doesNotMatch(governance, /fallbackIssues|演示数据 · 控制面暂不可用/, '治理驾驶舱不得在 API 失败时静默展示问题 mock')
assert.match(governance, /控制面暂不可用 · 未加载真实治理指标或问题/, '治理驾驶舱必须展示真实不可用状态')
assert.match(governance, /showStaticSamples\(apiState\)/, '治理静态链路和趋势必须经运行模式模块同时满足演示模式与控制面可用')
assert.match(src('src/data/runtimeMode.ts'), /frontendDemoMode && apiState === 'live'/, '静态样例可见性谓词必须由运行模式模块单一实现')

// G22/G24 接真锁：标准中心与管理驾驶舱在真实构建必须切到 Live 组件（不再只显示「暂未接入」）
assert.match(src('src/pages/DataStandardsPage.tsx'), /frontendDemoMode[\s\S]*DataStandardsLive/, '数据标准页真实构建必须渲染 DataStandardsLive')
assert.match(src('src/pages/ManagementDashboardPage.tsx'), /frontendDemoMode[\s\S]*ManagementDashboardLive/, '管理驾驶舱真实构建必须渲染 ManagementDashboardLive')
assert.match(src('src/pages/ManagementDashboardLive.tsx'), /fetchOperationsSummary/, '管理驾驶舱必须读取运营投影摘要')
assert.doesNotMatch(src('src/pages/ManagementDashboardLive.tsx'), /managementMetrics|riskRanking/, '管理驾驶舱真实页不得读取静态事实')
assert.match(src('src/pages/DataStandardsLive.tsx'), /fetchStandards/, '数据标准真实页必须读取标准 API')
assert.match(src('src/pages/OperationsCenterPage.tsx'), /fetchWorkItems/, '运营中心必须读取运营待办投影')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /组件就绪/, '运行状态横幅必须显示组件覆盖数')

// G23 接真锁：标准映射真实构建切 Live、治理导航三入口不再是无动作占位
assert.match(src('src/pages/StandardMappingPage.tsx'), /frontendDemoMode[\s\S]*StandardMappingLive/, '标准映射页真实构建必须渲染 StandardMappingLive')
assert.match(src('src/pages/StandardMappingLive.tsx'), /fetchMappingSets/, '标准映射真实页必须读取映射 API')
assert.match(src('src/pages/StandardMappingLive.tsx'), /validateMappingVersion|activateMappingVersion/, '标准映射真实页必须提供验证与生效动作')
const governanceTabs = src('src/components/ui/GovernanceTabs.tsx')
assert.match(governanceTabs, /'血缘与影响', route: 'assetTechnical'/, '治理导航「血缘与影响」必须进入资产技术视图')
assert.match(governanceTabs, /'问题闭环', route: 'quality'/, '治理导航「问题闭环」必须进入质量问题工作台')
assert.match(governanceTabs, /'数据合同', route: 'dataServices'/, '治理导航「数据合同」必须进入数据服务合同视图')
assert.doesNotMatch(governanceTabs, /规划中/, '治理导航不得再有无动作占位')

// G25 接真锁：交付中心真实构建切 Live、一级路由可达、不回静态数据
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /frontendDemoMode[\s\S]*DeliveryCenterLive/, '交付中心页真实构建必须渲染 DeliveryCenterLive')
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /fetchDeliveries/, '交付中心真实页必须读取交付项目 API')
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /submitDelivery|acceptDelivery/, '交付中心真实页必须提供提交与验收动作')
assert.match(src('src/pages/DeliveryCenterPage.tsx'), /downloadEvidenceZip/, '交付中心真实页必须提供证据包下载')
assert.match(src('src/data/routes.ts'), /deliveryCenter/, '路由表必须注册交付中心路径')
assert.match(src('src/components/layout/AppShell.tsx'), /label: '交付中心', icon: PackageCheck, route: 'deliveryCenter'/, '一级导航「交付中心」必须挂真实路由（不再是规划中占位）')

const ingestion = src('src/pages/DataIngestionPage.tsx')
assert.match(ingestion, /真实模式不允许使用 FakeSource 演示模板/, '真实模式不得保存 FakeSource 演示采集模板')
assert.match(ingestion, /defaultTemplateKey\(DEFAULT_TEMPLATE_KEY, LIVE_TEMPLATE_KEY\)/, '采集任务默认模板必须随运行模式切换')

const runtime = src('src/data/runtimeMode.ts')
assert.match(runtime, /VITE_DATAOS_DEMO_MODE/, '前端演示模式必须通过显式构建变量启用')
assert.match(src('src/data/controlPlane.ts'), /fetchRuntimeStatus/, '门户必须读取控制面运行状态')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /演示运行模式/, '门户必须展示当前运行模式')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /真实运行模式/, '门户必须展示真实运行模式')
assert.match(src('src/components/ui/DemoDataBoundary.tsx'), /不写入控制面/, '演示模式必须明确动作不会产生真实业务副作用')
assert.match(src('src/data/controlPlane.ts'), /confirmIngestionRunAbsent/, '采集 UNKNOWN 必须有人工确认不存在接口')

console.log(`mock audit passed: ${staticPages.length} static pages gated, governance fallback removed, runtime mode visible`)

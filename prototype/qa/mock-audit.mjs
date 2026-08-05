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
]

for (const page of staticPages) {
  assert.match(src(page), /DemoDataBoundary/, `${page} 必须显式声明 mock 数据边界`)
}

const governance = src('src/pages/GovernanceDashboardPage.tsx')
assert.match(governance, /fetchGovernanceSummary/, '治理驾驶舱必须读取真实摘要 API')
assert.doesNotMatch(governance, /fallbackIssues|演示数据 · 控制面暂不可用/, '治理驾驶舱不得在 API 失败时静默展示问题 mock')
assert.match(governance, /控制面暂不可用 · 未加载真实治理指标或问题/, '治理驾驶舱必须展示真实不可用状态')
assert.match(governance, /frontendDemoMode && apiState === 'live'/, '治理静态链路和趋势必须同时满足演示模式与控制面可用')

const ingestion = src('src/pages/DataIngestionPage.tsx')
assert.match(ingestion, /真实模式不允许使用 FakeSource 演示模板/, '真实模式不得保存 FakeSource 演示采集模板')
assert.match(ingestion, /frontendDemoMode \? DEFAULT_TEMPLATE_KEY : LIVE_TEMPLATE_KEY/, '采集任务默认模板必须随运行模式切换')

const runtime = src('src/data/runtime.ts')
assert.match(runtime, /VITE_DATAOS_DEMO_MODE/, '前端演示模式必须通过显式构建变量启用')
assert.match(src('src/data/controlPlane.ts'), /fetchRuntimeStatus/, '门户必须读取控制面运行状态')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /演示运行模式/, '门户必须展示当前运行模式')
assert.match(src('src/components/ui/RuntimeStatusBanner.tsx'), /真实运行模式/, '门户必须展示真实运行模式')

console.log(`mock audit passed: ${staticPages.length} static pages gated, governance fallback removed, runtime mode visible`)

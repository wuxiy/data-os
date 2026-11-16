import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const revision = process.argv[2]

function read(path) {
  if (!revision) return readFileSync(resolve(root, path), 'utf8')
  return execFileSync('git', ['show', `${revision}:prototype/${path}`], { encoding: 'utf8' })
}

// 锁迁移记录（FE1，2026-11-16）：App.tsx 的 switch 分发已由 app/router.tsx 的
// 代码路由取代，侧栏高亮逻辑移入 app/navigation.ts。以下三条断言改指新家，
// 业务不变量不变：技术视图/专业工作区必须有深链、可挂载，且侧栏保持父入口高亮。
const app = read('src/App.tsx')
const routerFile = read('src/app/router.tsx')
const navigation = read('src/app/navigation.ts')
const types = read('src/types.ts')
const routes = read('src/data/routes.ts')
const assets = read('src/pages/AssetCatalogPage.tsx')
const assistant = read('src/pages/AssistantPage.tsx')
const ingestion = read('src/pages/DataIngestionPage.tsx')
// FE3 锁迁移：质量工作台迁到 features/governance；下面各条不变量随实现迁移。
const quality = read('src/features/governance/quality-page.tsx')
const controlPlane = read('src/data/controlPlane.ts')
const http = read('src/data/http.ts')
const oidc = read('src/data/oidc.ts')
const scopeNotice = read('src/components/ui/ProductScopeNotice.tsx')

assert.match(types, /'assetTechnical'/, '资产技术视图必须是可识别路由')
assert.match(types, /'assistantWorkspace'/, '专业问数工作区必须是可识别路由')
assert.match(routes, /assetTechnical:\s*'\/assets\/technical'/, '资产技术视图必须有深链路径')
assert.match(routes, /assistantWorkspace:\s*'\/assistant\/workspace'/, '专业问数工作区必须有深链路径')
assert.match(routerFile, /path: '\/assets\/technical'/, '路由表必须登记资产技术视图深链')
assert.match(routerFile, /component: AssetTechnicalPage/, '路由树必须挂载资产技术视图')
assert.match(routerFile, /path: '\/assistant\/workspace'|legacy\('\/assistant\/workspace'/, '路由表必须登记专业问数工作区')
assert.match(routerFile, /assistantWorkspaceRoute/, '路由树必须挂载专业问数工作区')
assert.match(navigation, /pathname\.startsWith\('\/assets\/technical'\)\) return 'assets'/, '技术视图打开后数据资产导航仍应保持激活')
assert.match(navigation, /pathname\.startsWith\('\/assistant'\)\) return 'assistant'/, '专业工作区打开后智能问数导航仍应保持激活')
assert.match(assets, /target="_blank"/, '打开技术视图必须产生新标签页')
assert.match(assets, /routePaths\.assetTechnical/, '打开技术视图必须指向真实深链')
assert.match(assistant, /target="_blank"/, '进入专业工作区必须产生新标签页')
assert.match(assistant, /routePaths\.assistantWorkspace/, '进入专业工作区必须指向真实深链')
// FE2 锁迁移：采集页迁到 features/ingestion；JSON 默认展开的不变量随编辑器迁移。
assert.match(read('src/features/ingestion/job-editor-page.tsx'), /<details open/, '采集配置 JSON 默认展开（details open）')
assert.match(read('src/features/ingestion/job-editor-page.tsx'), /默认展开 · 可编辑/, '采集配置 JSON 必须标注默认展开可编辑')
assert.match(controlPlane, /fetchGovernanceIssues/, '质量闭环必须调用治理问题查询 API')
assert.match(controlPlane, /requestGovernanceIssueRecheck/, '质量闭环必须调用治理问题复检 API')
assert.match(controlPlane, /syncGovernanceIssueRun/, '质量闭环必须支持同步质量执行批次')
assert.match(controlPlane, /remindGovernanceIssueOwner/, '质量闭环必须支持责任人提醒通知')
assert.match(http, /Authorization/, '门户 API 传输层必须支持 Bearer token 注入（http.ts）')
assert.match(http, /dataos:auth-required/, '传输层必须在 401 时广播会话失效事件')
assert.match(oidc, /code_challenge_method.*S256/, '门户 OIDC 登录必须使用 PKCE S256')
assert.match(oidc, /sessionStorage/, '门户 OIDC 会话必须限制在当前浏览器会话')
assert.match(app, /AuthGate/, '应用入口必须经过会话门')
assert.match(read('src/app/auth-gate.tsx'), /OidcLoginGate/, '生产门户必须在 OIDC 未登录时阻断业务页面')
assert.match(read('src/components/ui/RuntimeStatusBanner.tsx'), /首期真实范围/, '门户必须持续显示首期真实产品范围（由运行状态横幅承载）')
assert.match(scopeNotice, /首期真实范围/, '门户范围提示必须明确首期真实能力')
assert.match(scopeNotice, /受控智能问数（Beta，仅已验证问题/, '门户范围提示必须声明问数边界（Beta · 仅已验证问题）')
assert.doesNotMatch(quality, /from ['"][^'"]*data\/mock['"]/, '质量闭环不得继续依赖本地演示问题数据')
assert.match(quality, /控制面暂不可用 · 未加载治理问题/, '质量闭环必须有真实控制面不可用状态')
assert.match(quality, /updateGovernanceIssueWorkflow/, '处理说明必须回写控制面')
assert.match(quality, /canRecheck/, '复检中的问题不得重复提交复检请求')
assert.match(quality, /治理问题详情不可用/, '问题详情读取失败必须展示可见错误反馈')
assert.match(quality, /复检执行批次/, '质量闭环必须呈现执行批次与执行器')
assert.match(quality, /历史执行批次/, '质量闭环必须呈现历史执行批次')
assert.match(quality, /sampleEvidence/, '质量闭环必须呈现样本证据')
assert.match(quality, /lastError/, '质量闭环必须呈现执行器最近错误与重试信息')
assert.match(quality, /reconciliationStatus/, '质量闭环必须呈现人工对账状态')
assert.match(quality, /确认不存在/, '质量闭环必须提供确认外部批次不存在入口')
assert.match(quality, /提醒责任人/, '质量闭环责任人提醒必须是可执行动作')

// 品牌与枚举红线（DESIGN.md：业务视图不暴露底层引擎名与后端英文枚举）。
// 技术域页面（平台运维、资产技术视图）按自身边界声明允许出现组件名，不在锁内。
// FE4 锁迁移：资产目录迁到 features/assets；业务视图仍不得暴露引擎名与实例原始名。
const assetsLive = read('src/features/assets/asset-catalog-page.tsx')
assert.doesNotMatch(assetsLive, /OpenMetadata/, '资产目录业务视图不得暴露元数据引擎名（DESIGN.md 红线）')
// 实例名锁（2026-11-09 走查 P2）：渲染处不得直出原始实例名（doris-dataos /
// superset-dataos 等小写实例名曾绕过上面的大小写敏感锁直出业务视图），
// 须走 lineageApi.instanceServiceLabel 中文口径；源码注释与技术域页面不在锁内。
assert.doesNotMatch(assetsLive, />\{catalog\.service\}|>\{summary\.dashboardService\}/, '资产目录业务视图不得直出实例原始名（须 instanceServiceLabel 映射）')
assert.match(assetsLive, /instanceServiceLabel\(/, '资产目录实例名必须经中文口径映射')
const analyticsLive = read('src/pages/AnalyticsLive.tsx')
assert.doesNotMatch(analyticsLive, /Superset/, '分析看板业务视图不得暴露分析引擎品牌（DESIGN.md 红线；包名/标识符为小写不受影响）')
const aiDetail = read('src/pages/AIDataDetailPage.tsx')
assert.match(aiDetail, /aiBuildStatusLabel/, 'AI Data 版本构建状态必须经中文口径映射')
assert.match(aiDetail, /aiCertificationLabel/, 'AI Data 认证档位必须经中文口径映射')
assert.match(aiDetail, /aiFeedbackTypeLabel/, 'AI Data 反馈类型必须经中文口径映射')
assert.doesNotMatch(aiDetail, />\{version\.buildStatus\}|>\{readiness\.certification \?\? '\u2014'\}|>\{item\.feedbackType\}/, 'AI Data 不得把后端枚举原样渲染进表格')
assert.doesNotMatch(read('src/pages/MpiReviewLive.tsx'), /<StatusTag|<Tag color="warning">\{candidate\.ruleId\}/, 'MPI 队列不得重复渲染原始规则枚举')
assert.match(read('src/pages/MpiReviewLive.tsx'), /mpiRuleLabel/, 'MPI 规则枚举必须经中文口径映射')

// 版本切换控件红线（2026-10-05 critique P0-1）：不可变版本模型的命脉交互，
// 不得复用 11px 装饰圆点类，控件可见尺寸必须由样式锁定。
// FE3 锁迁移：版本切换控件由 CSS Module 换成 Tailwind 内联样式，不变量改为
// 「版本切换按钮锁定可见高度 ≥32px、且不复用时间轴装饰类」。
const standardsLive = read('src/features/governance/standards-page.tsx')
const mappingLive = read('src/features/governance/mapping-page.tsx')
assert.doesNotMatch(standardsLive, /timelineDot|rounded-full size-2/, '标准详情版本切换不得复用装饰圆点类（曾致控件塌陷）')
assert.doesNotMatch(mappingLive, /timelineDot|rounded-full size-2/, '映射详情版本切换不得复用装饰圆点类')
assert.match(standardsLive, /min-h-\[36px\]/, '标准详情版本切换必须锁定可见高度（≥32px）')
assert.match(mappingLive, /min-h-\[36px\]/, '映射详情版本切换必须锁定可见高度（≥32px）')

// 执行器输出治理（2026-10-05 critique P0-2）：处理说明不得预填执行器全文，
// dbt 品牌不得直出业务视图（指纹仅存活在治理助手中）。
assert.match(quality, /looksLikeExecutorOutput/, '处理说明预填必须过滤执行器输出指纹')
assert.match(quality, /executorOutputView/, '长执行器输出必须切分为首行 + 折叠全文')
assert.match(quality, /查看完整执行输出/, '执行器全文必须收进折叠区而非平铺')
assert.match(quality, /placeholder=\{canEdit/, '处理说明输入框必须有填写指引占位符')
assert.doesNotMatch(read('src/pages/QualityIssuesPage.tsx'), />(\s*)\{detail\.latestRun\.resultMessage\}/, '批次结果消息不得整段平铺渲染')

console.log(`portal interactions smoke passed${revision ? ` at ${revision}` : ''}`)

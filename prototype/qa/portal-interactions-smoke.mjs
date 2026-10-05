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

const app = read('src/App.tsx')
const types = read('src/types.ts')
const routes = read('src/data/routes.ts')
const shell = read('src/components/layout/AppShell.tsx')
const assets = read('src/pages/AssetCatalogPage.tsx')
const assistant = read('src/pages/AssistantPage.tsx')
const ingestion = read('src/pages/DataIngestionPage.tsx')
const quality = read('src/pages/QualityIssuesPage.tsx')
const controlPlane = read('src/data/controlPlane.ts')
const http = read('src/data/http.ts')
const oidc = read('src/data/oidc.ts')
const scopeNotice = read('src/components/ui/ProductScopeNotice.tsx')

assert.match(types, /'assetTechnical'/, '资产技术视图必须是可识别路由')
assert.match(types, /'assistantWorkspace'/, '专业问数工作区必须是可识别路由')
assert.match(routes, /assetTechnical:\s*'\/assets\/technical'/, '资产技术视图必须有深链路径')
assert.match(routes, /assistantWorkspace:\s*'\/assistant\/workspace'/, '专业问数工作区必须有深链路径')
assert.match(app, /case 'assetTechnical':/, 'App 必须挂载资产技术视图')
assert.match(app, /case 'assistantWorkspace':/, 'App 必须挂载专业问数工作区')
assert.match(shell, /\['assets', 'assetTechnical'\]/, '技术视图打开后数据资产导航仍应保持激活')
assert.match(shell, /\['assistant', 'assistantWorkspace'\]/, '专业工作区打开后智能问数导航仍应保持激活')
assert.match(assets, /target="_blank"/, '打开技术视图必须产生新标签页')
assert.match(assets, /routePaths\.assetTechnical/, '打开技术视图必须指向真实深链')
assert.match(assistant, /target="_blank"/, '进入专业工作区必须产生新标签页')
assert.match(assistant, /routePaths\.assistantWorkspace/, '进入专业工作区必须指向真实深链')
assert.match(ingestion, /<details className=\{styles\.configDetails\} open>/, '采集配置 JSON 必须默认展开')
assert.match(controlPlane, /fetchGovernanceIssues/, '质量闭环必须调用治理问题查询 API')
assert.match(controlPlane, /requestGovernanceIssueRecheck/, '质量闭环必须调用治理问题复检 API')
assert.match(controlPlane, /syncGovernanceIssueRun/, '质量闭环必须支持同步质量执行批次')
assert.match(controlPlane, /remindGovernanceIssueOwner/, '质量闭环必须支持责任人提醒通知')
assert.match(http, /Authorization/, '门户 API 传输层必须支持 Bearer token 注入（http.ts）')
assert.match(http, /dataos:auth-required/, '传输层必须在 401 时广播会话失效事件')
assert.match(oidc, /code_challenge_method.*S256/, '门户 OIDC 登录必须使用 PKCE S256')
assert.match(oidc, /sessionStorage/, '门户 OIDC 会话必须限制在当前浏览器会话')
assert.match(app, /OidcLoginGate/, '生产门户必须在 OIDC 未登录时阻断业务页面')
assert.match(read('src/components/ui/RuntimeStatusBanner.tsx'), /首期真实范围/, '门户必须持续显示首期真实产品范围（由运行状态横幅承载）')
assert.match(scopeNotice, /首期真实范围/, '门户范围提示必须明确首期真实能力')
assert.match(scopeNotice, /受控智能问数（Beta，仅已验证问题/, '门户范围提示必须声明问数边界（Beta · 仅已验证问题）')
assert.doesNotMatch(quality, /from ['"]\.\.\/data\/mock['"]/, '质量闭环不得继续依赖本地演示问题数据')
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
const assetsLive = read('src/pages/AssetCatalogLive.tsx')
assert.doesNotMatch(assetsLive, /OpenMetadata/, '资产目录业务视图不得暴露元数据引擎名（DESIGN.md 红线）')
const analyticsLive = read('src/pages/AnalyticsLive.tsx')
assert.doesNotMatch(analyticsLive, /Superset/, '分析看板业务视图不得暴露分析引擎品牌（DESIGN.md 红线；包名/标识符为小写不受影响）')
const aiDetail = read('src/pages/AIDataDetailPage.tsx')
assert.match(aiDetail, /aiBuildStatusLabel/, 'AI Data 版本构建状态必须经中文口径映射')
assert.match(aiDetail, /aiCertificationLabel/, 'AI Data 认证档位必须经中文口径映射')
assert.match(aiDetail, /aiFeedbackTypeLabel/, 'AI Data 反馈类型必须经中文口径映射')
assert.doesNotMatch(aiDetail, />\{version\.buildStatus\}|>\{readiness\.certification \?\? '\u2014'\}|>\{item\.feedbackType\}/, 'AI Data 不得把后端枚举原样渲染进表格')
assert.doesNotMatch(read('src/pages/MpiReviewLive.tsx'), /<StatusTag tone="warning">\{candidate\.ruleId\}/, 'MPI 队列不得重复渲染原始规则枚举')

// 版本切换控件红线（2026-10-05 critique P0-1）：不可变版本模型的命脉交互，
// 不得复用 11px 装饰圆点类，控件可见尺寸必须由样式锁定。
const standardsLive = read('src/pages/DataStandardsLive.tsx')
const mappingLive = read('src/pages/StandardMappingLive.tsx')
const pagesCss = read('src/pages/Pages.module.css')
assert.doesNotMatch(standardsLive, /styles\.timelineDot/, '标准详情版本切换不得复用时间轴装饰圆点类（曾致控件塌陷）')
assert.doesNotMatch(mappingLive, /styles\.timelineDot/, '映射详情版本切换不得复用时间轴装饰圆点类')
assert.match(standardsLive, /styles\.versionChip/, '标准详情版本切换必须使用 versionChip')
assert.match(mappingLive, /styles\.versionChip/, '映射详情版本切换必须使用 versionChip')
assert.match(pagesCss, /\.versionChip \{[^}]*min-height: 32px/s, 'versionChip 必须锁定可见高度（≥32px）')

// 执行器输出治理（2026-10-05 critique P0-2）：处理说明不得预填执行器全文，
// dbt 品牌不得直出业务视图（指纹仅存活在治理助手中）。
assert.match(quality, /looksLikeExecutorOutput/, '处理说明预填必须过滤执行器输出指纹')
assert.match(quality, /executorOutputView/, '长执行器输出必须切分为首行 + 折叠全文')
assert.match(quality, /查看完整执行输出/, '执行器全文必须收进折叠区而非平铺')
assert.match(quality, /placeholder=\{canEdit/, '处理说明输入框必须有填写指引占位符')
assert.doesNotMatch(read('src/pages/QualityIssuesPage.tsx'), />(\s*)\{detail\.latestRun\.resultMessage\}/, '批次结果消息不得整段平铺渲染')

console.log(`portal interactions smoke passed${revision ? ` at ${revision}` : ''}`)

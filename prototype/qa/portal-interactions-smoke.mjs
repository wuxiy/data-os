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
const routes = read('src/data/mock.ts')
const shell = read('src/components/layout/AppShell.tsx')
const assets = read('src/pages/AssetCatalogPage.tsx')
const assistant = read('src/pages/AssistantPage.tsx')
const ingestion = read('src/pages/DataIngestionPage.tsx')
const quality = read('src/pages/QualityIssuesPage.tsx')
const controlPlane = read('src/data/controlPlane.ts')

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
assert.doesNotMatch(quality, /from ['"]\.\.\/data\/mock['"]/, '质量闭环不得继续依赖本地演示问题数据')
assert.match(quality, /控制面暂不可用 · 未加载治理问题/, '质量闭环必须有真实控制面不可用状态')
assert.match(quality, /updateGovernanceIssueWorkflow/, '处理说明必须回写控制面')
assert.match(quality, /canRecheck/, '复检中的问题不得重复提交复检请求')
assert.match(quality, /治理问题详情不可用/, '问题详情读取失败必须展示可见错误反馈')
assert.match(quality, /复检执行批次/, '质量闭环必须呈现执行批次与执行器')
assert.match(quality, /历史执行批次/, '质量闭环必须呈现历史执行批次')
assert.match(quality, /sampleEvidence/, '质量闭环必须呈现样本证据')
assert.match(quality, /lastError/, '质量闭环必须呈现执行器最近错误与重试信息')
assert.match(quality, /提醒责任人/, '质量闭环责任人提醒必须是可执行动作')

console.log(`portal interactions smoke passed${revision ? ` at ${revision}` : ''}`)

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

console.log(`portal interactions smoke passed${revision ? ` at ${revision}` : ''}`)

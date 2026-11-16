#!/usr/bin/env node
/**
 * 浏览器验收（FE1 起）：真实浏览器打开构建产物，逐路由检查
 * 页面身份、主工作区、控制台异常与横向溢出。
 *
 * 用法（在 prototype/ 下）：
 *   node qa/browser-smoke.mjs                 # 使用已启动的 http://127.0.0.1:4173
 *   node qa/browser-smoke.mjs --serve         # 自行启动 vite preview
 *   node qa/browser-smoke.mjs --shots /tmp/x  # 保存截图
 *   node qa/browser-smoke.mjs --routes /,/ingestion
 *
 * 浏览器：优先使用系统 Chrome（channel=chrome），缺失时回退到 Playwright 自带
 * chromium（需 `npx playwright install chromium`）。不依赖操作者临时缓存。
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name, fallback = undefined) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? (args[index + 1] ?? true) : fallback
}

const base = String(flag('base', 'http://127.0.0.1:4173')).replace(/\/$/, '')
const shouldServe = args.includes('--serve')
const flowArgIndex = args.indexOf('--flows')
const flows = flowArgIndex >= 0 ? String(args[flowArgIndex + 1] ?? 'all').split(',') : []
const wantsFlow = (name) => flows.includes(name) || flows.includes('all')
const shotsDir = flag('shots', null)
const routeArg = flag('routes', null)
const widths = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]

// FE7 全量矩阵：17 个既有入口 + 10 个新工作页（动态页用受控测试 ID，mock 控制面可命中）。
const ROUTES = routeArg
  ? String(routeArg).split(',').map((item) => item.trim()).filter(Boolean)
  : [
    '/', '/ingestion', '/governance', '/governance/standards', '/governance/mapping', '/governance/quality',
    '/mpi/review', '/assets', '/assets/technical', '/analysis', '/ai-data', '/data-services', '/assistant',
    '/assistant/workspace', '/operations-center', '/delivery-center', '/operations',
    '/ingestion/new',
    '/ingestion/sources/src-lis-001/explorer',
    '/ingestion/jobs/job-lab-result-001',
    '/ingestion/jobs/job-ds-workflow-004?tab=scheduling',
    '/governance/quality/rules/new',
    '/governance/quality/rules/quality.ep.order.paystatus-range/edit',
    '/governance/quality/scoring',
    '/data-services/new',
    '/assistant/workspace/questions/new',
    '/assistant/workspace/questions/medicine-record-daily',
    '/assistant/workspace/questions/medicine-record-daily?tab=try',
    '/assistant/workspace/audit',
  ]

const failures = []
const checked = []

function record(ok, message) {
  if (!ok) failures.push(message)
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 继续等待
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`预览服务未在 ${timeoutMs}ms 内就绪：${url}`)
}

let server
if (shouldServe) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: resolve(new URL('..', import.meta.url).pathname),
    stdio: 'ignore',
    env: process.env,
  })
  await waitForServer(`${base}/`)
}

if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
const context = await browser.newContext({ viewport: widths[0], locale: 'zh-CN' })
const page = await context.newPage()

let consoleErrors = []
let networkNotes = []
page.on('console', (message) => {
  if (message.type() !== 'error') return
  const text = message.text()
  // 静态预览没有后端：/api/* 的 404 属于环境事实，单独记录，不算应用异常。
  if (text.startsWith('Failed to load resource')) networkNotes.push(text)
  else consoleErrors.push(text)
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

try {
  for (const viewport of widths) {
    await page.setViewportSize(viewport)
    for (const route of ROUTES) {
      consoleErrors = []
      networkNotes = []
      const response = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
      record(Boolean(response && response.status() < 400), `${route} 返回 HTTP ${response?.status()}`)
      // 等页面标题与主工作区出现；本地无后端时页面应落到「不可用/待接入」而不是白屏。
      await page.waitForFunction(() => Boolean(document.querySelector('main')), null, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(600)

      const snapshot = await page.evaluate(() => ({
        title: document.title,
        h1: [...document.querySelectorAll('main h1')].map((node) => node.textContent?.trim()).filter(Boolean),
        mainText: document.querySelector('main')?.textContent?.trim() ?? '',
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        hasLegacyRoot: Boolean(document.querySelector('#legacy-root')),
        hasBusy: Boolean(document.querySelector('[aria-busy="true"]')),
      }))

      record(snapshot.title.includes('医数中枢'), `${route} 标题缺少站点名：${snapshot.title}`)
      record(snapshot.h1.length > 0, `${route} 缺少页面标题（h1）`)
      record(snapshot.mainText.length > 20, `${route} 主工作区为空`)
      record(snapshot.overflow <= 1, `${route} 在 ${viewport.width}px 出现横向溢出 ${snapshot.overflow}px`)
      record(consoleErrors.length === 0, `${route} 控制台异常：${consoleErrors.slice(0, 2).join(' | ')}`)

      if (shotsDir) {
        const safe = route === '/' ? 'index' : route.replace(/^\//, '').replace(/[/?=&]/g, '-')
        await page.screenshot({ path: resolve(shotsDir, `${safe}-${viewport.width}.png`), fullPage: false })
      }
      checked.push({ route, viewport: `${viewport.width}x${viewport.height}`, title: snapshot.title, h1: snapshot.h1[0], legacy: snapshot.hasLegacyRoot, busy: snapshot.hasBusy, networkNotes: networkNotes.length })
    }
  }

  /* 壳交互（FE1）：页签保留、关闭回退与未知路径的显式空态。 */
  await page.setViewportSize(widths[0])
  // 页签是会话状态：清空后只留下本流程打开的两个页签，回退目标才是确定的。
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => sessionStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goto(`${base}/ingestion`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const tabLabels = await page.locator('nav[aria-label="已打开的页面"] button').allTextContents()
  record(tabLabels.some((label) => label.includes('总览')) && tabLabels.some((label) => label.includes('数据接入')), `页签未保留已打开页面：${tabLabels.join(',')}`)

  await page.getByRole('button', { name: '关闭数据接入页签' }).click()
  await page.waitForTimeout(600)
  record(new URL(page.url()).pathname === '/', `关闭当前页签后未回到总览：${page.url()}`)
  record((await page.locator('main h1').allTextContents()).join('').length > 0, '关闭页签后主工作区为空')

  await page.goto(`${base}/definitely-missing`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  record((await page.locator('main').textContent())?.includes('页面不存在') ?? false, '未知路径必须显示「页面不存在」而不是静默首页')
  record((await page.title()).includes('医数中枢'), '未知路径仍保留站点标题')

  /* FE2 业务流（需要 mock 控制面）：短表单登记、调度预览、库表浏览。 */
  if (wantsFlow('fe2')) {
    await page.goto(`${base}/ingestion`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: '登记数据源' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 5000 })
    await dialog.getByLabel('来源名称').fill('QA 登记来源')
    await dialog.getByRole('button', { name: '登记来源' }).click()
    await page.waitForTimeout(600)
    record((await page.locator('body').textContent())?.includes('数据源已登记') ?? false, '登记数据源后必须出现可见回执')
    record(await dialog.isHidden(), '登记成功后短表单应关闭')
    await page.getByRole('tab', { name: /数据源/ }).click()
    await page.waitForTimeout(300)
    record((await page.locator('main').textContent())?.includes('QA 登记来源') ?? false, '新登记的数据源必须出现在列表')

    await page.goto(`${base}/ingestion/jobs/job-ds-workflow-004?tab=scheduling`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: '预览触发时间' }).click()
    await page.waitForTimeout(500)
    record((await page.locator('main').textContent())?.includes('平台调度引擎计算') ?? false, '调度预览必须显示计算来源')

    await page.goto(`${base}/ingestion/sources/src-lis-001/explorer`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /lis_db/ }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /lab_result/ }).click()
    await page.waitForTimeout(500)
    record((await page.locator('main').textContent())?.includes('result_id') ?? false, '库表浏览必须渲染字段清单')
  }

  /* FE3 业务流（需要 mock 控制面）：问题深链、规则编辑回填、标准版本切换。 */
  if (wantsFlow('fe3')) {
    await page.goto(`${base}/governance/quality?issue=DQ-20261116-001`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('药品编码不符合院级标准') ?? false, '问题深链必须选中对应问题')
    const noteBox = page.locator('#processing-note')
    record((await noteBox.inputValue()).includes('已核对 127 个编码'), '处理说明必须回填已保存结论')

    await page.goto(`${base}/governance/quality/rules/quality.ep.order.paystatus-range/edit`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    record((await page.locator('#rule-id').inputValue()) === 'quality.ep.order.paystatus-range', '规则编辑必须回填规则编号')
    record((await page.locator('#rule-type').inputValue()) === 'VAL_SET', '规则编辑必须回填规则类型')

    await page.goto(`${base}/governance/standards`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('挂号渠道标准') ?? false, '标准清单必须渲染')
    await page.getByRole('button', { name: /v1/ }).first().click()
    await page.waitForTimeout(400)
    record((await page.locator('main').textContent())?.includes('当前查看 v1') ?? false, '版本切换必须改变当前查看版本')
  }

  /* FE4 业务流（需要 mock 控制面）：资产页签、技术深链、MPI 队列检索。 */
  if (wantsFlow('fe4')) {
    await page.goto(`${base}/assets`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('数仓集群') ?? false, '资产目录实例名必须中文口径')
    await page.getByRole('tab', { name: /质量测试/ }).click()
    await page.waitForTimeout(400)
    record((await page.locator('main').textContent())?.includes('quality.ep.order.paystatus-range') ?? false, '质量测试页签必须读真实规则')

    await page.goto(`${base}/assets/technical?asset=doris-dataos.ods_ep.ep_mz_cfzb`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    const technical = await page.locator('main').textContent()
    record(technical?.includes('PRESCRIPTION_ID') ?? false, '技术视图必须渲染字段结构')
    record(technical?.includes('门诊就诊记录') ?? false, '技术视图必须渲染上游血缘')

    await page.goto(`${base}/mpi/review`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('陈测一短信一23 ↔ 陈测一104') ?? false, 'MPI 队列必须渲染候选对')
    await page.getByLabel('搜索复核候选').fill('张测三')
    await page.waitForTimeout(900)
    record((await page.locator('main').textContent())?.includes('张测三 ↔ 张测三') ?? false, 'MPI 搜索必须命中服务端返回的队列外候选')
  }

  /* FE5 业务流（需要 mock 控制面）：问数参数执行、服务发布、AI 评测、审计过滤。 */
  if (wantsFlow('fe5')) {
    await page.goto(`${base}/assistant`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: /查询每天的用药记录量/ }).first().click()
    await page.getByLabel('开始日期').fill('2026-11-01')
    await page.getByLabel('结束日期').fill('2026-11-09')
    await page.getByRole('button', { name: '按参数执行' }).click()
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('分析结果') ?? false, '问数执行后必须出现分析结果')

    await page.goto(`${base}/data-services`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: /检验结果日汇总/ }).first().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '发布', exact: true }).first().click()
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('已发布') ?? false, '发布后服务状态必须变为已发布')

    await page.goto(`${base}/ai-data?product=ai-prod-001`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: '评测' }).click()
    await page.waitForTimeout(700)
    record((await page.locator('body').textContent())?.includes('评测完成') ?? false, '评测动作必须给出结果回执')

    await page.goto(`${base}/assistant/workspace/audit`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.getByLabel('按结局过滤').selectOption('REFUSED_NO_MATCH')
    await page.waitForTimeout(600)
    const auditText = await page.locator('main').textContent()
    record(auditText?.includes('拒答·无匹配') ?? false, '审计结局过滤必须生效')
    record(auditText?.includes('查询每天的用药记录量') === false, '过滤后不应出现已回答记录')
  }

  /* FE6 业务流（需要 mock 控制面）：交付提交阻断、前置机登记、运营待办下钻。 */
  if (wantsFlow('fe6')) {
    await page.goto(`${base}/delivery-center`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: /患者主索引交付/ }).first().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '提交验收' }).click()
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('提交被阻断') ?? false, '无交付对象时提交必须逐项显示阻断原因')

    await page.goto(`${base}/operations`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: '登记前置机' }).click()
    const edgeDialog = page.getByRole('dialog')
    await edgeDialog.waitFor({ timeout: 5000 })
    await edgeDialog.getByLabel('名称').fill('QA 前置机')
    await edgeDialog.getByLabel('主机').fill('10.0.0.99')
    await edgeDialog.getByRole('button', { name: '保存前置机' }).click()
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('QA 前置机') ?? false, '新登记的前置机必须出现在列表')

    await page.goto(`${base}/operations-center`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    record((await page.locator('main').textContent())?.includes('住院病历每日同步 · 执行失败') ?? false, '运营中心必须渲染跨域待办')
  }
} finally {
  await browser.close()
  server?.kill('SIGTERM')
}

if (failures.length) {
  console.error(`browser smoke failed: ${failures.length} 项`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log(`browser smoke passed: ${checked.length} 次路由检查（${ROUTES.length} 路由 × ${widths.length} 宽度）`)

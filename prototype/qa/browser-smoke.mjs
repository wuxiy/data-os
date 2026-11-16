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
const shotsDir = flag('shots', null)
const routeArg = flag('routes', null)
const widths = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]

const ROUTES = routeArg
  ? String(routeArg).split(',').map((item) => item.trim()).filter(Boolean)
  : ['/', '/ingestion', '/governance', '/governance/standards', '/governance/mapping', '/governance/quality', '/mpi/review', '/assets', '/assets/technical', '/analysis', '/ai-data', '/data-services', '/assistant', '/assistant/workspace', '/operations-center', '/delivery-center', '/operations']

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
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
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
  if (args.includes('--flows')) {
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

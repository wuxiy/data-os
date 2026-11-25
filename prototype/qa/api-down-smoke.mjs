#!/usr/bin/env node
/**
 * 「控制面不可达」冒烟：把门户构建成指向一个无人监听的接口地址，用真实浏览器逐路由检查
 * 每个页面都落到真实的「不可用 / 待接入」状态——不崩溃、不白屏、没有应用自身的控制台异常。
 *
 * browser-smoke 覆盖的是接口正常（mock 控制面）的路径；这里补的是失败路径。
 * 背景（2026-11-24）：一次浮层迁移把 hook 提到了提前返回之后，接口正常时毫无征兆，
 * 接口不可达时整页崩溃（React #300），只有这条检查能拦住。
 *
 * 用法（在 prototype/ 下）：
 *   node qa/api-down-smoke.mjs                  # 全量路由（与 browser-smoke 共用 qa/routes.mjs）
 *   node qa/api-down-smoke.mjs --routes /,/ingestion
 *
 * 自行构建到系统临时目录并在结束后清理，不触碰 dist/。浏览器同 browser-smoke：
 * 优先系统 Chrome，缺失时回退到 Playwright 自带 chromium。
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { resolveRoutes } from './routes.mjs'

const args = process.argv.slice(2)
const routes = resolveRoutes(args.includes('--routes') ? args[args.indexOf('--routes') + 1] : null)
const root = resolve(new URL('..', import.meta.url).pathname)
const outDir = resolve(tmpdir(), 'dataos-portal-api-down')
const port = 4195
const base = `http://127.0.0.1:${port}`
const viewport = { width: 1440, height: 900 }

const failures = []
const record = (ok, message) => {
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

// 找一个确定无人监听的本机端口当「不可达的控制面」。
async function findClosedPort() {
  for (const candidate of [9, 1, 3]) {
    const open = await new Promise((resolveProbe) => {
      const socket = net.connect({ host: '127.0.0.1', port: candidate })
      socket.once('connect', () => { socket.destroy(); resolveProbe(true) })
      socket.once('error', () => resolveProbe(false))
    })
    if (!open) return candidate
  }
  throw new Error('常见丢弃端口均在监听，找不到可用的「不可达」端口')
}

function run(command, commandArgs, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, { cwd: root, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.once('error', rejectRun)
    child.once('exit', (code) => (code === 0 ? resolveRun(output) : rejectRun(new Error(`${command} ${commandArgs.join(' ')} 退出码 ${code}\n${output.slice(-2000)}`))))
  })
}

let server
let browser
try {
  const deadApi = `http://127.0.0.1:${await findClosedPort()}/api`
  process.stdout.write('正在构建指向不可达控制面的门户…\n')
  await run('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { ...process.env, VITE_DATAOS_API_BASE_URL: deadApi })
  server = spawn('npx', ['vite', 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
    env: process.env,
  })
  await waitForServer(`${base}/`)

  browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
  const context = await browser.newContext({ viewport, locale: 'zh-CN' })
  const page = await context.newPage()
  let consoleErrors = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // 接口连不上是本检查的前提，浏览器会把它记成资源加载失败，不算应用异常。
    if (text.startsWith('Failed to load resource') && /ERR_CONNECTION_REFUSED|net::ERR_/.test(text)) return
    consoleErrors.push(text)
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

  for (const route of routes) {
    consoleErrors = []
    const response = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
    record(Boolean(response && response.status() < 400), `${route} 返回 HTTP ${response?.status()}`)
    // 等主工作区出现并让失败的请求落定；接口不可达时页面应落到「不可用 / 待接入」而不是白屏。
    await page.waitForFunction(() => Boolean(document.querySelector('main')), null, { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(900)

    const snapshot = await page.evaluate(() => ({
      title: document.title,
      mainText: document.querySelector('main')?.textContent?.trim() ?? '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }))
    record(snapshot.title.includes('医数中枢'), `${route} 标题缺少站点名：${snapshot.title}`)
    record(snapshot.mainText.length > 20, `${route} 接口不可达时主工作区为空`)
    record(snapshot.overflow <= 1, `${route} 接口不可达时出现横向溢出 ${snapshot.overflow}px`)
    record(consoleErrors.length === 0, `${route} 接口不可达时控制台异常：${consoleErrors.slice(0, 2).join(' | ')}`)
  }
} catch (error) {
  failures.push(`检查未能完成：${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (server) server.kill()
  rmSync(outDir, { recursive: true, force: true })
}

for (const failure of failures) console.error(` - ${failure}`)
if (failures.length) {
  console.error(`api-down smoke failed: ${failures.length} 项`)
  process.exit(1)
}
console.log(`api-down smoke passed: ${routes.length} 次路由检查（控制面不可达）`)

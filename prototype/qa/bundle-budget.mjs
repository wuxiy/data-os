#!/usr/bin/env node
/**
 * 体积预算锁：读 dist/ 的构建产物，量「首屏闭包」（入口 chunk 及其静态导入链）的 gzip 体积，
 * 连同全部 JS 与 CSS 的 gzip 体积一起卡上限。
 *
 * 首屏闭包按产物里的静态 import 语句算，不看源码：vite.config.ts 的 manualChunks 分组一旦把
 * 只有页面才用到的库并进首屏分组，这里会立刻超预算（2026-11-25 改造收口时就是这样发现的：
 * 路由库依赖 react-store，首屏为此把整组表格与表单一起加载了）。
 * 超预算时先看超的是哪一项、闭包里多了哪个 chunk，再决定是修分组还是带着理由调上限。
 *
 * 用法（在 prototype/ 下，先 npm run build）：node qa/bundle-budget.mjs
 *   量别的构建目录：node qa/bundle-budget.mjs --dist <目录>（对照用，同样按上限判定）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(new URL('..', import.meta.url).pathname)
const args = process.argv.slice(2)
const dist = resolve(root, args.includes('--dist') ? args[args.indexOf('--dist') + 1] : 'dist')
const assetDir = resolve(dist, 'assets')
const KILOBYTE = 1024
// 上限单位 KB（gzip），定在实测值之上留约 7% 余量（CSS 留 15%）。调上限须在提交说明里写明原因。
const BUDGET_KB = { firstLoadJs: 235, totalJs: 520, css: 34 }

assert(existsSync(assetDir), `找不到构建产物目录：${assetDir}（先 npm run build）`)
const names = readdirSync(assetDir)
const jsFiles = names.filter((name) => name.endsWith('.js'))
const cssFiles = names.filter((name) => name.endsWith('.css'))
const code = Object.fromEntries([...jsFiles, ...cssFiles].map((name) => [name, readFileSync(resolve(assetDir, name), 'utf8')]))
const gzipped = Object.fromEntries(Object.entries(code).map(([name, text]) => [name, gzipSync(Buffer.from(text), { level: 9 }).length]))
const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
const entry = html.match(/<script[^>]*type="module"[^>]*src="[^"]*\/?assets\/([^"/]+\.js)"/)?.[1]

const failures = []
if (!entry || !jsFiles.includes(entry)) {
  console.error(` - ${dist}/index.html 没有引用 assets/ 下的入口脚本：先 npm run build`)
  process.exit(1)
}

// 只认静态 import：`import"./x.js"`、`import{…}from"./x.js"`；动态 import("./x.js") 不算。
const staticImports = (name) => [...code[name].matchAll(/(?:^|[;,{}])import\s*(?:\{[^}]*\}|\*\s*as\s+[\w$]+)?\s*(?:from\s*)?"\.\/([^"/]+\.js)"/g)].map((match) => match[1])
const closure = new Set([entry])
for (const name of closure) {
  for (const dependency of staticImports(name)) {
    if (!closure.has(dependency) && jsFiles.includes(dependency)) closure.add(dependency)
  }
}

const kb = (bytes) => (bytes / KILOBYTE).toFixed(1)
const sum = (files) => files.reduce((total, name) => total + gzipped[name], 0)
const firstLoadJs = sum([...closure])
const totalJs = sum(jsFiles)
const css = sum(cssFiles)

const describeClosure = () => [...closure]
  .sort((a, b) => gzipped[b] - gzipped[a])
  .map((name) => `${name.replace(/-[A-Za-z0-9_-]+\.js$/, '')}=${kb(gzipped[name])}KB`)
  .join('、')

if (firstLoadJs > BUDGET_KB.firstLoadJs * KILOBYTE) {
  failures.push(`首屏闭包 JS ${kb(firstLoadJs)} KB 超过上限 ${BUDGET_KB.firstLoadJs} KB。闭包：${describeClosure()}。多半是 vite.config.ts 的 manualChunks 把只有页面才用到的库并进了首屏分组`)
}
if (totalJs > BUDGET_KB.totalJs * KILOBYTE) failures.push(`全部 JS ${kb(totalJs)} KB 超过上限 ${BUDGET_KB.totalJs} KB（${jsFiles.length} 个 chunk）`)
if (css > BUDGET_KB.css * KILOBYTE) failures.push(`CSS ${kb(css)} KB 超过上限 ${BUDGET_KB.css} KB`)

if (failures.length) {
  console.error(`量测：首屏 JS ${kb(firstLoadJs)} KB · 全部 JS ${kb(totalJs)} KB（${jsFiles.length} 个 chunk）· CSS ${kb(css)} KB`)
  for (const failure of failures) console.error(` - ${failure}`)
  console.error(`bundle budget failed: ${failures.length} 项`)
  process.exit(1)
}
console.log(`bundle budget passed: 首屏 JS ${kb(firstLoadJs)} KB（上限 ${BUDGET_KB.firstLoadJs}）· 全部 JS ${kb(totalJs)} KB（上限 ${BUDGET_KB.totalJs}）· CSS ${kb(css)} KB（上限 ${BUDGET_KB.css}）${args.includes('--dist') ? ` · ${dist}` : ''}`)

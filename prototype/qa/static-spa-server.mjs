#!/usr/bin/env node
/**
 * 本地隔离静态服务器（FE7 切换演练）：SPA 回退到 index.html，每次请求都从磁盘读取，
 * 不缓存——目录内容被替换后立即生效，用来演练“旧新包切换 + hash 变化 + 深链可用”，
 * 对应生产 runbook 的原子替换与（必要时）force-recreate 步骤。
 *
 * 用法：node qa/static-spa-server.mjs <dist 目录> [端口]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? 'dist')
const port = Number(process.argv[3] ?? 4190)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    let file = join(dir, pathname)
    if (!(await stat(file).catch(() => null))?.isFile()) file = join(dir, 'index.html') // SPA 回退
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(body)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`static spa server: ${dir} on http://127.0.0.1:${port}`)
})

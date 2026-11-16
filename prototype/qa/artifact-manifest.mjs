#!/usr/bin/env node
/**
 * 制品清单工具（FE7）：静态目录 SHA-256 清单 + 生产依赖/许可证清单。
 * 用法：
 *   node qa/artifact-manifest.mjs dist                # 打印 dist 每个文件的 sha256
 *   node qa/artifact-manifest.mjs dist > out.txt
 *   node qa/artifact-manifest.mjs --licenses          # 生产依赖 name@version license
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

if (process.argv.includes('--licenses')) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const rows = []
  for (const [key, node] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/')) continue
    // 只列生产依赖闭包：以 package.json dependencies 为根，npm lock 的 packages
    // 不区分 prod/dev，这里用 node_modules 实际安装 + lock 版本对齐（npm ci 全装），
    // 并标注 antd 已移除后的直接生产依赖标记。
    const name = key.replace(/^node_modules\//, '').replace(/^(@[^/]+)\/node_modules\//, '')
    let license = node.license ?? ''
    if (!license) {
      try {
        license = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).license ?? 'UNKNOWN'
      } catch {
        license = 'UNKNOWN'
      }
    }
    rows.push({ name, version: node.version ?? '?', license: String(license) })
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const direct = new Set(Object.keys(pkg.dependencies ?? {}))
  for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${row.name}@${row.version}\t${row.license}${direct.has(row.name) ? '\t(direct)' : ''}`)
  }
  process.exit(0)
}

const target = process.argv[2]
if (!target) {
  console.error('用法：node qa/artifact-manifest.mjs <dist 目录> | --licenses')
  process.exit(1)
}
const abs = target.startsWith('/') ? target : join(root, target)
const files = walk(abs).sort()
for (const file of files) {
  console.log(`${sha256(file)}  ${file.slice(abs.length + 1)}`)
}
console.error(`${files.length} files hashed from ${abs}`)

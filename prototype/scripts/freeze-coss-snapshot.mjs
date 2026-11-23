#!/usr/bin/env node
/**
 * 冻结 coss ui 注册表快照：把用到的组件项（含注册表依赖闭包）与作为实现蓝本的
 * 粒子原样入库，并登记 sha256。coss 仍在早期、注册表内容会变——CI 不拉取；
 * 升级时重跑本脚本，单独提交并重新验收。
 *
 * 用法（在 prototype/ 下）：
 *   node scripts/freeze-coss-snapshot.mjs           拉取快照并重写 manifest.json
 *   node scripts/freeze-coss-snapshot.mjs --verify  只读校验：已安装的源码是否与快照一致
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT_DIR = join(ROOT, 'coss-registry-snapshot')
const LICENSE_URL = 'https://raw.githubusercontent.com/cosscom/ui/main/LICENSE'
const registryUrl = (name) => `https://coss.com/ui/r/${name}.json`

/** 业务改造直接用到的 coss 组件；其余由注册表依赖闭包自动带入。 */
const SEED_COMPONENTS = [
  'alert', 'alert-dialog', 'avatar', 'badge', 'breadcrumb', 'button', 'calendar', 'checkbox',
  'checkbox-group', 'collapsible', 'command', 'dialog', 'drawer', 'empty', 'field', 'fieldset',
  'frame', 'input', 'input-group', 'kbd', 'label', 'menu', 'pagination', 'popover', 'radio-group',
  'scroll-area', 'segmented-control', 'select', 'separator', 'sidebar', 'skeleton', 'spinner',
  'table', 'tabs', 'textarea', 'toast', 'toggle', 'toggle-group', 'tooltip',
]

/** 进了闭包但不安装的组件项（粒子蓝本的依赖）：名称 → 不安装的原因。 */
const NOT_INSTALLED = {
  form: 'coss Form 以 zod 校验为主；项目表单直接组合 Field，不引入 zod',
}

/** 实现蓝本（粒子）：只入库，不安装。 */
const SEED_PARTICLES = [
  'p-alert-dialog-1', 'p-avatar-2', 'p-badge-16', 'p-badge-17', 'p-badge-18', 'p-breadcrumb-2',
  'p-calendar-17', 'p-checkbox-5', 'p-collapsible-1', 'p-command-1', 'p-dialog-1', 'p-drawer-3',
  'p-drawer-6', 'p-empty-1', 'p-field-18', 'p-frame-3', 'p-menu-1', 'p-pagination-3',
  'p-radio-group-8', 'p-select-23', 'p-table-3', 'p-table-4', 'p-tabs-2', 'p-date-picker-5',
  'p-toast-2', 'p-toggle-group-1', 'p-tooltip-1',
]

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

async function fetchWithRetry(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise((done) => setTimeout(done, 1500 * attempt))
    }
  }
  throw new Error(`拉取失败：${url}（${lastError?.message}）`)
}

/** 拆 `registryDependencies`：`@coss/x` 与裸组件名进闭包，其余（如 utils）归属默认注册表，只登记。 */
function splitDependencies(item) {
  const coss = []
  const external = []
  for (const entry of item.registryDependencies ?? []) {
    const name = String(entry).replace(/^@coss\//, '')
    if (entry === `@coss/${name}`) coss.push(name)
    else if (/^[a-z0-9-]+$/.test(name) && name !== 'utils') coss.push(name)
    else external.push(entry)
  }
  return { coss, external }
}

async function freeze() {
  const components = new Map()
  const particles = new Map()
  const defaultRegistryDependencies = new Set()

  async function collect(name, store, subdirectory) {
    if (store.has(name)) return
    const url = registryUrl(name)
    process.stdout.write(`  拉取 ${name}\n`)
    const bytes = await fetchWithRetry(url)
    const item = JSON.parse(bytes.toString('utf8'))
    const file = join(subdirectory, `${name}.json`)
    writeFileSync(join(SNAPSHOT_DIR, file), bytes)
    const { coss, external } = splitDependencies(item)
    external.forEach((dependency) => defaultRegistryDependencies.add(dependency))
    store.set(name, {
      name,
      url,
      file,
      sha256: sha256(bytes),
      bytes: bytes.length,
      type: item.type,
      dependencies: item.dependencies ?? [],
      registryDependencies: item.registryDependencies ?? [],
    })
    // 粒子依赖的组件一律归入组件集（快照根目录），不混进 particles/。
    for (const dependency of coss) {
      await collect(dependency, subdirectory === '.' ? store : components, '.')
    }
  }

  mkdirSync(join(SNAPSHOT_DIR, 'particles'), { recursive: true })
  for (const name of SEED_COMPONENTS) await collect(name, components, '.')
  for (const name of SEED_PARTICLES) await collect(name, particles, 'particles')

  process.stdout.write('  拉取 LICENSE\n')
  const license = (await fetchWithRetry(LICENSE_URL)).toString('utf8')
  if (!/^MIT License\b/.test(license) || !/coss\.com/.test(license)) {
    throw new Error('上游 LICENSE 不是预期的 MIT 文本，停止冻结并人工核对')
  }
  writeFileSync(join(SNAPSHOT_DIR, 'LICENSE'), license)

  const kept = new Set([...components.values(), ...particles.values()].map((item) => item.file))
  for (const relative of ['.', 'particles']) {
    const directory = join(SNAPSHOT_DIR, relative)
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith('.json') || entry === 'manifest.json') continue
      const file = join(relative, entry)
      if (!kept.has(file)) rmSync(join(SNAPSHOT_DIR, file))
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name)
  const manifest = {
    schema: 1,
    namespace: '@coss',
    registry: 'https://coss.com/ui/r/{name}.json',
    upstream: 'https://github.com/cosscom/ui',
    license: 'MIT',
    licenseFile: 'LICENSE',
    fetchedAt: new Date().toISOString(),
    note: [
      'coss ui 注册表项的冻结快照。CI 不拉取；升级时重跑 scripts/freeze-coss-snapshot.mjs，',
      '经 shadcn CLI 重新安装后执行 --verify，单独提交并重新验收。',
      '组件项以原样装入 src/components/ui（仅导入路径按 components.json 别名改写）；',
      '粒子只作实现蓝本入库，不安装。',
    ].join(''),
    defaultRegistryDependencies: [...defaultRegistryDependencies].sort(),
    notInstalled: NOT_INSTALLED,
    components: [...components.values()].sort(byName),
    particles: [...particles.values()].sort(byName),
  }
  writeFileSync(join(SNAPSHOT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`已冻结 ${manifest.components.length} 个组件项、${manifest.particles.length} 个粒子`)
}

/** 去掉空白与分号、统一引号，忽略格式化差异；再把 CLI 的别名改写还原成注册表原文。 */
function normalize(source, undoAliasRewrite) {
  let text = source
  if (undoAliasRewrite) {
    text = text
      .replaceAll('@/components/ui/', '@/registry/default/ui/')
      .replaceAll('@/hooks/', '@/registry/default/hooks/')
      .replaceAll('@/lib/utils', '@/registry/default/lib/utils')
  }
  return text.replace(/\s+/g, '').replace(/;/g, '').replace(/'/g, '"')
}

function verify() {
  const manifest = JSON.parse(readFileSync(join(SNAPSHOT_DIR, 'manifest.json'), 'utf8'))
  const problems = []
  const skipped = []
  let compared = 0
  for (const item of manifest.components) {
    const bytes = readFileSync(join(SNAPSHOT_DIR, item.file))
    if (sha256(bytes) !== item.sha256) {
      problems.push(`${item.name}.json 与 manifest 登记的 sha256 不符`)
      continue
    }
    if (manifest.notInstalled?.[item.name]) {
      skipped.push(item.name)
      continue
    }
    const parsed = JSON.parse(bytes.toString('utf8'))
    for (const entry of parsed.files ?? []) {
      const target = entry.path
        .replace(/^registry\/default\/ui\//, 'src/components/ui/')
        .replace(/^registry\/default\/hooks\//, 'src/hooks/')
      // src/lib/utils.ts 是项目自有文件（cn 带自定义字号合并组），不与上游比对。
      if (target === entry.path || target === 'src/lib/utils.ts') continue
      const installedPath = join(ROOT, target)
      if (!existsSync(installedPath)) {
        problems.push(`${item.name}：${target} 未安装`)
        continue
      }
      compared += 1
      const expected = normalize(entry.content, false)
      const actual = normalize(readFileSync(installedPath, 'utf8'), true)
      if (expected !== actual) {
        let offset = 0
        while (offset < expected.length && expected[offset] === actual[offset]) offset += 1
        problems.push(
          `${item.name}：${target} 与快照不一致（首个差异在第 ${offset} 字符）：` +
            `快照「${expected.slice(offset, offset + 60)}」 已安装「${actual.slice(offset, offset + 60)}」`,
        )
      }
    }
  }
  if (problems.length) {
    console.error(`coss 快照校验失败：${problems.length} 项`)
    for (const problem of problems) console.error(` - ${problem}`)
    process.exit(1)
  }
  console.log(
    `coss 快照校验通过：${manifest.components.length} 项登记完整，${compared} 个已安装源文件与快照一致` +
      (skipped.length ? `（未安装：${skipped.join('、')}）` : ''),
  )
}

if (process.argv.includes('--verify')) {
  verify()
} else {
  await freeze()
}

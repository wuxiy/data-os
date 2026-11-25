#!/usr/bin/env node
/**
 * 盘点 coss 源码（src/components/ui）依赖的语义令牌、CSS 变量与工具类族。
 * 升级 coss 后先跑一遍：若出现 styles/tokens.css 令牌桥里没有的令牌，先补桥再验收。
 *
 * 用法（在 prototype/ 下）：
 *   node scripts/coss-token-inventory.mjs .                  总览
 *   node scripts/coss-token-inventory.mjs . background card  某个令牌被哪些组件怎样使用
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[2]
const only = process.argv.slice(3)
const dir = join(root, 'src/components/ui')
const sources = readdirSync(dir)
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => ({ file: basename(file, '.tsx'), text: readFileSync(join(dir, file), 'utf8') }))
const text = sources.map((entry) => entry.text).join('\n')

if (only.length) {
  for (const token of only) {
    console.log(`\n## ${token}`)
    const usage = new Map()
    for (const entry of sources) {
      const pattern = new RegExp(`(?<![\\w-])((?:[a-z]+-)*${token}(?:/[0-9]+)?)(?![\\w-])`, 'g')
      for (const match of entry.text.matchAll(pattern)) {
        if (!usage.has(match[1])) usage.set(match[1], new Set())
        usage.get(match[1]).add(entry.file)
      }
    }
    for (const [utility, owners] of [...usage].sort()) {
      console.log(`  ${utility.padEnd(34)} ${[...owners].join(' ')}`)
    }
  }
} else {
  const collect = (pattern) => [...new Set([...text.matchAll(pattern)].map((match) => match[1]))].sort()
  const section = (title, items) => console.log(`\n## ${title} (${items.length})\n${items.join('  ')}`)

  section('语义令牌', collect(/\b(?:bg|text|border|ring|outline|outline-offset|fill|stroke|shadow|inset-shadow|inset-ring|from|to|caret|divide|placeholder|accent|decoration|scheme)-((?:background|foreground|card|popover|primary|secondary|muted|accent|destructive|info|success|warning|border|input|ring|sidebar)[\w-]*)(?=[\s"'`)\]}+,])/g))
  section('直接读取的 CSS 变量', collect(/var\((--[\w-]+)(\s*,[^)]*)?\)/g))
  section('圆角工具类', collect(/\brounded-([\w[\]().-]+)/g))
  section('animate-*', collect(/\banimate-([\w-]+(?:-\[[^\]]+\])?)/g))
  section('调色板类（应为空：品牌色只经语义令牌进入）', collect(/(?<![\w-])((?:neutral|red|blue|emerald|amber|green|black|white|gray|zinc|slate|stone|orange|teal|cyan|purple|rose)(?:-\d{2,3})?(?:\/\d+)?)(?=[\s"')\]}]+)/g))
  section('--theme()', collect(/--theme\(([^)]+)\)/g))
}

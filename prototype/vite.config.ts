import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // coss ui 源码按 shadcn 约定从 `@/components/ui/*`、`@/lib/utils` 导入。
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      output: {
        // 图标按需进入各懒加载页会产生大量 0.3KB 碎片；归并成一个 icons chunk，
        // 离线安装与 hash 清单都更好核对（不影响按页懒加载）。
        // 手工分组的 chunk 只要被入口引用就整块进入首屏，所以只把首屏真正要用的库放进来；
        // 分组对不对以 qa/bundle-budget.mjs 量出的首屏闭包为准。
        manualChunks(id: string) {
          // 按包名精确匹配：子串匹配会漏掉 react-table / react-form 这类封装包。
          const pkg = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]
          if (pkg === 'lucide-react') return 'icons'
          // react 显式归入首屏分组：没被认领的依赖会被 Rollup 并进第一个引用它的手工分组。
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor'
          // 表格与表单只有按需页面用到，单独成组、跟着页面加载。react-store 不在此列：路由库自己依赖它。
          const lazyOnly = ['@tanstack/table-core', '@tanstack/react-table', '@tanstack/form-core', '@tanstack/react-form']
          if (pkg && lazyOnly.includes(pkg)) return 'tables-forms'
          // Base UI 不手工分组，由 Rollup 按实际引用拆分，下拉、抽屉、页签等页面才用的部件不进首屏。
          return pkg?.startsWith('@tanstack/') || pkg === 'use-sync-external-store' ? 'vendor' : undefined
        },
        // 合并过小的 chunk：按引用关系拆出来的 Base UI 部件会产生一批不足 2KB 的碎片。
        experimentalMinChunkSize: 4000,
      },
    },
  },
})

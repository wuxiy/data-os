import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      output: {
        // 图标按需进入各懒加载页会产生大量 0.3KB 碎片；归并成一个 icons chunk，
        // 离线安装与 hash 清单都更好核对（不影响按页懒加载）。
        manualChunks(id: string) {
          if (id.includes('node_modules/lucide-react')) return 'icons'
          if (id.includes('node_modules/@tanstack/') || id.includes('node_modules/@base-ui/')) return 'vendor'
        },
      },
    },
  },
})

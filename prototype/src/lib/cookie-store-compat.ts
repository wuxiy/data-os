/**
 * coss ui 的 Sidebar 沿用 Next.js 约定，经全局 `cookieStore` 记住折叠状态。
 * 浏览器端默认没有这个全局，这里按同一 API 形状补上，使 `components/ui` 下的
 * coss 源码保持原样（升级时只需重跑 CLI 与快照校验）。幂等。
 */
interface CookieRecord {
  name: string
  value: string
  path?: string
  expires?: number
}

type CookieStoreHost = typeof globalThis & {
  cookieStore?: { set(record: CookieRecord): Promise<void> }
}

export function installCookieStoreCompat() {
  const host = globalThis as CookieStoreHost
  host.cookieStore ??= {
    set: async ({ name, value, path = '/', expires }: CookieRecord) => {
      const suffix = expires ? `; expires=${new Date(expires).toUTCString()}` : ''
      document.cookie = `${name}=${encodeURIComponent(value)}; path=${path}${suffix}`
    },
  }
}

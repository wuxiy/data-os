/**
 * coss ui sidebar 依赖的全局 `cookieStore`（Next.js 约定）的类型声明。
 * 运行时实现由 lib/cookie-store-compat 的 installCookieStoreCompat 提供。
 */
declare const cookieStore: {
  set(record: { name: string; value: string; path?: string; expires?: number }): Promise<void>
}

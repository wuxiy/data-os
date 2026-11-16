import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * 站内导航唯一入口：用 href 形式交给 Router 处理，避免页面手拼 `to`/`params`。
 * 参数化深链、带 search 的深链与静态路径都走同一条路。
 */
export function usePortalNavigate() {
  const navigate = useNavigate()
  return useCallback((href: string, options?: { replace?: boolean }) => {
    void navigate({ href, replace: options?.replace })
  }, [navigate])
}

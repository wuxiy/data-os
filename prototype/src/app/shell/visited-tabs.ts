import { useCallback, useEffect, useState } from 'react'
import { routeForPath } from '../navigation'

/** 页签按 pathname 去重：同一任务的概览/配置/调度属于同一页签，只更新 search。 */
const pathnameOf = (path: string) => path.split('?')[0]

const STORAGE_KEY = 'dataos.portal.tabs'
const HOME = '/'

function readTabs(): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return [HOME]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [HOME]
    const paths = parsed.filter((item): item is string => typeof item === 'string' && item.startsWith('/'))
    return paths.includes(HOME) ? paths : [HOME, ...paths]
  } catch {
    return [HOME]
  }
}

/**
 * 顶栏页签：只保存会话内的路由路径，不保存检索词、对象参数之外的内容，
 * 也不做全站 KeepAlive（未保存编辑由路由级 useDirtyLeaveGuard 统一拦截）。
 */
export function useVisitedTabs(pathname: string) {
  const [tabs, setTabs] = useState<string[]>(readTabs)

  useEffect(() => {
    setTabs((current) => {
      const index = current.findIndex((path) => pathnameOf(path) === pathnameOf(pathname))
      if (index === -1) return [...current, pathname]
      if (current[index] === pathname) return current
      const next = [...current]
      next[index] = pathname
      return next
    })
  }, [pathname])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
    } catch {
      // 会话存储不可用时页签退化为内存状态，不影响业务。
    }
  }, [tabs])

  const closeTab = useCallback((path: string) => {
    setTabs((current) => current.filter((item) => item !== path || pathnameOf(item) === HOME))
  }, [])

  return {
    tabs: tabs.map((path) => {
      const pathname = pathnameOf(path)
      const route = routeForPath(pathname)
      const base = route?.tabLabel ?? route?.label ?? '工作区'
      // 同一模式打开多个对象时用对象键短号区分页签（如两个采集任务）。
      const objectKey = route?.pattern ? pathname.split('/').filter(Boolean).at(-1) : undefined
      return {
        path,
        label: objectKey ? `${base} · ${objectKey.slice(0, 8)}` : base,
        closable: pathname !== HOME,
      }
    }),
    closeTab,
  }
}

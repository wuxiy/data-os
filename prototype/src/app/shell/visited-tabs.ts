import { useCallback, useEffect, useState } from 'react'
import { routeForPath } from '../navigation'

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
 * 也不做全站 KeepAlive（未保存编辑由 blocker 处理）。
 */
export function useVisitedTabs(pathname: string) {
  const [tabs, setTabs] = useState<string[]>(readTabs)

  useEffect(() => {
    setTabs((current) => (current.includes(pathname) ? current : [...current, pathname]))
  }, [pathname])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
    } catch {
      // 会话存储不可用时页签退化为内存状态，不影响业务。
    }
  }, [tabs])

  const closeTab = useCallback((path: string) => {
    setTabs((current) => current.filter((item) => item !== path || item === HOME))
  }, [])

  return {
    tabs: tabs.map((path) => ({
      path,
      label: routeForPath(path)?.tabLabel ?? routeForPath(path)?.label ?? '工作区',
      closable: path !== HOME,
    })),
    closeTab,
  }
}

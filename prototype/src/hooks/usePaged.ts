import { useState } from 'react'

/**
 * 客户端分页派生：页码在数据收缩（筛选/刷新）后自动钳制到有效区间。
 * 搜索等入口重置页码时直接调用 setPage(0)。
 */
export function usePaged<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const paged = items.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  return { page: currentPage, setPage, paged, pageCount }
}

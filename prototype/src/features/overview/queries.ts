import { queryOptions } from '@tanstack/react-query'

import { fetchOperationsEvents, fetchOperationsSummary, fetchWorkItems } from '../../data/operationsApi'

/**
 * 运营投影 Query 选项：总览与运营中心共用同一事实源与同一缓存键。
 * 键只含资源类型与筛选，不含自由文本；staleTime 由会话 Client 默认值控制。
 */
export const operationsKeys = {
  all: ['operations'] as const,
  summary: () => [...operationsKeys.all, 'summary'] as const,
  workItems: (type: string) => [...operationsKeys.all, 'work-items', type] as const,
  events: () => [...operationsKeys.all, 'events'] as const,
}

export const operationsSummaryQuery = () => queryOptions({
  queryKey: operationsKeys.summary(),
  queryFn: ({ signal }) => fetchOperationsSummary(signal),
})

export const operationsWorkItemsQuery = (type = '') => queryOptions({
  queryKey: operationsKeys.workItems(type),
  queryFn: ({ signal }) => fetchWorkItems(signal, type),
})

export const operationsEventsQuery = () => queryOptions({
  queryKey: operationsKeys.events(),
  queryFn: ({ signal }) => fetchOperationsEvents(signal),
})

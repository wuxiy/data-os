import { queryOptions } from '@tanstack/react-query'
import {
  fetchDataServiceCalls,
  fetchDataServiceContractEvents,
  fetchDataServiceDetail,
  fetchDataServiceExports,
  fetchDataServiceOverview,
  fetchDataServiceSubscriptions,
  fetchDataServices,
} from '../../data/dataServicesApi'

/** 数据服务域 Query：清单、概览与从属资源各自独立缓存与失败。 */
export const dataServiceKeys = {
  all: ['data-services'] as const,
  list: () => [...dataServiceKeys.all, 'list'] as const,
  overview: () => [...dataServiceKeys.all, 'overview'] as const,
  detail: (id: string) => [...dataServiceKeys.all, 'detail', id] as const,
  calls: (id: string) => [...dataServiceKeys.all, 'calls', id] as const,
  exports: (id: string) => [...dataServiceKeys.all, 'exports', id] as const,
  contractEvents: (id: string) => [...dataServiceKeys.all, 'contract-events', id] as const,
  subscriptions: (id: string) => [...dataServiceKeys.all, 'subscriptions', id] as const,
}

export const dataServicesQuery = () => queryOptions({
  queryKey: dataServiceKeys.list(),
  queryFn: ({ signal }) => fetchDataServices(signal),
})

export const dataServiceOverviewQuery = () => queryOptions({
  queryKey: dataServiceKeys.overview(),
  queryFn: ({ signal }) => fetchDataServiceOverview(signal),
})

export const dataServiceDetailQuery = (id: string) => queryOptions({
  queryKey: dataServiceKeys.detail(id),
  queryFn: ({ signal }) => fetchDataServiceDetail(id, signal),
  enabled: Boolean(id),
})

export const dataServiceCallsQuery = (id: string) => queryOptions({
  queryKey: dataServiceKeys.calls(id),
  queryFn: ({ signal }) => fetchDataServiceCalls(id, signal),
  enabled: Boolean(id),
})

export const dataServiceExportsQuery = (id: string) => queryOptions({
  queryKey: dataServiceKeys.exports(id),
  queryFn: ({ signal }) => fetchDataServiceExports(id, signal),
  enabled: Boolean(id),
})

export const dataServiceContractEventsQuery = (id: string) => queryOptions({
  queryKey: dataServiceKeys.contractEvents(id),
  queryFn: ({ signal }) => fetchDataServiceContractEvents(id, signal),
  enabled: Boolean(id),
})

export const dataServiceSubscriptionsQuery = (id: string) => queryOptions({
  queryKey: dataServiceKeys.subscriptions(id),
  queryFn: ({ signal }) => fetchDataServiceSubscriptions(id, signal),
  enabled: Boolean(id),
})

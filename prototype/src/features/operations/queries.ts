import { queryOptions } from '@tanstack/react-query'
import { fetchEdgeDeployments, fetchEdgeNodes, fetchEdgeWatermarks, fetchPlatformOperations } from '../../data/controlPlane'
import { fetchDeliveryDetail, fetchDeliveries } from '../../data/deliveryApi'
import { fetchOperationsEvents, fetchOperationsSummary, fetchWorkItems } from '../../data/operationsApi'

/** 运营/交付/运维域 Query 键。 */
export const operationsKeys = {
  all: ['operations'] as const,
  summary: () => [...operationsKeys.all, 'summary'] as const,
  workItems: (type: string) => [...operationsKeys.all, 'work-items', type] as const,
  events: () => [...operationsKeys.all, 'events'] as const,
  deliveries: (query: string) => [...operationsKeys.all, 'deliveries', query] as const,
  delivery: (id: string) => [...operationsKeys.all, 'delivery', id] as const,
  platform: () => [...operationsKeys.all, 'platform'] as const,
  edgeNodes: () => [...operationsKeys.all, 'edge-nodes'] as const,
  edgeDeployments: (nodeId: string) => [...operationsKeys.all, 'edge-deployments', nodeId] as const,
  edgeWatermarks: () => [...operationsKeys.all, 'edge-watermarks'] as const,
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

export const deliveriesQuery = (query = '') => queryOptions({
  queryKey: operationsKeys.deliveries(query),
  queryFn: ({ signal }) => fetchDeliveries(signal, query),
})

export const deliveryDetailQuery = (id: string) => queryOptions({
  queryKey: operationsKeys.delivery(id),
  queryFn: ({ signal }) => fetchDeliveryDetail(signal, id),
  enabled: Boolean(id),
})

export const platformOperationsQuery = () => queryOptions({
  queryKey: operationsKeys.platform(),
  queryFn: ({ signal }) => fetchPlatformOperations(signal),
  refetchInterval: 30_000,
})

export const edgeNodesQuery = () => queryOptions({
  queryKey: operationsKeys.edgeNodes(),
  queryFn: ({ signal }) => fetchEdgeNodes(signal),
})

export const edgeDeploymentsQuery = (nodeId: string) => queryOptions({
  queryKey: operationsKeys.edgeDeployments(nodeId),
  queryFn: ({ signal }) => fetchEdgeDeployments(nodeId, signal),
  enabled: Boolean(nodeId),
})

export const edgeWatermarksQuery = () => queryOptions({
  queryKey: operationsKeys.edgeWatermarks(),
  queryFn: ({ signal }) => fetchEdgeWatermarks(signal),
})

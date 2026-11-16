import { queryOptions } from '@tanstack/react-query'
import {
  fetchAssetQualityTests,
  fetchLineageAsset,
  fetchLineageCatalog,
  fetchLineageGraph,
  fetchLineageSummary,
} from '../../data/lineageApi'

/** 资产域 Query：目录按库、详情按 FQN、从属资源各自独立失败。 */
export const assetKeys = {
  all: ['assets'] as const,
  summary: () => [...assetKeys.all, 'summary'] as const,
  catalog: (schema: string) => [...assetKeys.all, 'catalog', schema] as const,
  detail: (fqn: string) => [...assetKeys.all, 'detail', fqn] as const,
  lineage: (fqn: string) => [...assetKeys.all, 'lineage', fqn] as const,
  qualityTests: (fqn: string) => [...assetKeys.all, 'quality-tests', fqn] as const,
}

export const lineageSummaryQuery = () => queryOptions({
  queryKey: assetKeys.summary(),
  queryFn: ({ signal }) => fetchLineageSummary(signal),
  staleTime: 5 * 60_000,
})

export const assetCatalogQuery = (schema: string) => queryOptions({
  queryKey: assetKeys.catalog(schema),
  queryFn: ({ signal }) => fetchLineageCatalog(schema, signal),
})

export const assetDetailQuery = (fqn: string) => queryOptions({
  queryKey: assetKeys.detail(fqn),
  queryFn: ({ signal }) => fetchLineageAsset(fqn, signal),
  enabled: Boolean(fqn),
})

export const assetLineageQuery = (fqn: string) => queryOptions({
  queryKey: assetKeys.lineage(fqn),
  queryFn: ({ signal }) => fetchLineageGraph(fqn, signal),
  enabled: Boolean(fqn),
})

export const assetQualityTestsQuery = (fqn: string) => queryOptions({
  queryKey: assetKeys.qualityTests(fqn),
  queryFn: ({ signal }) => fetchAssetQualityTests(fqn, signal),
  enabled: Boolean(fqn),
})

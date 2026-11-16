import { queryOptions } from '@tanstack/react-query'
import {
  fetchGovernanceIssue,
  fetchGovernanceIssues,
  fetchGovernanceSummary,
  fetchQualityRuleTypes,
  fetchQualityRules,
  fetchQualityScore,
} from '../../data/controlPlane'
import {
  fetchMappingCoverage,
  fetchMappingDetail,
  fetchMappingSets,
  fetchMappingImpact,
} from '../../data/mappingApi'
import {
  fetchStandardDetail,
  fetchStandards,
  fetchVersionImpact,
} from '../../data/standardsApi'

/** 治理域 Query 键：问题、规则、评分、标准与映射各自独立失效。 */
export const governanceKeys = {
  all: ['governance'] as const,
  summary: () => [...governanceKeys.all, 'summary'] as const,
  issues: (status: string, query: string) => [...governanceKeys.all, 'issues', status, query] as const,
  issue: (issueId: string) => [...governanceKeys.all, 'issue', issueId] as const,
  ruleTypes: () => [...governanceKeys.all, 'rule-types'] as const,
  rules: () => [...governanceKeys.all, 'rules'] as const,
  score: () => [...governanceKeys.all, 'score'] as const,
  standards: (query: string, status: string) => [...governanceKeys.all, 'standards', query, status] as const,
  standard: (id: string, versionId: string) => [...governanceKeys.all, 'standard', id, versionId] as const,
  standardImpact: (versionId: string) => [...governanceKeys.all, 'standard-impact', versionId] as const,
  mappings: (query: string) => [...governanceKeys.all, 'mappings', query] as const,
  mapping: (setId: string, versionId: string) => [...governanceKeys.all, 'mapping', setId, versionId] as const,
  mappingCoverage: () => [...governanceKeys.all, 'mapping-coverage'] as const,
  mappingImpact: (versionId: string) => [...governanceKeys.all, 'mapping-impact', versionId] as const,
}

export const governanceSummaryQuery = () => queryOptions({
  queryKey: governanceKeys.summary(),
  queryFn: ({ signal }) => fetchGovernanceSummary(signal),
})

export const governanceIssuesQuery = (status = '', query = '') => queryOptions({
  queryKey: governanceKeys.issues(status, query),
  queryFn: ({ signal }) => fetchGovernanceIssues({ status: status || undefined, query: query || undefined, signal }),
})

export const governanceIssueQuery = (issueId: string | null) => queryOptions({
  queryKey: governanceKeys.issue(issueId ?? ''),
  queryFn: ({ signal }) => fetchGovernanceIssue(issueId as string, signal),
  enabled: Boolean(issueId),
})

export const qualityRuleTypesQuery = () => queryOptions({
  queryKey: governanceKeys.ruleTypes(),
  queryFn: ({ signal }) => fetchQualityRuleTypes(signal),
  staleTime: 10 * 60_000,
})

export const qualityRulesQuery = () => queryOptions({
  queryKey: governanceKeys.rules(),
  queryFn: ({ signal }) => fetchQualityRules(signal),
})

export const qualityScoreQuery = () => queryOptions({
  queryKey: governanceKeys.score(),
  queryFn: ({ signal }) => fetchQualityScore(signal),
})

export const standardsQuery = (query = '', status = '') => queryOptions({
  queryKey: governanceKeys.standards(query, status),
  queryFn: ({ signal }) => fetchStandards(signal, query, status),
})

export const standardDetailQuery = (id: string, versionId = '') => queryOptions({
  queryKey: governanceKeys.standard(id, versionId),
  queryFn: ({ signal }) => fetchStandardDetail(signal, id, versionId),
  enabled: Boolean(id),
})

export const standardImpactQuery = (versionId: string) => queryOptions({
  queryKey: governanceKeys.standardImpact(versionId),
  queryFn: ({ signal }) => fetchVersionImpact(signal, versionId),
  enabled: Boolean(versionId),
})

export const mappingSetsQuery = (query = '') => queryOptions({
  queryKey: governanceKeys.mappings(query),
  queryFn: ({ signal }) => fetchMappingSets(signal, query),
})

export const mappingDetailQuery = (setId: string, versionId = '') => queryOptions({
  queryKey: governanceKeys.mapping(setId, versionId),
  queryFn: ({ signal }) => fetchMappingDetail(signal, setId, versionId),
  enabled: Boolean(setId),
})

export const mappingCoverageQuery = () => queryOptions({
  queryKey: governanceKeys.mappingCoverage(),
  queryFn: ({ signal }) => fetchMappingCoverage(signal),
})

export const mappingImpactQuery = (versionId: string) => queryOptions({
  queryKey: governanceKeys.mappingImpact(versionId),
  queryFn: ({ signal }) => fetchMappingImpact(signal, versionId),
  enabled: Boolean(versionId),
})

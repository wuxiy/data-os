import { queryOptions } from '@tanstack/react-query'
import {
  fetchAIDataProduct,
  fetchAIDataProducts,
  fetchAIOverview,
  fetchBuildJobs,
  fetchCertificationRequests,
  fetchFeedback,
} from '../../data/aiDataApi'

/** AI Data 域 Query：产品清单/概览/详情；认证、反馈与构建任务为从属资源。 */
export const aiDataKeys = {
  all: ['ai-data'] as const,
  products: () => [...aiDataKeys.all, 'products'] as const,
  overview: () => [...aiDataKeys.all, 'overview'] as const,
  detail: (id: string) => [...aiDataKeys.all, 'detail', id] as const,
  certifications: (id: string) => [...aiDataKeys.all, 'certifications', id] as const,
  feedback: (id: string) => [...aiDataKeys.all, 'feedback', id] as const,
  builds: (id: string) => [...aiDataKeys.all, 'builds', id] as const,
}

export const aiProductsQuery = () => queryOptions({
  queryKey: aiDataKeys.products(),
  queryFn: ({ signal }) => fetchAIDataProducts(signal),
})

export const aiOverviewQuery = () => queryOptions({
  queryKey: aiDataKeys.overview(),
  queryFn: ({ signal }) => fetchAIOverview(signal),
})

export const aiProductDetailQuery = (id: string) => queryOptions({
  queryKey: aiDataKeys.detail(id),
  queryFn: ({ signal }) => fetchAIDataProduct(id, signal),
  enabled: Boolean(id),
})

export const aiCertificationsQuery = (id: string) => queryOptions({
  queryKey: aiDataKeys.certifications(id),
  queryFn: ({ signal }) => fetchCertificationRequests(id, signal),
  enabled: Boolean(id),
})

export const aiFeedbackQuery = (id: string) => queryOptions({
  queryKey: aiDataKeys.feedback(id),
  queryFn: ({ signal }) => fetchFeedback(id, signal),
  enabled: Boolean(id),
})

export const aiBuildsQuery = (id: string) => queryOptions({
  queryKey: aiDataKeys.builds(id),
  queryFn: ({ signal }) => fetchBuildJobs(id, signal),
  enabled: Boolean(id),
})

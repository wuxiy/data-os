import { queryOptions } from '@tanstack/react-query'
import {
  fetchIngestionJobs,
  fetchIngestionRuns,
  fetchJobConfig,
  fetchJobSchedule,
  fetchScheduleInstances,
  fetchScheduleTaskLog,
  fetchScheduleTasks,
  fetchSourceCatalogs,
  fetchSourceColumns,
  fetchSourceTables,
  fetchSources,
  fetchWorkflowTemplates,
} from '../../data/controlPlane'

/**
 * 接入域 Query 键与选项：资源类型 + 对象键 + 实际筛选/分页。
 * 键不含自由文本；列表检索在内存过滤（服务端未提供 q 的接口不伪造服务端搜索）。
 */
export const ingestionKeys = {
  all: ['ingestion'] as const,
  sources: () => [...ingestionKeys.all, 'sources'] as const,
  jobs: () => [...ingestionKeys.all, 'jobs'] as const,
  templates: () => [...ingestionKeys.all, 'templates'] as const,
  runs: (jobId: string) => [...ingestionKeys.all, 'job', jobId, 'runs'] as const,
  config: (jobId: string) => [...ingestionKeys.all, 'job', jobId, 'config'] as const,
  schedule: (jobId: string) => [...ingestionKeys.all, 'job', jobId, 'schedule'] as const,
  instances: (jobId: string, page: number, size: number, state: string) => [...ingestionKeys.all, 'job', jobId, 'instances', page, size, state] as const,
  tasks: (jobId: string, instanceId: number) => [...ingestionKeys.all, 'job', jobId, 'instances', instanceId, 'tasks'] as const,
  log: (jobId: string, instanceId: number, taskId: number) => [...ingestionKeys.all, 'job', jobId, 'instances', instanceId, 'log', taskId] as const,
  catalogs: (sourceId: string) => [...ingestionKeys.all, 'source', sourceId, 'catalogs'] as const,
  tables: (sourceId: string, catalog: string) => [...ingestionKeys.all, 'source', sourceId, 'tables', catalog] as const,
  columns: (sourceId: string, catalog: string, table: string) => [...ingestionKeys.all, 'source', sourceId, 'columns', catalog, table] as const,
}

export const sourcesQuery = () => queryOptions({
  queryKey: ingestionKeys.sources(),
  queryFn: ({ signal }) => fetchSources(signal),
})

export const jobsQuery = () => queryOptions({
  queryKey: ingestionKeys.jobs(),
  queryFn: ({ signal }) => fetchIngestionJobs(signal),
})

export const workflowTemplatesQuery = () => queryOptions({
  queryKey: ingestionKeys.templates(),
  queryFn: ({ signal }) => fetchWorkflowTemplates(signal),
  staleTime: 5 * 60_000,
})

export const jobRunsQuery = (jobId: string) => queryOptions({
  queryKey: ingestionKeys.runs(jobId),
  queryFn: ({ signal }) => fetchIngestionRuns(jobId, signal),
})

export const jobConfigQuery = (jobId: string) => queryOptions({
  queryKey: ingestionKeys.config(jobId),
  queryFn: ({ signal }) => fetchJobConfig(jobId, signal),
})

export const jobScheduleQuery = (jobId: string) => queryOptions({
  queryKey: ingestionKeys.schedule(jobId),
  queryFn: ({ signal }) => fetchJobSchedule(jobId, signal),
})

export const scheduleInstancesQuery = (jobId: string, page: number, size: number, state = '') => queryOptions({
  queryKey: ingestionKeys.instances(jobId, page, size, state),
  queryFn: ({ signal }) => fetchScheduleInstances(jobId, { page: page + 1, size, ...(state ? { state } : {}) }, signal),
})

export const scheduleTasksQuery = (jobId: string, instanceId: number) => queryOptions({
  queryKey: ingestionKeys.tasks(jobId, instanceId),
  queryFn: ({ signal }) => fetchScheduleTasks(jobId, instanceId, signal),
})

export const scheduleTaskLogQuery = (jobId: string, instanceId: number, taskId: number) => queryOptions({
  queryKey: ingestionKeys.log(jobId, instanceId, taskId),
  queryFn: ({ signal }) => fetchScheduleTaskLog(jobId, instanceId, taskId, 200, signal),
})

export const sourceCatalogsQuery = (sourceId: string) => queryOptions({
  queryKey: ingestionKeys.catalogs(sourceId),
  queryFn: ({ signal }) => fetchSourceCatalogs(sourceId, signal),
  staleTime: 60_000,
})

export const sourceTablesQuery = (sourceId: string, catalog: string) => queryOptions({
  queryKey: ingestionKeys.tables(sourceId, catalog),
  queryFn: ({ signal }) => fetchSourceTables(sourceId, catalog, signal),
  staleTime: 60_000,
  enabled: Boolean(catalog),
})

export const sourceColumnsQuery = (sourceId: string, catalog: string, table: string) => queryOptions({
  queryKey: ingestionKeys.columns(sourceId, catalog, table),
  queryFn: ({ signal }) => fetchSourceColumns(sourceId, catalog, table, signal),
  staleTime: 60_000,
  enabled: Boolean(catalog && table),
})

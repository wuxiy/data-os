import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Archive,
  Cable,
  CalendarClock,
  CheckCircle2,
  Copy,
  Database,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { EmptyState } from '@/components/app/empty-state'
import { LoadingInline } from '@/components/app/loading'
import { useNotice } from '@/components/app/notice'
import { ScopeNote } from '@/components/app/scope-note'
import { SearchField } from '@/components/app/search-field'
import { StatusBadge } from '@/components/app/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FramePanel } from '@/components/ui/frame'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

import { usePortalNavigate } from '../../app/navigate'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { DataTable, listColumnHelper, SelectionBar, TablePagination } from '../../components/table/data-table'
import {
  confirmIngestionRunAbsent,
  fetchIngestionRuns,
  type IngestionJobApiItem,
  type IngestionRunApiItem,
  retryIngestionRun,
  type SourceApiItem,
  startIngestionRun,
  syncIngestionRun,
  updateIngestionJobStatus,
} from '../../data/controlPlane'
import { ACTIVE_RUN_STATUSES, formatDateTime, retryableRunStatus, runStatusView } from '../../data/domain'
import { workLinks } from '../../data/routes'
import {
  businessMessage,
  createRequestKey,
  errorMessage,
  executorLabel,
  jobLifecycleView,
  JOBS_PAGE_SIZE,
  RUNS_PAGE_SIZE,
  sourceDisplayName,
  SOURCES_PAGE_SIZE,
  sourceStatusView,
} from './labels'
import { ingestionKeys, jobRunsQuery, jobsQuery, sourcesQuery, workflowTemplatesQuery } from './queries'
import { CopyJobDialog, SourceCheckDialog, SourceRegisterDialog } from './source-dialogs'

/**
 * 数据接入（FE2）：数据源 / 采集任务 / 运行记录三个工作区。
 * 与旧页的差异是容器分工：短表单进 Dialog，任务配置与调度进独立工作页，
 * 列表只保留能一眼判断的对象信息与主操作。
 */
type TabValue = 'sources' | 'jobs' | 'runs'

const MODE_FILTER_ITEMS = [
  { value: '', label: '全部模式' },
  { value: 'BATCH', label: '批量同步' },
  { value: 'CDC', label: '增量变更' },
]

export function IngestionPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()

  const [tab, setTab] = useState<TabValue>('jobs')
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modeFilter, setModeFilter] = useState('')
  const [sourcesPage, setSourcesPage] = useState(0)
  const [jobsPage, setJobsPage] = useState(0)
  const [runsPage, setRunsPage] = useState(0)
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const [checkingSource, setCheckingSource] = useState<SourceApiItem | null>(null)
  const [copyTarget, setCopyTarget] = useState<IngestionJobApiItem | null>(null)
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  const [batchAction, setBatchAction] = useState<'ACTIVE' | 'PAUSED' | null>(null)

  const sourcesRequest = useQuery(sourcesQuery())
  const jobsRequest = useQuery(jobsQuery())
  // 模板目录为从属资源：失败不塌页（列表主链路照常可用）。
  const templatesRequest = useQuery(workflowTemplatesQuery())

  const sources = sourcesRequest.data?.items ?? []
  const jobs = jobsRequest.data?.items ?? []

  const runQueries = useQueries({
    queries: jobs.map((job) => ({ ...jobRunsQuery(job.id), enabled: jobsRequest.isSuccess })),
  })
  const latestRuns = useMemo(() => {
    const map = new Map<string, IngestionRunApiItem>()
    jobs.forEach((job, index) => {
      const run = runQueries[index]?.data?.items?.[0]
      if (run) map.set(job.id, run)
    })
    return map
  }, [jobs, runQueries])

  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])

  // 原型口径的第四张摘要卡：最近 24h 内最近一次运行失败的任务数（真实时间窗）。
  const failedIn24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return jobs.filter((job) => job.latestRunStatus === 'FAILED' && job.lastRunAt !== null && new Date(job.lastRunAt).getTime() >= cutoff).length
  }, [jobs])

  const filteredSources = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return sources.filter((source) => {
      const matchesText = !text || [source.name, source.id, source.systemType, source.protocol].some((value) => value?.toLowerCase().includes(text))
      const matchesStatus = !statusFilter || (statusFilter === 'checked' ? source.status === 'HEALTHY' : source.status !== 'HEALTHY')
      return matchesText && matchesStatus
    })
  }, [sources, keyword, statusFilter])

  const filteredJobs = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return jobs.filter((job) => {
      const source = sourceById.get(job.sourceId)
      const matchesText = !text || [job.name, job.id, source?.name].some((value) => value?.toLowerCase().includes(text))
      const matchesStatus = !statusFilter || (statusFilter === 'enabled' ? job.status === 'ACTIVE' : job.status !== 'ACTIVE')
      const matchesMode = !modeFilter || job.mode === modeFilter
      return matchesText && matchesStatus && matchesMode
    })
  }, [jobs, keyword, statusFilter, modeFilter, sourceById])

  const runRows = useMemo(() => jobs
    .map((job) => ({ job, run: latestRuns.get(job.id) }))
    .filter((row): row is { job: IngestionJobApiItem; run: IngestionRunApiItem } => Boolean(row.run))
    .sort((left, right) => right.run.submittedAt.localeCompare(left.run.submittedAt)), [jobs, latestRuns])

  const filteredRuns = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return runRows.filter(({ job, run }) => {
      const matchesText = !text || [job.name, run.id, run.message].some((value) => value?.toLowerCase().includes(text))
      const matchesStatus = !statusFilter || run.status === statusFilter
      return matchesText && matchesStatus
    })
  }, [runRows, keyword, statusFilter])

  const sourcesPageCount = Math.max(1, Math.ceil(filteredSources.length / SOURCES_PAGE_SIZE))
  const jobsPageCount = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PAGE_SIZE))
  const runsPageCount = Math.max(1, Math.ceil(filteredRuns.length / RUNS_PAGE_SIZE))

  const refresh = () => {
    void sourcesRequest.refetch()
    void jobsRequest.refetch()
    runQueries.forEach((query) => void query.refetch())
  }
  const refreshing = sourcesRequest.isFetching || jobsRequest.isFetching || runQueries.some((query) => query.isFetching)

  const unavailable = sourcesRequest.isError && jobsRequest.isError

  const runAction = useMutation({
    mutationFn: async ({ job, run, action }: { job: IngestionJobApiItem; run: IngestionRunApiItem; action: 'sync' | 'retry' | 'confirm-absent' }) => {
      if (action === 'sync') return syncIngestionRun(job.id, run.id)
      if (action === 'retry') return retryIngestionRun(job.id, run.id)
      return confirmIngestionRunAbsent(job.id, run.id)
    },
    onSuccess: (run, variables) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.runs(variables.job.id) })
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      notify(variables.action === 'sync'
        ? `运行状态已更新：${runStatusView(run.status).label}`
        : variables.action === 'retry'
          ? `已创建重试运行：${runStatusView(run.status).label}`
          : '已确认外部运行不存在，当前运行允许重试')
    },
    onError: (cause, variables) => notify(errorMessage(cause, variables.action === 'sync' ? '运行状态同步失败，请稍后重试' : variables.action === 'retry' ? '运行重试失败，请先确认任务未暂停且没有活动运行' : '确认外部运行不存在失败，请刷新后重试')),
  })

  const startRun = useMutation({
    mutationFn: (job: IngestionJobApiItem) => startIngestionRun(job.id, { idempotencyKey: createRequestKey() }),
    onSuccess: (run, job) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.runs(job.id) })
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      notify(run.status === 'BLOCKED_DEPENDENCY' ? '运行记录已保存，等待中心采集执行器上线' : `运行已提交：${runStatusView(run.status).label}`)
    },
    onError: (cause) => notify(errorMessage(cause, '运行请求失败，请查看控制面运行日志')),
  })

  const changeStatus = useMutation({
    mutationFn: ({ job, status }: { job: IngestionJobApiItem; status: string }) => updateIngestionJobStatus(job.id, status),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      notify(`任务状态已更新：${jobLifecycleView(updated.status).label}`)
    },
    onError: (cause) => notify(errorMessage(cause, '任务状态更新失败，请稍后重试')),
  })

  // 批量启用/暂停：逐个走既有单任务状态合同，失败项如实列回执（口径同质量页批量提醒）。
  const batchStatus = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: 'ACTIVE' | 'PAUSED' }) => {
      const failed: string[] = []
      let ok = 0
      for (const id of ids) {
        try { await updateIngestionJobStatus(id, status); ok += 1 } catch { failed.push(id) }
      }
      return { ok, failed }
    },
    onSuccess: ({ ok, failed }, variables) => {
      setBatchAction(null)
      setSelectedJobs(new Set())
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      const verb = variables.status === 'ACTIVE' ? '启用' : '暂停'
      notify(failed.length === 0
        ? `已${verb} ${ok} 个采集任务`
        : `已${verb} ${ok} 个任务，${failed.length} 个失败：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`)
    },
    onError: () => {
      setBatchAction(null)
      notify('批量操作未能完成，请稍后重试')
    },
  })

  function openJob(job: IngestionJobApiItem) {
    navigate(workLinks.ingestionJob(job.id))
  }

  const sourceHelper = listColumnHelper<SourceApiItem>()
  const sourceColumns = sourceHelper.columns([
    sourceHelper.display({
      id: 'name',
      header: '数据源',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm font-medium text-ink">{sourceDisplayName(row.original)}</div>
          <div className="mt-0.5 text-meta text-muted-foreground">{row.original.id.slice(0, 12)}</div>
        </div>
      ),
    }),
    sourceHelper.display({
      id: 'access',
      header: '接入方式',
      size: 190,
      cell: ({ row }) => <span className="text-label">{row.original.systemType} · {row.original.protocol}</span>,
    }),
    sourceHelper.display({
      id: 'status',
      header: '配置状态',
      size: 110,
      cell: ({ row }) => {
        const status = sourceStatusView(row.original.status)
        return <Badge variant={status.tone}>{status.label}</Badge>
      },
    }),
    sourceHelper.display({
      id: 'checked',
      header: '最近检查',
      size: 210,
      cell: ({ row }) => row.original.lastCheckedAt
        ? (
          <div>
            <div className="text-label text-ink-soft">{formatDateTime(row.original.lastCheckedAt)}</div>
            {row.original.lastCheckMessage ? (
              <Tooltip>
                <TooltipTrigger render={<div className="mt-0.5 max-w-[220px] truncate text-meta text-muted-foreground" />}>{row.original.lastCheckMessage}</TooltipTrigger>
                <TooltipPopup>{row.original.lastCheckMessage}</TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        )
        : <span className="text-label text-faint">未检查</span>,
    }),
    sourceHelper.display({
      id: 'actions',
      header: '操作',
      size: 170,
      cell: ({ row }) => (
        <div className="flex items-center gap-3" onClick={(event) => event.stopPropagation()}>
          <Button variant="link" onClick={() => setCheckingSource(row.original)}>检查</Button>
          {row.original.protocol.toUpperCase() === 'JDBC' ? (
            <Button variant="link" onClick={() => navigate(workLinks.ingestionSourceExplorer(row.original.id))}>
              <Database size={13} />浏览
            </Button>
          ) : null}
        </div>
      ),
    }),
  ])

  const jobHelper = listColumnHelper<IngestionJobApiItem>()
  const jobColumns = jobHelper.columns([
    jobHelper.display({
      id: 'name',
      header: '采集任务',
      cell: ({ row }) => (
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body-sm font-medium text-ink">{row.original.name}</span>
            <Badge variant={row.original.configured ? 'info' : 'warning'}>
              {row.original.configured ? `${row.original.templateKey ?? '自定义'} v${row.original.templateVersion ?? 1}` : '未配置'}
            </Badge>
          </div>
          <div className="mt-0.5 text-meta text-muted-foreground">{row.original.id.slice(0, 12)}</div>
        </div>
      ),
    }),
    jobHelper.display({
      id: 'source',
      header: '数据源',
      size: 130,
      cell: ({ row }) => <span className="text-label">{sourceById.get(row.original.sourceId)?.name ?? '来源未登记'}</span>,
    }),
    jobHelper.display({
      id: 'executor',
      header: '执行通道',
      size: 120,
      cell: ({ row }) => <span className="text-label">{executorLabel(row.original.executor)}</span>,
    }),
    jobHelper.display({
      id: 'run',
      header: '最近运行',
      size: 200,
      cell: ({ row }) => {
        const run = latestRuns.get(row.original.id)
        const latestStatus = run?.status ?? row.original.latestRunStatus
        if (!latestStatus) {
          const lifecycle = jobLifecycleView(row.original.status)
          return <StatusBadge tone={lifecycle.tone === 'success' ? 'good' : lifecycle.tone === 'error' ? 'bad' : 'neutral'}>{lifecycle.label}</StatusBadge>
        }
        const status = runStatusView(latestStatus)
        return (
          <div>
            <StatusBadge tone={status.tone === 'healthy' ? 'good' : status.tone === 'danger' ? 'bad' : status.tone === 'warning' ? 'running' : 'neutral'}>{status.label}</StatusBadge>
            {run ? (
              <Tooltip>
                <TooltipTrigger render={<div className="mt-0.5 max-w-[200px] truncate text-meta text-muted-foreground" />}>{businessMessage(run.message)}</TooltipTrigger>
                <TooltipPopup>{businessMessage(run.message)}</TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        )
      },
    }),
    jobHelper.display({
      id: 'lifecycle',
      header: '任务状态',
      size: 100,
      cell: ({ row }) => {
        const lifecycle = jobLifecycleView(row.original.status)
        return <Badge variant={lifecycle.tone}>{lifecycle.label}</Badge>
      },
    }),
    jobHelper.display({
      id: 'actions',
      header: '操作',
      size: 276,
      cell: ({ row }) => {
        const job = row.original
        const run = latestRuns.get(job.id)
        const latestStatus = run?.status ?? job.latestRunStatus
        const activeRun = Boolean(latestStatus && ACTIVE_RUN_STATUSES.includes(latestStatus))
        const canRetry = Boolean(run && retryableRunStatus(run.status))
        const busy = startRun.isPending && startRun.variables?.id === job.id || changeStatus.isPending && changeStatus.variables?.job.id === job.id
        return (
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            {job.status === 'PAUSED' ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => changeStatus.mutate({ job, status: 'ACTIVE' })}><Play size={12} />启用</Button>
            ) : job.status === 'ARCHIVED' ? (
              <Badge variant="outline">已归档</Badge>
            ) : activeRun ? (
              // 已有活动运行时按钮禁用，用提示说明原因（禁用态收不到悬停，按 coss 写法包一层可聚焦的 span）。
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
                  <Button variant="outline" size="sm" disabled><Play size={12} />已有运行</Button>
                </TooltipTrigger>
                <TooltipPopup>已有活动运行</TooltipPopup>
              </Tooltip>
            ) : (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                if (!job.configured) {
                  notify('请先保存采集任务配置，再启动运行')
                  navigate(workLinks.ingestionJob(job.id, 'configuration'))
                  return
                }
                startRun.mutate(job)
              }}>
                <Play size={12} />{job.configured ? '启动' : '配置后运行'}
              </Button>
            )}
            {canRetry ? (
              <Button variant="outline" size="sm" disabled={busy || activeRun || job.status !== 'ACTIVE'} onClick={() => run && runAction.mutate({ job, run, action: 'retry' })}>
                <RotateCcw size={12} />重试
              </Button>
            ) : null}
            <Button variant="link" onClick={() => openJob(job)}>详情</Button>
            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="icon" aria-label={`更多操作：${job.name}`} />}>
                <MoreHorizontal />
              </MenuTrigger>
              <MenuPopup align="end">
                {executorLabel(job.executor) === '平台调度' ? (
                  <MenuItem onClick={() => navigate(workLinks.ingestionJob(job.id, 'scheduling'))}>
                    <CalendarClock />
                    调度配置
                  </MenuItem>
                ) : null}
                <MenuItem onClick={() => navigate(workLinks.ingestionJob(job.id, 'configuration'))}>
                  <Settings2 />
                  任务配置
                </MenuItem>
                {job.status === 'ACTIVE' ? (
                  <MenuItem disabled={busy} onClick={() => changeStatus.mutate({ job, status: 'PAUSED' })}>
                    <Pause />
                    暂停
                  </MenuItem>
                ) : job.status === 'PAUSED' || job.status === 'DRAFT' ? (
                  <MenuItem disabled={busy} onClick={() => changeStatus.mutate({ job, status: 'ACTIVE' })}>
                    <Play />
                    启用
                  </MenuItem>
                ) : null}
                <MenuItem disabled={busy} onClick={() => setCopyTarget(job)}>
                  <Copy />
                  复制
                </MenuItem>
                {run && ACTIVE_RUN_STATUSES.includes(run.status) ? (
                  <MenuItem disabled={busy} onClick={() => runAction.mutate({ job, run, action: 'sync' })}>
                    <RefreshCw />
                    同步运行状态
                  </MenuItem>
                ) : null}
                {job.status !== 'ARCHIVED' ? (
                  <MenuItem variant="destructive" disabled={busy || activeRun} onClick={() => changeStatus.mutate({ job, status: 'ARCHIVED' })}>
                    <Archive />
                    归档
                  </MenuItem>
                ) : null}
              </MenuPopup>
            </Menu>
          </div>
        )
      },
    }),
  ])

  const runHelper = listColumnHelper<{ job: IngestionJobApiItem; run: IngestionRunApiItem }>()
  const runColumns = runHelper.columns([
    runHelper.display({
      id: 'job',
      header: '执行批次 / 任务',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm font-medium text-ink">{row.original.job.name}</div>
          <div className="mt-0.5 text-meta text-muted-foreground">{row.original.run.id.slice(0, 12)}</div>
        </div>
      ),
    }),
    runHelper.display({
      id: 'status',
      header: '执行状态',
      size: 140,
      cell: ({ row }) => {
        const status = runStatusView(row.original.run.status)
        return <StatusBadge tone={status.tone === 'healthy' ? 'good' : status.tone === 'danger' ? 'bad' : status.tone === 'warning' ? 'running' : 'neutral'}>{status.label}</StatusBadge>
      },
    }),
    runHelper.display({
      id: 'reconcile',
      header: '对账',
      size: 150,
      cell: ({ row }) => row.original.run.reconciliationStatus === 'MANUAL_REQUIRED'
        ? <Badge variant="warning">待人工对账</Badge>
        : <span className="text-label text-faint">—</span>,
    }),
    runHelper.display({
      id: 'submitted',
      header: '提交时间',
      size: 140,
      cell: ({ row }) => <span className="text-label text-ink-soft">{formatDateTime(row.original.run.submittedAt)}</span>,
    }),
    runHelper.display({
      id: 'actions',
      header: '操作',
      size: 240,
      cell: ({ row }) => {
        const { job, run } = row.original
        const busy = runAction.isPending && runAction.variables?.run.id === run.id
        return (
          <div className="flex items-center gap-2.5" onClick={(event) => event.stopPropagation()}>
            {run.reconciliationStatus === 'MANUAL_REQUIRED' ? (
              <>
                <Button variant="link" disabled={busy} onClick={() => runAction.mutate({ job, run, action: 'sync' })}>重新查询</Button>
                <Button variant="link" disabled={busy} onClick={() => runAction.mutate({ job, run, action: 'confirm-absent' })}>确认不存在</Button>
              </>
            ) : (
              <Button variant="link" onClick={() => openJob(job)}>查看任务</Button>
            )}
            {retryableRunStatus(run.status) ? (
              <Button variant="link" disabled={busy || job.status !== 'ACTIVE'} onClick={() => runAction.mutate({ job, run, action: 'retry' })}>重试</Button>
            ) : null}
          </div>
        )
      },
    }),
  ])

  const statusOptions = tab === 'sources'
    ? [['', '全部检查状态'], ['checked', '已检查'], ['pending', '待检查']]
    : tab === 'runs'
      ? [['', '全部状态'], ['SUCCEEDED', '已完成'], ['FAILED', '失败'], ['RUNNING', '运行中'], ['UNKNOWN', '状态待确认']]
      : [['', '全部状态'], ['enabled', '已启用'], ['paused', '未启用']]

  const statusItems = [
    ...statusOptions.map(([value, label]) => ({ value, label })),
  ]
  return (
    <div>
      <Breadcrumb items={[{ label: '数据管理' }, { label: '数据接入' }]} trailing={<><span>本地合成数据不进入生产路径</span></>} />
      <PageHeading
        title="数据接入"
        description="统一管理数据来源、采集任务与运行记录。"
        actions={
          <>
            <Button variant="outline" onClick={() => setSourceDialogOpen(true)}><Cable size={14} />登记数据源</Button>
            <Button
              onClick={() => {
                if (sources.length === 0) {
                  notify('请先登记至少一个数据源')
                  setSourceDialogOpen(true)
                  return
                }
                navigate(workLinks.ingestionNew())
              }}
            >
              <Plus size={14} />新建采集任务
            </Button>
          </>
        }
      />

      <section className="mb-[18px] grid grid-cols-4 gap-3.5 rounded-panel border border-line bg-paper px-0 py-3.5 max-[1100px]:grid-cols-2">
        <SummaryCell label="登记数据源" value={String(sources.length)} note="个" icon={<Database size={17} />} />
        <SummaryCell label="采集任务" value={String(jobs.length)} note="个" icon={<Cable size={17} />} />
        <SummaryCell label="已启用任务" value={String(jobs.filter((job) => job.status === 'ACTIVE').length)} note="个" icon={<CheckCircle2 size={17} />} />
        <SummaryCell label="最近 24h 失败" value={String(failedIn24h)} note="次" icon={<Activity size={17} />} />
      </section>

      <FramePanel className="p-0 overflow-clip">
        <Tabs
          value={tab}
          onValueChange={(value) => { setTab(value as typeof tab); setKeyword(''); setStatusFilter(''); setModeFilter('') }}
          className="gap-0"
        >
          <TabsList variant="underline" aria-label="数据接入类型" className="px-[18px]">
            {[
              { value: 'sources' as const, label: '数据源', count: sources.length },
              { value: 'jobs' as const, label: '采集任务', count: jobs.length },
              { value: 'runs' as const, label: '运行记录', count: runRows.length },
            ].map((item) => (
              <TabsTab key={item.value} value={item.value}>
                {item.label}
                <Badge variant="outline">{item.count}</Badge>
              </TabsTab>
            ))}
          </TabsList>
          {/* 三类清单共用一套工具栏与表格，面板跟随当前页签。 */}
          <TabsPanel value={tab} keepMounted className="outline-none">

        <div className="flex items-center justify-between gap-2.5 px-[18px] py-4">
          <div className="flex min-w-0 items-center gap-2">
            <SearchField
              value={keyword}
              onValueChange={(value) => { setKeyword(value); setSourcesPage(0); setJobsPage(0); setRunsPage(0) }}
              placeholder={tab === 'sources' ? '搜索数据源名称或编号' : tab === 'runs' ? '搜索任务、批次或消息' : '搜索任务名称、数据源或编号'}
            />
            <Select
              items={statusItems}
              value={statusFilter}
              onValueChange={(next) => { setStatusFilter(next ?? ''); setSourcesPage(0); setJobsPage(0); setRunsPage(0) }}
            >
              <SelectTrigger aria-label="状态筛选" className="w-auto min-w-none" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {tab === 'jobs' ? (
              <Select
                items={MODE_FILTER_ITEMS}
                value={modeFilter}
                onValueChange={(next) => { setModeFilter(next ?? ''); setJobsPage(0) }}
              >
                <SelectTrigger aria-label="模式筛选" className="w-auto min-w-none" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {MODE_FILTER_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
          </div>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon" aria-label="刷新列表" onClick={refresh} disabled={refreshing} />}><RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} /></TooltipTrigger>
            <TooltipPopup>刷新列表</TooltipPopup>
          </Tooltip>
        </div>

        {unavailable ? (
          <div className="px-5 pb-5">
            <EmptyState
              minHeight={240}
              icon={<Cable />}
              title="采集控制面不可用"
              description="当前页面没有展示演示状态；请恢复控制面后重新加载。"
              action={<Button variant="outline" onClick={refresh}><RefreshCw size={13} />重新连接</Button>}
            />
          </div>
        ) : tab === 'sources' ? (
          <>
            <ScopeNote>登记与连通性检查分开呈现；已检查不代表业务采集已经完成。</ScopeNote>
            <DataTable
              columns={sourceColumns}
              data={filteredSources.slice(sourcesPage * SOURCES_PAGE_SIZE, (sourcesPage + 1) * SOURCES_PAGE_SIZE)}
              getRowId={(source) => source.id}
              rowLabel={(source) => sourceDisplayName(source)}
              loading={sourcesRequest.isPending}
              onRowClick={(source) => navigate(workLinks.ingestionSourceExplorer(source.id))}
              empty={<EmptyState minHeight={260} icon={<Database />} title={sourcesRequest.isPending ? '正在读取数据源' : '暂无已登记数据源'} description="登记来源后，可检查连通性并浏览库表。" action={<Button variant="outline" onClick={() => setSourceDialogOpen(true)}><Plus size={13} />登记数据源</Button>} />}
            />
            <TablePagination page={Math.min(sourcesPage, sourcesPageCount - 1)} pageSize={SOURCES_PAGE_SIZE} total={filteredSources.length} onPageChange={setSourcesPage} label="数据源分页" />
          </>
        ) : tab === 'jobs' ? (
          <>
            <ScopeNote>任务配置可复用模板；运行状态由控制面统一回写，暂停不终止已提交批次。</ScopeNote>
            <DataTable
              columns={jobColumns}
              data={filteredJobs.slice(jobsPage * JOBS_PAGE_SIZE, (jobsPage + 1) * JOBS_PAGE_SIZE)}
              getRowId={(job) => job.id}
              rowLabel={(job) => job.name}
              selection={{ selected: selectedJobs, onChange: setSelectedJobs }}
              loading={jobsRequest.isPending}
              onRowClick={openJob}
              empty={<EmptyState minHeight={260} icon={<Cable />} title={jobsRequest.isPending ? '正在读取采集任务' : '暂无采集任务'} description="先登记数据源，再新建采集任务。" action={<Button variant="outline" onClick={() => navigate(workLinks.ingestionNew())}><Plus size={13} />新建采集任务</Button>} />}
            />
            <SelectionBar count={selectedJobs.size}>
              <Button variant="outline" size="sm" disabled={batchStatus.isPending} onClick={() => setBatchAction('ACTIVE')}><Play size={12} />批量启用</Button>
              <Button variant="outline" size="sm" disabled={batchStatus.isPending} onClick={() => setBatchAction('PAUSED')}><Pause size={12} />批量暂停</Button>
              <Button size="sm" variant="link" onClick={() => setSelectedJobs(new Set())}>清空选择</Button>
            </SelectionBar>
            <TablePagination page={Math.min(jobsPage, jobsPageCount - 1)} pageSize={JOBS_PAGE_SIZE} total={filteredJobs.length} onPageChange={setJobsPage} label="采集任务分页" />
          </>
        ) : (
          <>
            <ScopeNote>这里汇总各任务最近一次运行；完整历史与调度实例在任务详情页。人工对账出现在执行器状态不可确认时。</ScopeNote>
            <DataTable
              columns={runColumns}
              data={filteredRuns.slice(runsPage * RUNS_PAGE_SIZE, (runsPage + 1) * RUNS_PAGE_SIZE)}
              getRowId={(row) => row.run.id}
              rowLabel={(row) => `${row.job.name} ${runStatusView(row.run.status).label}`}
              loading={jobsRequest.isPending || runQueries.some((query) => query.isPending)}
              onRowClick={(row) => openJob(row.job)}
              empty={<EmptyState minHeight={260} icon={<Activity />} title="还没有运行记录" description="从采集任务启动一次运行后，这里会显示执行状态与对账信息。" />}
            />
            <TablePagination page={Math.min(runsPage, runsPageCount - 1)} pageSize={RUNS_PAGE_SIZE} total={filteredRuns.length} onPageChange={setRunsPage} label="运行记录分页" />
          </>
        )}
        {templatesRequest.isError ? <p className="px-[18px] pb-3 text-meta text-amber">模板目录读取失败：新建任务仍可使用自定义 JSON。</p> : null}
          </TabsPanel>
        </Tabs>
      </FramePanel>

      <SourceRegisterDialog
        open={sourceDialogOpen}
        onOpenChange={setSourceDialogOpen}
        onCreated={() => {
          setSourcesPage(0)
          setTab('sources')
          void queryClient.invalidateQueries({ queryKey: ingestionKeys.sources() })
        }}
      />

      <SourceCheckDialog
        source={checkingSource}
        onOpenChange={(open) => { if (!open) setCheckingSource(null) }}
        onChecked={(updated) => setCheckingSource(updated)}
      />

      <CopyJobDialog
        job={copyTarget}
        sources={sources}
        onOpenChange={(open) => { if (!open) setCopyTarget(null) }}
        onCopied={() => {
          setJobsPage(0)
          void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
        }}
      />

      <ConfirmDialog
        open={batchAction !== null}
        onOpenChange={(open) => { if (!open) setBatchAction(null) }}
        title={batchAction === 'ACTIVE' ? '批量启用采集任务？' : '批量暂停采集任务？'}
        description={batchAction === 'ACTIVE'
          ? '启用后任务恢复按调度执行；已提交的运行批次不受影响。'
          : '暂停后任务不再发起新运行；已提交的运行批次会继续完成。'}
        object={{ name: `已选 ${selectedJobs.size} 个采集任务`, meta: '逐个执行，失败项在回执中列出' }}
        confirmLabel={batchAction === 'ACTIVE' ? '批量启用' : '批量暂停'}
        tone={batchAction === 'PAUSED' ? 'destructive' : 'default'}
        busy={batchStatus.isPending}
        onConfirm={() => batchAction && batchStatus.mutate({ ids: [...selectedJobs], status: batchAction })}
      />

      {startRun.isPending || changeStatus.isPending || runAction.isPending ? <div className="mt-2"><LoadingInline>正在提交动作…</LoadingInline></div> : null}
    </div>
  )
}

function SummaryCell({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-r border-line px-[21px] last:border-r-0">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <small className="block text-label text-muted-foreground">{label}</small>
        <strong className="text-[22px] leading-tight font-medium text-ink">{value}<span className="ml-1.5 text-meta font-normal text-muted-foreground">{note}</span></strong>
      </div>
    </div>
  )
}

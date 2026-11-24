import { LoadingBlock } from '@/components/app/loading'
import { StatusBadge } from '@/components/app/status-badge'
import { Badge } from '@/components/ui/badge'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Archive, Copy, Pause, Play, RefreshCw, RotateCcw, Settings2, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearch } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel } from '../../components/kit/panel'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { EmptyState } from '@/components/app/empty-state'
import { useNotice } from '../../components/kit/toast'
import {
  confirmIngestionRunAbsent,
  retryIngestionRun,
  startIngestionRun,
  syncIngestionRun,
  updateIngestionJobStatus,
  type IngestionJobApiItem,
  type IngestionRunApiItem,
} from '../../data/controlPlane'
import { ACTIVE_RUN_STATUSES, formatDateTime, retryableRunStatus, runStatusView } from '../../data/domain'
import { workLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { ingestionKeys, jobRunsQuery, jobsQuery, sourcesQuery } from './queries'
import {
  businessMessage,
  createRequestKey,
  errorMessage,
  executorLabel,
  isDolphinExecutor,
  jobLifecycleView,
  sourceDisplayName,
} from './labels'
import { CopyJobDialog } from './source-dialogs'
import { JobConfigurationEditor } from './job-editor-page'
import { SchedulePanel } from './schedule-panel'

type DetailTab = 'overview' | 'configuration' | 'scheduling' | 'runs'

/**
 * 采集任务详情：概览 / 配置 / 调度 / 运行。
 * 运行记录保留 5 秒观察节奏；切换 Tab 不终止后端执行，只停止观察。
 */
export function JobDetailPage({ jobId }: { jobId: string }) {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const search = useSearch({ strict: false }) as { tab?: DetailTab }
  const tab: DetailTab = search.tab && ['overview', 'configuration', 'scheduling', 'runs'].includes(search.tab) ? search.tab : 'overview'
  const [copyOpen, setCopyOpen] = useState(false)

  const jobsRequest = useQuery(jobsQuery())
  const sourcesRequest = useQuery(sourcesQuery())
  const runsRequest = useQuery({ ...jobRunsQuery(jobId), refetchInterval: 5_000 })

  const job = jobsRequest.data?.items.find((item) => item.id === jobId)
  const sources = sourcesRequest.data?.items ?? []
  const source = job ? sources.find((item) => item.id === job.sourceId) : undefined
  const runs = useMemo(() => runsRequest.data?.items ?? [], [runsRequest.data])
  const latestRun = runs[0]

  const runAction = useMutation({
    mutationFn: async ({ run, action }: { run: IngestionRunApiItem; action: 'sync' | 'retry' | 'confirm-absent' }) => {
      if (action === 'sync') return syncIngestionRun(jobId, run.id)
      if (action === 'retry') return retryIngestionRun(jobId, run.id)
      return confirmIngestionRunAbsent(jobId, run.id)
    },
    onSuccess: (run, variables) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.runs(jobId) })
      notify(variables.action === 'sync'
        ? `运行状态已更新：${runStatusView(run.status).label}`
        : variables.action === 'retry'
          ? `已创建重试运行：${runStatusView(run.status).label}`
          : '已确认外部运行不存在，当前运行允许重试')
    },
    onError: (cause, variables) => notify(errorMessage(cause, variables.action === 'sync' ? '运行状态同步失败，请稍后重试' : variables.action === 'retry' ? '运行重试失败，请先确认任务未暂停且没有活动运行' : '确认外部运行不存在失败，请刷新后重试')),
  })

  const startRun = useMutation({
    mutationFn: (target: IngestionJobApiItem) => startIngestionRun(target.id, { idempotencyKey: createRequestKey() }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.runs(jobId) })
      notify(run.status === 'BLOCKED_DEPENDENCY' ? '运行记录已保存，等待中心采集执行器上线' : `运行已提交：${runStatusView(run.status).label}`)
    },
    onError: (cause) => notify(errorMessage(cause, '运行请求失败，请查看控制面运行日志')),
  })

  const changeStatus = useMutation({
    mutationFn: ({ target, status }: { target: IngestionJobApiItem; status: string }) => updateIngestionJobStatus(target.id, status),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      notify(`任务状态已更新：${jobLifecycleView(updated.status).label}`)
    },
    onError: (cause) => notify(errorMessage(cause, '任务状态更新失败，请稍后重试')),
  })

  if (jobsRequest.isPending) return <LoadingBlock>正在读取任务…</LoadingBlock>

  if (!job) {
    return (
      <Panel>
        <EmptyState
          icon={<TriangleAlert />}
          title="采集任务不存在"
          description="该任务可能已被删除，或当前账号没有访问权限。"
          action={<Button variant="outline" onClick={() => navigate('/ingestion')}>返回数据接入</Button>}
        />
      </Panel>
    )
  }

  const lifecycle = jobLifecycleView(job.status)
  const latestStatus = latestRun?.status ?? job.latestRunStatus
  const activeRun = Boolean(latestStatus && ACTIVE_RUN_STATUSES.includes(latestStatus))
  const dolphin = isDolphinExecutor(job.executor)
  const busy = startRun.isPending || changeStatus.isPending

  function goTab(next: DetailTab) {
    navigate(workLinks.ingestionJob(jobId, next))
  }

  return (
    <div>
      <Breadcrumb items={[{ label: '数据管理' }, { label: '数据接入' }, { label: '采集任务' }, { label: job.name }]} trailing={<><span>{job.id.slice(0, 12)}</span></>} />
      <PageHeading
        title={job.name}
        description={`${source ? sourceDisplayName(source) : '来源未登记'} · ${executorLabel(job.executor)} · ${job.mode === 'CDC' ? '增量变更' : '批量同步'}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/ingestion')}>返回列表</Button>
            {job.status === 'PAUSED' ? (
              <Button variant="outline" disabled={busy} onClick={() => changeStatus.mutate({ target: job, status: 'ACTIVE' })}><Play size={14} />启用</Button>
            ) : job.status === 'ACTIVE' ? (
              <Button variant="outline" disabled={busy} onClick={() => changeStatus.mutate({ target: job, status: 'PAUSED' })}><Pause size={14} />暂停</Button>
            ) : null}
            <Button disabled={busy || activeRun || job.status !== 'ACTIVE'} onClick={() => {
              if (!job.configured) {
                notify('请先保存采集任务配置，再启动运行')
                goTab('configuration')
                return
              }
              startRun.mutate(job)
            }}>
              <Play size={14} />{activeRun ? '已有运行' : '启动运行'}
            </Button>
          </>
        }
      />

      <Panel>
        <Tabs
          value={tab}
          onValueChange={(value) => goTab(value as DetailTab)}
        >
          <TabsList variant="underline">
            <TabsTab key="overview" value="overview">概览</TabsTab>
            <TabsTab key="configuration" value="configuration">配置</TabsTab>
            <TabsTab key="scheduling" value="scheduling">调度</TabsTab>
            <TabsTab key="runs" value="runs">运行记录
              <Badge variant="outline">{runs.length}</Badge>
            </TabsTab>
          </TabsList>
          <TabsPanel value="overview" className="px-5 py-4">
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <Badge variant={lifecycle.tone}>{lifecycle.label}</Badge>
              <Badge variant={job.configured ? 'info' : 'warning'}>{job.configured ? `${job.templateKey ?? '自定义'} v${job.templateVersion ?? 1}` : '未配置'}</Badge>
              {latestStatus ? <StatusBadge tone={runStatusView(latestStatus).tone === 'healthy' ? 'good' : runStatusView(latestStatus).tone === 'danger' ? 'bad' : 'running'}>{runStatusView(latestStatus).label}</StatusBadge> : null}
              {activeRun ? <Badge variant="warning">运行观察中（5 秒刷新）</Badge> : null}
              <span className="text-meta text-muted-foreground">创建于 {formatDateTime(job.createdAt)}</span>
            </div>

            <dl className="grid grid-cols-4 gap-4 rounded-panel border border-line bg-wash px-4 py-3 max-[1100px]:grid-cols-2">
              <Fact label="来源系统" value={source ? `${sourceDisplayName(source)} · ${source.systemType}` : '来源未登记'} />
              <Fact label="执行通道" value={executorLabel(job.executor)} />
              <Fact label="采集模式" value={job.mode === 'CDC' ? '增量变更' : '批量同步'} />
              <Fact label="最近运行" value={latestRun ? formatDateTime(latestRun.submittedAt) : '—'} />
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => goTab('configuration')}><Settings2 size={13} />任务配置</Button>
              {dolphin ? <Button variant="outline" size="sm" onClick={() => goTab('scheduling')}>调度配置</Button> : null}
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setCopyOpen(true)}><Copy size={13} />复制任务</Button>
              {job.status !== 'ARCHIVED' ? (
                <Button size="sm" variant="destructive-outline" disabled={busy || activeRun} onClick={() => changeStatus.mutate({ target: job, status: 'ARCHIVED' })}>
                  <Archive size={13} />归档
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void runsRequest.refetch()}><RefreshCw size={13} />刷新运行</Button>
            </div>

            {job.latestRunStatus === null && runs.length === 0 && !runsRequest.isPending ? (
              <p className="mt-4 text-label text-muted-foreground">还没有运行记录。保存任务配置后，可从右上角启动一次采集。</p>
            ) : null}
          </TabsPanel>

          <TabsPanel value="configuration" className="py-0">
            <div className="px-5 py-4">
              <JobConfigurationEditor jobId={jobId} />
            </div>
          </TabsPanel>

          <TabsPanel value="scheduling" className="px-5 py-4">
            {dolphin ? <SchedulePanel jobId={jobId} jobName={job.name} /> : (
              <EmptyState
                minHeight={220}
                icon={<Activity />}
                title="该任务不使用平台调度"
                description="中心采集执行器的任务由门户启动，或由平台调度绑定的工作流触发。需要周期执行时，请选择平台调度通道。"
              />
            )}
          </TabsPanel>

          <TabsPanel value="runs" className="px-0 py-0">
            <RunsTable
              runs={runs}
              loading={runsRequest.isPending}
              job={job}
              busy={runAction.isPending}
              actingRunId={runAction.variables?.run.id ?? null}
              onSync={(run) => runAction.mutate({ run, action: 'sync' })}
              onRetry={(run) => runAction.mutate({ run, action: 'retry' })}
              onConfirmAbsent={(run) => runAction.mutate({ run, action: 'confirm-absent' })}
            />
          </TabsPanel>
        </Tabs>
      </Panel>

      <CopyJobDialog
        job={copyOpen ? job : null}
        sources={sources}
        onOpenChange={(open) => setCopyOpen(open)}
        onCopied={(copy) => navigate(workLinks.ingestionJob(copy.id))}
      />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mb-1 text-meta text-muted-foreground">{label}</dt>
      <dd className="m-0 text-body-sm text-ink-soft">{value}</dd>
    </div>
  )
}

/** 运行时间线：最近 10 次，附对账与重试入口（人工对账在同步之外单列）。 */
function RunsTable({
  runs,
  loading,
  job,
  busy,
  actingRunId,
  onSync,
  onRetry,
  onConfirmAbsent,
}: {
  runs: IngestionRunApiItem[]
  loading: boolean
  job: IngestionJobApiItem
  busy: boolean
  actingRunId: string | null
  onSync: (run: IngestionRunApiItem) => void
  onRetry: (run: IngestionRunApiItem) => void
  onConfirmAbsent: (run: IngestionRunApiItem) => void
}) {
  if (loading && runs.length === 0) return <LoadingBlock className="min-h-[200px]">正在读取运行记录…</LoadingBlock>
  if (runs.length === 0) {
    return <EmptyState minHeight={220} icon={<Activity />} title="还没有运行记录" description="保存任务配置后，可从页头启动一次采集；平台定时触发的实例在「调度」页。" />
  }
  return (
    <ol className="m-0 list-none p-0">
      {runs.slice(0, 10).map((run) => {
        const status = runStatusView(run.status)
        const active = ACTIVE_RUN_STATUSES.includes(run.status)
        const manual = run.reconciliationStatus === 'MANUAL_REQUIRED'
        const acting = busy && actingRunId === run.id
        return (
          <li key={run.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusBadge tone={status.tone === 'healthy' ? 'good' : status.tone === 'danger' ? 'bad' : status.tone === 'warning' ? 'running' : 'neutral'}>{status.label}</StatusBadge>
              <span className="text-meta text-muted-foreground">{formatDateTime(run.submittedAt)}</span>
              {run.finishedAt ? <span className="text-meta text-muted-foreground">完成 {formatDateTime(run.finishedAt)}</span> : null}
              <span className="ml-auto font-mono text-meta text-muted-foreground">{run.id.slice(0, 12)}</span>
            </div>
            <p className="mt-1 text-label leading-relaxed text-muted-foreground">{businessMessage(run.message)}</p>
            {manual ? (
              <div role="status" className="mt-2 rounded-control border border-[#eee2c5] bg-[#fdf9ef] px-3 py-2 text-label text-amber">
                <strong>待人工对账：</strong>{run.reconciliationMessage ?? '请先确认外部运行不存在后再重试。'}
                <div className="mt-1.5 flex gap-2">
                  <Button variant="outline" size="sm" disabled={acting} onClick={() => onSync(run)}>重新查询</Button>
                  <Button size="sm" variant="destructive-outline" disabled={acting} onClick={() => onConfirmAbsent(run)}>确认不存在</Button>
                </div>
              </div>
            ) : null}
            <div className="mt-1.5 flex gap-2">
              {active && !manual ? <Button variant="link" disabled={acting} onClick={() => onSync(run)}><RefreshCw size={12} />同步状态</Button> : null}
              {retryableRunStatus(run.status) ? (
                <Button variant="link" disabled={acting || job.status !== 'ACTIVE'} onClick={() => onRetry(run)}><RotateCcw size={12} />重试</Button>
              ) : null}
            </div>
          </li>
        )
      })}
      {runs.length > 10 ? <li className="px-5 py-3 text-meta text-muted-foreground">仅显示最近 10 次运行。</li> : null}
    </ol>
  )
}

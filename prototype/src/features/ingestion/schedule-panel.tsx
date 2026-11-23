import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Eye, ListTree, Power, RotateCcw, Save, Square, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, StatusText } from '../../components/kit/badge'
import { Button } from '../../components/kit/button'
import { FormField, FormGrid, FormNotice } from '../../components/kit/form'
import { Input, NativeSelect } from '../../components/kit/input'
import { Confirm } from '../../components/kit/overlay'
import { Panel, PanelHead } from '../../components/kit/panel'
import { EmptyState, LoadingInline } from '../../components/kit/states'
import { DataTable, listColumnHelper, TablePagination } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  backfillScheduleInstances,
  changeJobScheduleState,
  deleteJobSchedule,
  previewJobSchedule,
  retryScheduleInstance,
  saveJobSchedule,
  stopScheduleInstance,
  type JobScheduleApiItem,
  type ScheduleInstanceApiItem,
} from '../../data/controlPlane'
import { formatDateTime } from '../../data/domain'
import { ingestionKeys, jobScheduleQuery, scheduleInstancesQuery, scheduleTaskLogQuery, scheduleTasksQuery } from './queries'
import { buildCron, parseCron, shiftMinutes, toDsTime, toLocalInput } from './cron'
import { errorMessage } from './labels'

const INSTANCE_PAGE_SIZE = 10

const instanceHelper = listColumnHelper<ScheduleInstanceApiItem>()

function instanceTone(state: string): 'good' | 'bad' | 'running' | 'neutral' {
  if (state === 'SUCCEEDED') return 'good'
  if (state === 'FAILED') return 'bad'
  if (state === 'RUNNING') return 'running'
  return 'neutral'
}

function instanceLabel(state: string): string {
  switch (state) {
    case 'SUCCEEDED': return '成功'
    case 'FAILED': return '失败'
    case 'RUNNING': return '运行中'
    case 'SUBMITTED': return '排队中'
    case 'CANCELED': return '已终止'
    default: return '未知'
  }
}

/**
 * 周期调度（任务详情 · 调度页）：配置、上下线、补数、实例/任务/日志。
 * 调度平台是唯一事实源；保存不改变上下线状态，删除只移除周期计划（任务回到手动调度）。
 */
export function SchedulePanel({ jobId, jobName }: { jobId: string; jobName: string }) {
  const queryClient = useQueryClient()
  const notify = useNotice()
  const scheduleRequest = useQuery(jobScheduleQuery(jobId))

  const [preset, setPreset] = useState<'daily' | 'hourly' | 'everyNHours' | 'everyNMinutes' | 'once'>('daily')
  const [advanced, setAdvanced] = useState(false)
  const [dailyTime, setDailyTime] = useState('02:30')
  const [rangeStart, setRangeStart] = useState('08:00')
  const [rangeEnd, setRangeEnd] = useState('18:00')
  const [interval, setIntervalValue] = useState('2')
  const [onceAt, setOnceAt] = useState('')
  const [crontab, setCrontab] = useState('0 30 2 * * ?')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [preview, setPreview] = useState<{ source: 'DS' | 'LOCAL'; fireTimes: string[] } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [instPage, setInstPage] = useState(0)
  const [expandedInstance, setExpandedInstance] = useState<number | null>(null)
  const [logTask, setLogTask] = useState<{ instanceId: number; taskId: number } | null>(null)
  const [backfillStart, setBackfillStart] = useState('')
  const [backfillEnd, setBackfillEnd] = useState('')

  const instancesRequest = useQuery(scheduleInstancesQuery(jobId, instPage, INSTANCE_PAGE_SIZE))
  const tasksRequest = useQuery({ ...scheduleTasksQuery(jobId, expandedInstance ?? 0), enabled: expandedInstance !== null })
  const logRequest = useQuery({ ...scheduleTaskLogQuery(jobId, logTask?.instanceId ?? 0, logTask?.taskId ?? 0), enabled: logTask !== null })

  function refill(item: JobScheduleApiItem) {
    setStartTime(toLocalInput(item.startTime))
    setEndTime(toLocalInput(item.endTime))
    if (!item.crontab) return
    setCrontab(item.crontab)
    const parsed = parseCron(item.crontab)
    if (parsed.kind === 'advanced') {
      setAdvanced(true)
      return
    }
    setAdvanced(false)
    setPreset(parsed.preset)
    if (parsed.preset === 'daily') setDailyTime(parsed.dailyTime)
    if (parsed.preset === 'hourly' || parsed.preset === 'everyNHours' || parsed.preset === 'everyNMinutes') {
      setRangeStart(parsed.rangeStart)
      setRangeEnd(parsed.rangeEnd)
      if (parsed.preset === 'everyNHours' || parsed.preset === 'everyNMinutes') setIntervalValue(parsed.interval)
    }
  }

  useEffect(() => {
    if (scheduleRequest.data) refill(scheduleRequest.data)
  }, [scheduleRequest.data])

  const composedCrontab = advanced ? crontab.trim() : buildCron({ preset, dailyTime, rangeStart, rangeEnd, interval, onceAt })
  const composedStart = advanced ? startTime : preset === 'once' ? onceAt : startTime
  const composedEnd = advanced ? endTime : preset === 'once' ? shiftMinutes(onceAt, 60) : endTime

  const saveMutation = useMutation({
    mutationFn: () => saveJobSchedule(jobId, {
      crontab: composedCrontab,
      ...(composedStart ? { startTime: toDsTime(composedStart) } : {}),
      ...(composedEnd ? { endTime: toDsTime(composedEnd) } : {}),
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(ingestionKeys.schedule(jobId), next)
      refill(next)
      setPreview(null)
      notify('调度配置已保存（新建后为下线态，需显式上线）')
    },
    onError: (cause) => notify(errorMessage(cause, '调度配置保存失败')),
  })

  const stateMutation = useMutation({
    mutationFn: (online: boolean) => changeJobScheduleState(jobId, online),
    onSuccess: (next, online) => {
      queryClient.setQueryData(ingestionKeys.schedule(jobId), next)
      refill(next)
      notify(online ? '调度已上线，平台调度将按 CRON 触发工作流' : '调度已下线，不再周期触发')
    },
    onError: (cause, online) => notify(errorMessage(cause, online ? '调度上线失败' : '调度下线失败')),
  })

  const previewMutation = useMutation({
    mutationFn: () => previewJobSchedule(jobId, {
      crontab: composedCrontab,
      ...(composedStart ? { startTime: toDsTime(composedStart) } : {}),
      ...(composedEnd ? { endTime: toDsTime(composedEnd) } : {}),
    }),
    onSuccess: setPreview,
    onError: (cause) => notify(errorMessage(cause, '触发时间预览失败')),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteJobSchedule(jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.schedule(jobId) })
      setDeleteOpen(false)
      notify('调度已删除，任务回到手动调度')
    },
    onError: (cause) => notify(errorMessage(cause, '调度删除失败')),
  })

  const instanceMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'stop' | 'retry' }) => action === 'stop' ? stopScheduleInstance(jobId, id) : retryScheduleInstance(jobId, id),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...ingestionKeys.all, 'job', jobId, 'instances'] })
      notify(variables.action === 'stop' ? '已发出终止指令，实例状态以平台调度为准' : '已发出重跑指令，实例状态以平台调度为准')
    },
    onError: (cause, variables) => notify(errorMessage(cause, variables.action === 'stop' ? '实例终止失败' : '实例重跑失败')),
  })

  const backfillMutation = useMutation({
    mutationFn: () => backfillScheduleInstances(jobId, { startDate: backfillStart, endDate: backfillEnd }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ingestionKeys.all, 'job', jobId, 'instances'] })
      setInstPage(0)
      notify('补数已提交（平台调度将按日期逐日触发）')
    },
    onError: (cause) => notify(errorMessage(cause, '补数提交失败')),
  })

  const schedule = scheduleRequest.data
  const strategy = schedule?.scheduled
    ? schedule.online ? { label: '周期调度 · 上线中', tone: 'success' as const } : { label: '周期调度 · 已下线', tone: 'warn' as const }
    : { label: '手动调度', tone: 'neutral' as const }
  const busy = saveMutation.isPending || stateMutation.isPending

  const instanceColumns = instanceHelper.columns([
    instanceHelper.accessor('name', { header: '实例', cell: ({ row }) => <span className="text-body-sm text-ink">{row.original.name}</span> }),
    instanceHelper.display({
      id: 'state',
      header: '状态',
      size: 110,
      cell: ({ row }) => <StatusText tone={instanceTone(row.original.state)}>{instanceLabel(row.original.state)}</StatusText>,
    }),
    instanceHelper.display({
      id: 'start',
      header: '开始时间',
      size: 150,
      cell: ({ row }) => <span className="text-label text-ink-soft">{formatDateTime(row.original.startTime)}</span>,
    }),
    instanceHelper.display({
      id: 'end',
      header: '结束时间',
      size: 150,
      cell: ({ row }) => <span className="text-label text-ink-soft">{formatDateTime(row.original.endTime)}</span>,
    }),
    instanceHelper.display({
      id: 'actions',
      header: '操作',
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5" onClick={(event) => event.stopPropagation()}>
          <Button variant="text" onClick={() => setExpandedInstance((current) => current === row.original.id ? null : row.original.id)}>
            {expandedInstance === row.original.id ? '收起任务' : '查看任务'}
          </Button>
          <Button variant="text" disabled={instanceMutation.isPending} onClick={() => instanceMutation.mutate({ id: row.original.id, action: 'stop' })}>
            <Square size={12} />终止
          </Button>
          <Button variant="text" disabled={instanceMutation.isPending} onClick={() => instanceMutation.mutate({ id: row.original.id, action: 'retry' })}>
            <RotateCcw size={12} />重跑
          </Button>
        </div>
      ),
    }),
  ])

  return (
    <div className="space-y-3.5">
      <Panel>
        <PanelHead title="调度配置" description={`周期调度 · ${jobName}`} actions={<Badge tone={strategy.tone}>{strategy.label}</Badge>} />
        <div className="px-5 pb-5">
          <FormNotice icon={<CalendarClock />}>
            调度由平台调度引擎执行，调度平台是唯一事实源；本页每次打开实时读取。保存不改变上下线状态，新建调度需显式上线。平台定时触发的运行在「调度实例」中查看（门户发起的运行才进任务运行记录）。
          </FormNotice>

          {scheduleRequest.isPending ? <LoadingInline>正在读取当前调度状态…</LoadingInline> : null}
          {scheduleRequest.isError ? <p role="alert" className="text-body-sm text-red">{errorMessage(scheduleRequest.error, '调度状态读取失败')}</p> : null}

          {schedule ? (
            <>
              <FormGrid className="mb-1">
                <FormField label="下次触发">{schedule.nextFireTime ? formatDateTime(schedule.nextFireTime) : '—'}</FormField>
                <FormField label="当前 CRON"><code className="font-mono text-label">{schedule.crontab ?? '（未配置）'}</code></FormField>
                <FormField label="生效窗口">{schedule.startTime || schedule.endTime ? `${schedule.startTime ?? '…'} ~ ${schedule.endTime ?? '…'}` : '长期有效'}</FormField>
                <FormField label="时区">{schedule.timezoneId ?? '平台默认'}</FormField>
              </FormGrid>

              <FormField label={`调度策略${advanced ? '（高级模式 · 直接编辑 CRON）' : ''}`} htmlFor="schedule-preset">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                  <NativeSelect
                    id="schedule-preset"
                    className="min-h-[35px]"
                    value={advanced ? 'advanced' : preset}
                    disabled={advanced}
                    onChange={(event) => setPreset(event.target.value as typeof preset)}
                  >
                    <option value="daily">周期 · 每天（HH:mm）</option>
                    <option value="hourly">周期 · 时段内每小时</option>
                    <option value="everyNHours">周期 · 时段内每 N 小时</option>
                    <option value="everyNMinutes">周期 · 时段内每 N 分钟</option>
                    <option value="once">延迟一次 · 指定时刻触发</option>
                    {advanced ? <option value="advanced">高级模式 · 直编 CRON</option> : null}
                  </NativeSelect>
                  <label className="flex items-center gap-2 text-label text-ink-soft">
                    <input type="checkbox" className="size-[13px] accent-blue" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />
                    高级模式（直接编辑 CRON）
                  </label>
                </div>
              </FormField>

              {advanced ? (
                <FormField label="CRON 表达式（秒 分 时 日 月 周，六位）" htmlFor="schedule-cron">
                  <Input id="schedule-cron" className="font-mono" value={crontab} onChange={(event) => setCrontab(event.target.value)} spellCheck={false} placeholder="0 30 2 * * ?" />
                </FormField>
              ) : preset === 'daily' ? (
                <FormField label="每天执行时刻" htmlFor="schedule-daily">
                  <Input id="schedule-daily" type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} className="w-[160px]" />
                </FormField>
              ) : preset === 'once' ? (
                <FormField label="触发时刻（到点触发一次；触发后建议删除调度）" htmlFor="schedule-once">
                  <Input id="schedule-once" type="datetime-local" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} className="w-[220px]" />
                </FormField>
              ) : (
                <FormGrid>
                  <FormField label="每日时段起（时:分）" htmlFor="schedule-range-start">
                    <Input id="schedule-range-start" type="time" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
                  </FormField>
                  <FormField label="每日时段止（时:分）" htmlFor="schedule-range-end">
                    <Input id="schedule-range-end" type="time" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
                  </FormField>
                  {preset !== 'hourly' ? (
                    <FormField label={`间隔（${preset === 'everyNHours' ? '小时 1-11' : '分钟 1-59'}）`} htmlFor="schedule-interval">
                      <Input id="schedule-interval" type="number" min={1} max={preset === 'everyNHours' ? 11 : 59} value={interval} onChange={(event) => setIntervalValue(event.target.value)} />
                    </FormField>
                  ) : null}
                </FormGrid>
              )}

              {preset !== 'once' && !advanced ? (
                <FormGrid>
                  <FormField label="生效开始（可空）" htmlFor="schedule-start"><Input id="schedule-start" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></FormField>
                  <FormField label="生效结束（可空）" htmlFor="schedule-end"><Input id="schedule-end" type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></FormField>
                </FormGrid>
              ) : null}

              <FormField label="编译结果">
                <code className="font-mono text-label text-ink-soft">{composedCrontab || '（待填写）'}</code>
                {composedStart ? <small className="ml-2 text-meta text-muted-foreground">生效 {toDsTime(composedStart)} ~ {toDsTime(composedEnd ?? '')}</small> : null}
              </FormField>

              {preview ? (
                <div className="mb-3 rounded-control border border-line bg-wash px-3 py-2.5">
                  <Badge tone={preview.source === 'DS' ? 'success' : 'warn'}>{preview.source === 'DS' ? '平台调度引擎计算' : '引擎不可达 · 本地估算'}</Badge>
                  <ul className="mt-2 space-y-1 text-label text-ink-soft">
                    {preview.fireTimes.map((time) => <li key={time}>{formatDateTime(time)}</li>)}
                    {preview.fireTimes.length === 0 ? <li>生效窗口内无触发时刻</li> : null}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy} onClick={() => previewMutation.mutate()}>
                  <Eye size={13} />{previewMutation.isPending ? '计算中…' : '预览触发时间'}
                </Button>
                <Button size="sm" variant="primary" disabled={busy || !composedCrontab} onClick={() => saveMutation.mutate()}>
                  <Save size={13} />{saveMutation.isPending ? '处理中…' : '保存调度'}
                </Button>
                <Button size="sm" disabled={busy || !schedule.scheduled || schedule.online} onClick={() => stateMutation.mutate(true)}>
                  <Power size={13} />上线
                </Button>
                <Button size="sm" disabled={busy || !schedule.online} onClick={() => stateMutation.mutate(false)}>
                  <Power size={13} />下线
                </Button>
                {schedule.scheduled ? (
                  <Button size="sm" variant="danger-outline" disabled={busy} onClick={() => setDeleteOpen(true)}>
                    <Trash2 size={13} />删除调度
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHead title="调度实例" count={instancesRequest.data?.total ?? 0} description="平台调度触发/补数产生的实例" actions={<Button size="sm" onClick={() => void instancesRequest.refetch()}>刷新</Button>} />
        <div className="px-5 pb-2">
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-control border border-line bg-wash px-3 py-2.5">
            <div>
              <label htmlFor="backfill-start" className="mb-1 block text-meta text-muted-foreground">补数开始日期</label>
              <Input id="backfill-start" type="date" value={backfillStart} onChange={(event) => setBackfillStart(event.target.value)} className="w-[150px]" />
            </div>
            <div>
              <label htmlFor="backfill-end" className="mb-1 block text-meta text-muted-foreground">补数结束日期</label>
              <Input id="backfill-end" type="date" value={backfillEnd} onChange={(event) => setBackfillEnd(event.target.value)} className="w-[150px]" />
            </div>
            <Button
              size="sm"
              disabled={backfillMutation.isPending || !backfillStart || !backfillEnd}
              onClick={() => backfillMutation.mutate()}
            >
              <CalendarClock size={13} />{backfillMutation.isPending ? '提交中…' : '提交补数'}
            </Button>
            <span className="ml-auto text-meta text-muted-foreground">补数按日期逐日触发，与手动运行分开记录。</span>
          </div>
        </div>
        <DataTable
          columns={instanceColumns}
          data={instancesRequest.data?.items ?? []}
          getRowId={(instance) => String(instance.id)}
          rowLabel={(instance) => instance.name}
          loading={instancesRequest.isPending}
          empty={<EmptyState minHeight={200} icon={<ListTree />} title="还没有调度实例" description="调度上线后，平台调度触发的工作流实例会出现在这里。" />}
          footer={<TablePagination page={instPage} pageSize={INSTANCE_PAGE_SIZE} total={instancesRequest.data?.total ?? 0} onPageChange={setInstPage} label="调度实例分页" />}
        />
        {expandedInstance !== null ? (
          <div className="border-t border-line bg-[#fbfcfe] px-5 py-3">
            <div className="mb-2 flex items-center gap-2 text-label font-medium text-ink-soft">任务实例</div>
            {tasksRequest.isPending ? <LoadingInline>正在读取任务…</LoadingInline> : null}
            {tasksRequest.data?.length === 0 ? <p className="text-label text-muted-foreground">该实例还没有任务记录。</p> : null}
            <ul className="space-y-1.5">
              {(tasksRequest.data ?? []).map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-paper px-3 py-2 text-label">
                  <span className="text-ink-soft">{task.name}</span>
                  <StatusText tone={instanceTone(task.state)}>{instanceLabel(task.state)}</StatusText>
                  <span className="text-meta text-muted-foreground">{formatDateTime(task.startTime)} → {formatDateTime(task.endTime)}</span>
                  <Button
                    variant="text"
                    className="ml-auto"
                    onClick={() => setLogTask((current) => current?.taskId === task.id ? null : { instanceId: expandedInstance, taskId: task.id })}
                  >
                    {logTask?.taskId === task.id ? '收起源码' : '查看日志'}
                  </Button>
                </li>
              ))}
            </ul>
            {logTask ? (
              <div className="mt-2">
                {logRequest.isPending ? <LoadingInline>正在读取日志…</LoadingInline> : null}
                {logRequest.isError ? <p className="text-body-sm text-red">{errorMessage(logRequest.error, '日志读取失败')}</p> : null}
                {logRequest.data ? (
                  <pre className="max-h-[240px] overflow-auto rounded-control border border-line bg-[#1d2733] p-3 font-mono text-[11px] leading-relaxed text-[#d7e0ea]">{logRequest.data.logText || '（日志为空）'}</pre>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Confirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除任务调度"
        description="仅删除周期计划，任务回到手动调度；已产生的调度实例保留。"
        object={{ name: jobName, meta: `${jobId} · ${schedule?.crontab ?? '（未配置）'}` }}
        hint="删除后需重新保存调度并显式上线才会再次周期触发。"
        confirmLabel="删除调度"
        tone="destructive"
        busy={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}

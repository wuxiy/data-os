import { CalendarClock, CircleAlert, Eye, ListTree, Power, RefreshCw, Save, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  backfillScheduleInstances,
  changeJobScheduleState,
  deleteJobSchedule,
  fetchJobSchedule,
  fetchScheduleInstances,
  fetchScheduleTaskLog,
  fetchScheduleTasks,
  previewJobSchedule,
  retryScheduleInstance,
  saveJobSchedule,
  stopScheduleInstance,
  type IngestionJobApiItem,
  type JobScheduleApiItem,
  type JobSchedulePreviewApiItem,
  type ScheduleInstanceApiItem,
  type ScheduleTaskApiItem,
} from '../data/controlPlane'
import { Drawer } from '../components/ui/Drawer'
import { StatusTag } from '../components/ui/Primitives'
import { formatDateTime } from '../data/domain'
import local from './JobScheduleDrawer.module.css'
import styles from './Pages.module.css'

/**
 * 周期调度配置抽屉（G2G 批次 5）：nema etl 调度语义的 DS 承接——
 * 手动（无调度）/ 周期（简易四预设编译为 cron，高级模式直编）/ 延迟一次
 * （精确时刻 cron + 窗口收口）。DS 为唯一事实源，抽屉每次打开实时读取。
 */
export function JobScheduleDrawer({ job, onClose, onNotice }: {
  job: IngestionJobApiItem
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const [schedule, setSchedule] = useState<JobScheduleApiItem | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const [advanced, setAdvanced] = useState(false)
  const [preset, setPreset] = useState<'daily' | 'hourly' | 'everyNHours' | 'everyNMinutes' | 'once'>('daily')
  const [dailyTime, setDailyTime] = useState('02:30')
  const [rangeStart, setRangeStart] = useState('08:00')
  const [rangeEnd, setRangeEnd] = useState('18:00')
  const [interval, setIntervalValue] = useState('2')
  const [onceAt, setOnceAt] = useState('')
  const [crontab, setCrontab] = useState('0 30 2 * * ?')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [preview, setPreview] = useState<JobSchedulePreviewApiItem | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef<number | null>(null)

  // 实例页签（G2G 批次 5 第二刀）：DS 触发/补数实例的实时代理面
  const [tab, setTab] = useState<'config' | 'instances'>('config')
  const [instList, setInstList] = useState<ScheduleInstanceApiItem[]>([])
  const [instTotal, setInstTotal] = useState(0)
  const [instPage, setInstPage] = useState(0)
  const [instLoading, setInstLoading] = useState(false)
  const [instError, setInstError] = useState('')
  const [expandedInstance, setExpandedInstance] = useState<number | null>(null)
  const [tasksByInstance, setTasksByInstance] = useState<Record<number, ScheduleTaskApiItem[]>>({})
  const [logByTask, setLogByTask] = useState<Record<number, string>>({})
  const [logOpenTask, setLogOpenTask] = useState<number | null>(null)
  const [backfillStart, setBackfillStart] = useState('')
  const [backfillEnd, setBackfillEnd] = useState('')
  const [backfilling, setBackfilling] = useState(false)
  const [instBusy, setInstBusy] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const next = await fetchJobSchedule(job.id)
      setSchedule(next)
      refill(next)
      setError('')
      setState('ready')
    } catch (cause) {
      setState('error')
      setError(cause instanceof Error ? cause.message : '调度状态读取失败')
    }
  }, [job.id])

  useEffect(() => {
    void load()
  }, [load])

  const loadInstances = useCallback(async (page = instPage) => {
    setInstLoading(true)
    try {
      const result = await fetchScheduleInstances(job.id, { page: page + 1, size: 10 })
      setInstList(result.items)
      setInstTotal(result.total)
      setInstPage(page)
      setInstError('')
    } catch (cause) {
      setInstError(cause instanceof Error ? cause.message : '调度实例读取失败')
    } finally {
      setInstLoading(false)
    }
  }, [job.id, instPage])

  function switchTab(next: 'config' | 'instances') {
    setTab(next)
    if (next === 'instances' && instList.length === 0 && instTotal === 0 && !instLoading) {
      void loadInstances(0)
    }
  }

  async function toggleInstanceTasks(instance: ScheduleInstanceApiItem) {
    if (expandedInstance === instance.id) {
      setExpandedInstance(null)
      return
    }
    setExpandedInstance(instance.id)
    if (!tasksByInstance[instance.id]) {
      try {
        const tasks = await fetchScheduleTasks(job.id, instance.id)
        setTasksByInstance((current) => ({ ...current, [instance.id]: tasks }))
      } catch (cause) {
        onNotice(cause instanceof Error ? cause.message : '任务实例读取失败')
      }
    }
  }

  async function toggleTaskLog(instanceId: number, taskId: number) {
    if (logOpenTask === taskId) {
      setLogOpenTask(null)
      return
    }
    setLogOpenTask(taskId)
    if (logByTask[taskId] === undefined) {
      try {
        const result = await fetchScheduleTaskLog(job.id, instanceId, taskId, 200)
        setLogByTask((current) => ({ ...current, [taskId]: result.logText }))
      } catch (cause) {
        onNotice(cause instanceof Error ? cause.message : '日志读取失败')
      }
    }
  }

  async function instanceAction(instance: ScheduleInstanceApiItem, action: 'stop' | 'retry') {
    setInstBusy(true)
    try {
      if (action === 'stop') await stopScheduleInstance(job.id, instance.id)
      else await retryScheduleInstance(job.id, instance.id)
      onNotice(action === 'stop' ? '已发出终止指令，实例状态以平台调度为准' : '已发出重跑指令，实例状态以平台调度为准')
      await loadInstances()
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : (action === 'stop' ? '实例终止失败' : '实例重跑失败'))
    } finally {
      setInstBusy(false)
    }
  }

  async function submitBackfill() {
    if (!backfillStart || !backfillEnd) {
      onNotice('补数需要开始与结束日期')
      return
    }
    setBackfilling(true)
    try {
      await backfillScheduleInstances(job.id, { startDate: backfillStart, endDate: backfillEnd })
      onNotice('补数已提交（平台调度将按日期逐日触发）')
      await loadInstances(0)
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '补数提交失败')
    } finally {
      setBackfilling(false)
    }
  }

  useEffect(() => () => {
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current)
  }, [])

  /** 把已保存的 cron 回填到简易表单；对不上任何预设形态时切高级模式。 */
  function refill(item: JobScheduleApiItem) {
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
    if (parsed.preset === 'once') setOnceAt('')
    setStartTime(toLocalInput(item.startTime))
    setEndTime(toLocalInput(item.endTime))
  }

  const composedCrontab = advanced ? crontab.trim() : buildCron({ preset, dailyTime, rangeStart, rangeEnd, interval, onceAt })
  const composedStart = advanced ? startTime : preset === 'once' ? onceAt : startTime
  const composedEnd = advanced ? endTime : preset === 'once' ? shiftMinutes(onceAt, 60) : endTime

  async function submitPreview() {
    setPreviewLoading(true)
    try {
      const next = await previewJobSchedule(job.id, {
        crontab: composedCrontab,
        ...(composedStart ? { startTime: toDsTime(composedStart) } : {}),
        ...(composedEnd ? { endTime: toDsTime(composedEnd) } : {}),
      })
      setPreview(next)
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '触发时间预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function save() {
    if (!composedCrontab) {
      onNotice('CRON 表达式不能为空')
      return
    }
    setSaving(true)
    try {
      const next = await saveJobSchedule(job.id, {
        crontab: composedCrontab,
        ...(composedStart ? { startTime: toDsTime(composedStart) } : {}),
        ...(composedEnd ? { endTime: toDsTime(composedEnd) } : {}),
      })
      setSchedule(next)
      refill(next)
      setPreview(null)
      onNotice('调度配置已保存（新建后为下线态，需显式上线）')
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '调度配置保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function toggleOnline(online: boolean) {
    setSaving(true)
    try {
      const next = await changeJobScheduleState(job.id, online)
      setSchedule(next)
      refill(next)
      onNotice(online ? '调度已上线，平台调度将按 CRON 触发工作流' : '调度已下线，不再周期触发')
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : (online ? '调度上线失败' : '调度下线失败'))
    } finally {
      setSaving(false)
    }
  }

  function requestDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      confirmTimer.current = window.setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current)
    setConfirmDelete(false)
    void deleteJobSchedule(job.id)
      .then(() => {
        onNotice('调度已删除，任务回到手动调度')
        return load()
      })
      .catch((cause: unknown) => {
        onNotice(cause instanceof Error ? cause.message : '调度删除失败')
      })
  }

  const strategy = schedule?.scheduled
    ? schedule.online ? { label: '周期调度 · 上线中', tone: 'healthy' as const }
      : { label: '周期调度 · 已下线', tone: 'warning' as const }
    : { label: '手动调度', tone: 'neutral' as const }

  return (
    <Drawer
      titleId="job-schedule-title"
      eyebrow={`周期调度 · ${job.name}`}
      title="调度配置"
      closeLabel="关闭调度配置"
      onClose={onClose}
      footer={<>
        <button className={styles.secondaryButton} type="button" onClick={onClose}>关闭</button>
        <button className={styles.secondaryButton} type="button" disabled={saving || previewLoading} onClick={() => void submitPreview()}><Eye size={14} />{previewLoading ? '计算中…' : '预览触发时间'}</button>
        <button className={styles.primaryButton} type="button" disabled={saving || previewLoading} onClick={() => void save()}><Save size={14} />{saving ? '处理中…' : '保存调度'}</button>
      </>}
    >
      <div className={styles.drawerNotice}><CalendarClock size={16} /><span>调度由平台调度引擎执行，调度平台是唯一事实源；本页每次打开实时读取。保存不改变上下线状态，新建调度需显式上线。平台定时触发的运行在「调度实例」中查看（门户发起的运行才进任务运行记录）。</span></div>

      <div className={`${styles.toolbarRow} ${local.toolbarBlock}`} role="tablist" aria-label="调度管理">
        <button type="button" role="tab" aria-selected={tab === 'config'} className={tab === 'config' ? styles.primaryButton : styles.textButton} onClick={() => switchTab('config')}><CalendarClock size={14} />调度配置</button>
        <button type="button" role="tab" aria-selected={tab === 'instances'} className={tab === 'instances' ? styles.primaryButton : styles.textButton} onClick={() => switchTab('instances')}><ListTree size={14} />调度实例</button>
      </div>

      {state === 'loading' ? <p className={styles.drawerHint}>正在读取当前调度状态…</p> : null}
      {state === 'error' ? <p className={styles.formError} role="alert">{error}</p> : null}

      {tab === 'config' && state === 'ready' && schedule ? <>
        <div className={styles.drawerFormGrid}>
          <div className={styles.formField}><label>当前策略</label><div><StatusTag tone={strategy.tone}>{strategy.label}</StatusTag></div></div>
          <div className={styles.formField}><label>下次触发</label><div>{schedule.nextFireTime ? formatDateTime(schedule.nextFireTime) : '—'}</div></div>
          <div className={styles.formField}><label>当前 CRON</label><div><code>{schedule.crontab ?? '（未配置）'}</code></div></div>
          <div className={styles.formField}><label>生效窗口</label><div>{schedule.startTime || schedule.endTime ? `${schedule.startTime ?? '…'} ~ ${schedule.endTime ?? '…'}` : '长期有效'}</div></div>
        </div>

        <div className={styles.formField}>
          <label htmlFor="schedule-preset">调度策略{advanced ? '（高级模式 · 直接编辑 CRON）' : ''}</label>
          <div className={styles.drawerFormGrid}>
            <select id="schedule-preset" value={advanced ? 'advanced' : preset} disabled={advanced} onChange={(event) => setPreset(event.target.value as typeof preset)}>
              <option value="daily">周期 · 每天（HH:mm）</option>
              <option value="hourly">周期 · 时段内每小时</option>
              <option value="everyNHours">周期 · 时段内每 N 小时</option>
              <option value="everyNMinutes">周期 · 时段内每 N 分钟</option>
              <option value="once">延迟一次 · 指定时刻触发</option>
              {advanced ? <option value="advanced">高级模式 · 直编 CRON</option> : null}
            </select>
            <label className={local.advancedToggle}>
              <input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />
              高级模式（直接编辑 CRON）
            </label>
          </div>
        </div>

        {advanced ? (
          <div className={styles.formField}>
            <label htmlFor="schedule-cron">CRON 表达式（秒 分 时 日 月 周，六位）</label>
            <input id="schedule-cron" className={styles.codeInput} value={crontab} onChange={(event) => setCrontab(event.target.value)} spellCheck={false} placeholder="0 30 2 * * ?" />
          </div>
        ) : preset === 'daily' ? (
          <div className={styles.formField}><label htmlFor="schedule-daily">每天执行时刻</label><input id="schedule-daily" type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} /></div>
        ) : preset === 'once' ? (
          <div className={styles.formField}>
            <label htmlFor="schedule-once">触发时刻（到点触发一次；触发后建议删除调度）</label>
            <input id="schedule-once" type="datetime-local" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} />
          </div>
        ) : (
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="schedule-range-start">每日时段起（时:分）</label><input id="schedule-range-start" type="time" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></div>
            <div className={styles.formField}><label htmlFor="schedule-range-end">每日时段止（时:分）</label><input id="schedule-range-end" type="time" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></div>
            {preset !== 'hourly' ? (
              <div className={styles.formField}><label htmlFor="schedule-interval">间隔（{preset === 'everyNHours' ? '小时 1-11' : '分钟 1-59'}）</label><input id="schedule-interval" type="number" min={1} max={preset === 'everyNHours' ? 11 : 59} value={interval} onChange={(event) => setIntervalValue(event.target.value)} /></div>
            ) : null}
          </div>
        )}

        {preset !== 'once' && !advanced ? (
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="schedule-start">生效开始（可空）</label><input id="schedule-start" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
            <div className={styles.formField}><label htmlFor="schedule-end">生效结束（可空）</label><input id="schedule-end" type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
          </div>
        ) : null}

        <div className={styles.formField}>
          <label>编译结果</label>
          <div><code>{composedCrontab || '（待填写）'}</code>{composedStart ? <small> · 生效 {toDsTime(composedStart)} ~ {toDsTime(composedEnd ?? '')}</small> : null}</div>
        </div>

        {preview ? (
          <div className={styles.checkResult}>
            <StatusTag tone={preview.source === 'DS' ? 'healthy' : 'warning'}>{preview.source === 'DS' ? '平台调度引擎计算' : '引擎不可达 · 本地估算'}</StatusTag>
            <ul>
              {preview.fireTimes.map((time) => <li key={time}>{formatDateTime(time)}</li>)}
              {preview.fireTimes.length === 0 ? <li>生效窗口内无触发时刻</li> : null}
            </ul>
          </div>
        ) : null}

        <div className={`${styles.toolbarRow} ${local.toolbarBlock}`}>
          <button className={styles.secondaryButton} type="button" disabled={saving || !schedule.scheduled || schedule.online} onClick={() => void toggleOnline(true)}><Power size={14} />上线</button>
          <button className={styles.secondaryButton} type="button" disabled={saving || !schedule.scheduled || !schedule.online} onClick={() => void toggleOnline(false)}><Power size={14} />下线</button>
          <button className={styles.secondaryButton} type="button" disabled={saving || !schedule.scheduled} onClick={requestDelete}>
            <Trash2 size={14} />{confirmDelete ? '再次点击确认删除' : '删除调度'}
          </button>
        </div>
        {schedule.scheduled ? null : (
          <p className={styles.drawerHint}><CircleAlert size={13} /> 手动调度=任务不在平台调度周期触发；仍可在任务列表手动启动。</p>
        )}
      </> : null}

      {tab === 'instances' ? <>
        <div className={styles.drawerFormGrid}>
          <div className={styles.formField}><label htmlFor="backfill-start">补数开始日期</label><input id="backfill-start" type="date" value={backfillStart} onChange={(event) => setBackfillStart(event.target.value)} /></div>
          <div className={styles.formField}><label htmlFor="backfill-end">补数结束日期</label><input id="backfill-end" type="date" value={backfillEnd} onChange={(event) => setBackfillEnd(event.target.value)} /></div>
          <div className={styles.formField}><label>区间补数</label><button type="button" className={styles.secondaryButton} disabled={backfilling} onClick={() => void submitBackfill()}><RefreshCw size={14} />{backfilling ? '提交中…' : '按日补跑'}</button></div>
        </div>
        <p className={styles.drawerHint}>补数按日期区间让平台调度逐日重跑工作流；实例状态由调度平台实时读取，门户发起的运行仍在任务运行记录中。</p>

        <div className={`${styles.toolbarRow} ${local.toolbarBlock}`}>
          <strong>调度实例（{instTotal}）</strong>
          <button type="button" className={styles.secondaryButton} disabled={instLoading} onClick={() => void loadInstances()}><RefreshCw size={13} />刷新</button>
          <button type="button" className={styles.secondaryButton} disabled={instLoading || instPage === 0} onClick={() => void loadInstances(instPage - 1)}>上一页</button>
          <button type="button" className={styles.secondaryButton} disabled={instLoading || (instPage + 1) * 10 >= instTotal} onClick={() => void loadInstances(instPage + 1)}>下一页</button>
        </div>
        {instLoading ? <p className={styles.drawerHint}>正在读取调度实例…</p> : null}
        {instError ? <p className={styles.formError} role="alert">{instError}</p> : null}

        {instList.map((instance) => <div key={instance.id} className={styles.instanceBlock}>
          <div className={styles.instanceHead}>
            <StatusTag tone={instanceTone(instance.state)}>{instanceLabel(instance.state)}</StatusTag>
            <strong>{instance.name ?? `实例 ${instance.id}`}</strong>
            <small>#{instance.id} · {instance.startTime ? formatDateTime(instance.startTime) : '—'}{instance.endTime ? ` ~ ${formatDateTime(instance.endTime)}` : ''}{instance.host ? ` · ${instance.host}` : ''}</small>
            <div className={styles.instanceActions}>
              <button type="button" className={styles.tableButton} onClick={() => void toggleInstanceTasks(instance)}><ListTree size={13} />{expandedInstance === instance.id ? '收起任务' : '任务与日志'}</button>
              {instance.state === 'RUNNING' ? <button type="button" className={styles.tableButton} disabled={instBusy} onClick={() => void instanceAction(instance, 'stop')}><Square size={13} />终止</button> : null}
              {instance.state === 'SUCCEEDED' || instance.state === 'FAILED' || instance.state === 'CANCELED' ? <button type="button" className={styles.tableButton} disabled={instBusy} onClick={() => void instanceAction(instance, 'retry')}><RefreshCw size={13} />重跑</button> : null}
            </div>
          </div>
          {expandedInstance === instance.id ? <div className={styles.instanceTasks}>
            {(tasksByInstance[instance.id] ?? []).map((task) => <div key={task.id}>
              <div className={styles.instanceHead}>
                <StatusTag tone={instanceTone(task.state)}>{instanceLabel(task.state)}</StatusTag>
                <strong>{task.name}</strong>
                <small>{task.startTime ? formatDateTime(task.startTime) : '—'}{task.endTime ? ` ~ ${formatDateTime(task.endTime)}` : ''}</small>
                <div className={styles.instanceActions}>
                  <button type="button" className={styles.tableButton} onClick={() => void toggleTaskLog(instance.id, task.id)}>{logOpenTask === task.id ? '收起日志' : '日志尾部'}</button>
                </div>
              </div>
              {logOpenTask === task.id ? <pre className={styles.logTail}>{logByTask[task.id] ?? '（无日志内容）'}</pre> : null}
            </div>)}
            {(tasksByInstance[instance.id] ?? []).length === 0 ? <p className={styles.drawerHint}>该实例暂无任务实例记录。</p> : null}
          </div> : null}
        </div>)}
        {!instLoading && instList.length === 0 && !instError ? <p className={styles.drawerHint}>暂无调度实例——配置并上线调度，或提交补数后可见。</p> : null}
      </> : null}
    </Drawer>
  )
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

function instanceTone(state: string): 'healthy' | 'warning' | 'danger' | 'neutral' {
  switch (state) {
    case 'SUCCEEDED': return 'healthy'
    case 'FAILED': return 'danger'
    case 'RUNNING': return 'warning'
    default: return 'neutral'
  }
}

/** 简易四预设 + 延迟一次 → cron 编译（只产出可精确表达的形态；其余走高级模式）。 */
function buildCron(input: {
  preset: string
  dailyTime: string
  rangeStart: string
  rangeEnd: string
  interval: string
  onceAt: string
}): string {
  const [sh, sm] = splitTime(input.dailyTime, '02:30')
  const [hs] = splitTime(input.rangeStart, '08:00')
  const [he] = splitTime(input.rangeEnd, '18:00')
  const n = Math.max(1, Math.floor(Number(input.interval) || 1))
  switch (input.preset) {
    case 'daily':
      return `0 ${sm} ${sh} * * ?`
    case 'hourly':
      return `0 ${sm} ${hs}-${he} * * ?`
    case 'everyNHours':
      return `0 ${sm} ${hs}-${he}/${Math.min(n, 11)} * * ?`
    case 'everyNMinutes':
      return `0 0/${Math.min(n, 59)} ${hs}-${he} * * ?`
    case 'once': {
      if (!input.onceAt) return ''
      const [date, time] = input.onceAt.split('T')
      const [hh, mm] = (time ?? '00:00').split(':')
      const [y, mo, d] = date.split('-')
      return `0 ${mm} ${hh} ${d} ${mo} ?`
    }
    default:
      return ''
  }
}

type ParsedCron =
  | { kind: 'advanced' }
  | { kind: 'simple'; preset: 'daily'; dailyTime: string }
  | { kind: 'simple'; preset: 'hourly' | 'everyNHours'; rangeStart: string; rangeEnd: string; interval: string }
  | { kind: 'simple'; preset: 'everyNMinutes'; rangeStart: string; rangeEnd: string; interval: string }
  | { kind: 'simple'; preset: 'once' }

/** 已保存 cron 的形态识别：只认本组件编译产出的精确形态，其余回高级模式。 */
function parseCron(crontab: string): ParsedCron {
  const daily = /^0 (\d{1,2}) (\d{1,2}) \* \* \?$/.exec(crontab)
  if (daily) return { kind: 'simple', preset: 'daily', dailyTime: `${pad(daily[2])}:${pad(daily[1])}` }
  const hours = /^0 (\d{1,2}) (\d{1,2})-(\d{1,2}) \* \* \?$/.exec(crontab)
  if (hours) return { kind: 'simple', preset: 'hourly', rangeStart: `${pad(hours[2])}:${pad(hours[1])}`, rangeEnd: `${pad(hours[3])}:00`, interval: '2' }
  const stepHours = /^0 (\d{1,2}) (\d{1,2})-(\d{1,2})\/(\d{1,2}) \* \* \?$/.exec(crontab)
  if (stepHours) return { kind: 'simple', preset: 'everyNHours', rangeStart: `${pad(stepHours[2])}:${pad(stepHours[1])}`, rangeEnd: `${pad(stepHours[3])}:00`, interval: stepHours[4] }
  const stepMinutes = /^0 0\/(\d{1,2}) (\d{1,2})-(\d{1,2}) \* \* \?$/.exec(crontab)
  if (stepMinutes) return { kind: 'simple', preset: 'everyNMinutes', rangeStart: `${pad(stepMinutes[2])}:00`, rangeEnd: `${pad(stepMinutes[3])}:00`, interval: stepMinutes[1] }
  return { kind: 'advanced' }
}

function splitTime(value: string, fallback: string): [string, string] {
  const parts = (value || fallback).split(':')
  return [pad(parts[0] ?? '0'), pad(parts[1] ?? '0')]
}

function pad(value: string): string {
  return value.padStart(2, '0')
}

/** datetime-local 值 → DS 本地时间串（yyyy-MM-dd HH:mm:ss）。 */
function toDsTime(value: string): string {
  if (!value) return ''
  return value.length === 16 ? `${value.replace('T', ' ')}:00` : value.replace('T', ' ')
}

/** DS 本地时间串 → datetime-local 值（截掉秒）。 */
function toLocalInput(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 16).replace(' ', 'T')
}

/** 延迟一次的生效窗口终点：+n 分钟。 */
function shiftMinutes(value: string, minutes: number): string {
  if (!value) return ''
  const date = new Date(`${value.replace('T', ' ')}`)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() + minutes)
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

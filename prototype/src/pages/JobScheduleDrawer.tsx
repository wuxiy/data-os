import { CalendarClock, CircleAlert, Eye, Power, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  changeJobScheduleState,
  deleteJobSchedule,
  fetchJobSchedule,
  previewJobSchedule,
  saveJobSchedule,
  type IngestionJobApiItem,
  type JobScheduleApiItem,
  type JobSchedulePreviewApiItem,
} from '../data/controlPlane'
import { Drawer } from '../components/ui/Drawer'
import { StatusTag } from '../components/ui/Primitives'
import { formatDateTime } from '../data/domain'
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
      onNotice(online ? '调度已上线，DS 将按 CRON 触发工作流' : '调度已下线，不再周期触发')
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
      <div className={styles.drawerNotice}><CalendarClock size={16} /><span>调度由 DolphinScheduler 引擎执行，DS 是唯一事实源；本页每次打开实时读取。保存不改变上下线状态，新建调度需显式上线。DS 定时触发的运行在「调度实例」中查看（门户发起的运行才进任务运行记录）。</span></div>

      {state === 'loading' ? <p className={styles.drawerHint}>正在读取当前调度状态…</p> : null}
      {state === 'error' ? <p className={styles.formError} role="alert">{error}</p> : null}

      {state === 'ready' && schedule ? <>
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
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, alignSelf: 'end', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />
              高级模式（直接编辑 CRON）
            </label>
          </div>
        </div>

        {advanced ? (
          <div className={styles.formField}>
            <label htmlFor="schedule-cron">CRON 表达式（秒 分 时 日 月 周，DS quartz 方言）</label>
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
            <StatusTag tone={preview.source === 'DS' ? 'healthy' : 'warning'}>{preview.source === 'DS' ? 'DS 引擎计算' : 'DS 不可达 · 本地计算'}</StatusTag>
            <ul>
              {preview.fireTimes.map((time) => <li key={time}>{formatDateTime(time)}</li>)}
              {preview.fireTimes.length === 0 ? <li>生效窗口内无触发时刻</li> : null}
            </ul>
          </div>
        ) : null}

        <div className={styles.drawerFields}>
          <button className={styles.secondaryButton} type="button" disabled={saving || !schedule.scheduled || schedule.online} onClick={() => void toggleOnline(true)}><Power size={14} />上线</button>
          <button className={styles.secondaryButton} type="button" disabled={saving || !schedule.scheduled || !schedule.online} onClick={() => void toggleOnline(false)}><Power size={14} />下线</button>
          <button className={styles.secondaryButton} type="button" disabled={saving || !schedule.scheduled} onClick={requestDelete}>
            <Trash2 size={14} />{confirmDelete ? '再次点击确认删除' : '删除调度'}
          </button>
        </div>
        {schedule.scheduled ? null : (
          <p className={styles.drawerHint}><CircleAlert size={13} /> 手动调度=任务不在 DS 周期触发；仍可在任务列表手动启动。</p>
        )}
      </> : null}
    </Drawer>
  )
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

import { Activity, ArrowUpRight, Cable, CheckCircle2, CircleAlert, Play, Plus, RefreshCw, Server, Waypoints } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusTag } from '../components/ui/Primitives'
import { createSource, fetchIngestionJobs, fetchIngestionRuns, fetchSources, startIngestionRun, syncIngestionRun, type IngestionJobApiItem, type IngestionRunApiItem, type SourceApiItem } from '../data/controlPlane'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'

interface Props {
  onNotice: (message: string) => void
  onUnavailable: (label: string) => void
  onNavigate: (route: RouteKey) => void
}

export function DataIngestionPage({ onNotice, onUnavailable, onNavigate }: Props) {
  const [sources, setSources] = useState<SourceApiItem[]>([])
  const [jobs, setJobs] = useState<IngestionJobApiItem[]>([])
  const [latestRuns, setLatestRuns] = useState<Record<string, IngestionRunApiItem>>({})
  const [state, setState] = useState<'loading' | 'live' | 'fallback'>('loading')
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [sourceFormOpen, setSourceFormOpen] = useState(false)
  const [sourceForm, setSourceForm] = useState({ name: '', systemType: 'LIS', protocol: 'JDBC' })
  const [creatingSource, setCreatingSource] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 2500)
    Promise.all([fetchSources(controller.signal), fetchIngestionJobs(controller.signal)])
      .then(([sourceResponse, jobResponse]) => {
        setSources(sourceResponse.items)
        setJobs(jobResponse.items)
        setState('live')
        return Promise.all(jobResponse.items.map(async (job) => {
          try {
            const response = await fetchIngestionRuns(job.id, controller.signal)
            return [job.id, response.items[0]] as const
          } catch {
            return [job.id, undefined] as const
          }
        }))
      })
      .then((runs) => {
        if (controller.signal.aborted) return
        const loadedRuns: Record<string, IngestionRunApiItem> = {}
        runs.forEach(([jobId, run]) => {
          if (run) loadedRuns[jobId] = run
        })
        setLatestRuns(loadedRuns)
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('fallback')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const visibleSources = sources.length > 0 ? sources : fallbackSources
  const visibleJobs = jobs.length > 0 ? jobs : fallbackJobs

  async function runJob(job: IngestionJobApiItem) {
    if (state !== 'live') {
      onNotice('控制面未连接，当前仅展示演示任务')
      return
    }
    setRunningJob(job.id)
    try {
      const run = await startIngestionRun(job.id)
      setLatestRuns((current) => ({ ...current, [job.id]: run }))
      onNotice(run.status === 'BLOCKED_DEPENDENCY' ? '运行记录已保存，等待中心采集执行器上线' : `运行已提交：${statusLabel(run.status)}`)
    } catch {
      onNotice('运行请求失败，请查看控制面运行日志')
    } finally {
      setRunningJob(null)
    }
  }

  async function syncRun(job: IngestionJobApiItem, run: IngestionRunApiItem) {
    if (state !== 'live') return
    setRunningJob(job.id)
    try {
      const refreshed = await syncIngestionRun(job.id, run.id)
      setLatestRuns((current) => ({ ...current, [job.id]: refreshed }))
      onNotice(`运行状态已更新：${statusLabel(refreshed.status)}`)
    } catch {
      onNotice('运行状态同步失败，请稍后重试')
    } finally {
      setRunningJob(null)
    }
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state !== 'live' || !sourceForm.name.trim()) return
    setCreatingSource(true)
    try {
      const source = await createSource({ ...sourceForm, name: sourceForm.name.trim() })
      setSources((current) => [source, ...current])
      setSourceForm({ name: '', systemType: 'LIS', protocol: 'JDBC' })
      setSourceFormOpen(false)
      onNotice('数据源已登记，状态为待检查')
    } catch {
      onNotice('数据源登记失败，请检查控制面连接')
    } finally {
      setCreatingSource(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title="数据接入" onFilterNotice={onNotice} />
      <div className={styles.apiStatus} role="status" aria-live="polite">
        <span className={`${styles.apiDot} ${state === 'live' ? styles.apiDotLive : ''}`} />
        {state === 'loading' ? '正在连接采集控制面…' : state === 'live' ? '控制面已连接 · 数据源与任务来自 PostgreSQL' : '演示数据 · 控制面暂不可用'}
      </div>
      <div className={styles.content}>
        <section className={styles.attention}>
          <div className={styles.attentionText}>
            <Cable size={21} />
            <div><h2>把院内系统接入到可治理的数据链路</h2><p>先登记来源，再配置任务；运行、异常和重试都回到同一条责任链。</p></div>
          </div>
          <button className={styles.tableButton} onClick={() => state === 'live' ? setSourceFormOpen((open) => !open) : onUnavailable('接入向导')}><Plus size={15} />{sourceFormOpen ? '收起表单' : '新增数据源'}</button>
        </section>

        {sourceFormOpen ? <form className={styles.sourceForm} onSubmit={(event) => void submitSource(event)}>
          <div className={styles.formField}><label htmlFor="source-name">来源名称</label><input id="source-name" required value={sourceForm.name} onChange={(event) => setSourceForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：检验前置机" /></div>
          <div className={styles.formField}><label htmlFor="source-type">系统类型</label><select id="source-type" value={sourceForm.systemType} onChange={(event) => setSourceForm((current) => ({ ...current, systemType: event.target.value }))}><option value="LIS">LIS</option><option value="EMR">EMR</option><option value="HIS">HIS</option><option value="PACS">PACS</option></select></div>
          <div className={styles.formField}><label htmlFor="source-protocol">接入协议</label><select id="source-protocol" value={sourceForm.protocol} onChange={(event) => setSourceForm((current) => ({ ...current, protocol: event.target.value }))}><option value="JDBC">JDBC</option><option value="HTTP">HTTP</option><option value="FHIR">FHIR</option><option value="SFTP">SFTP</option></select></div>
          <div className={styles.formActions}><span>提交后会进入“待检查”，不会立即读取院内数据。</span><button className={styles.tableButton} type="submit" disabled={creatingSource}>{creatingSource ? '登记中…' : '登记来源'}</button></div>
        </form> : null}

        <div className={styles.twoColumns}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>已登记数据源</h2><p>前置机、院内系统与区域交换入口</p></div><button className={styles.textButton} onClick={() => window.location.reload()}><RefreshCw size={13} />刷新</button></div>
            <ul className={styles.ranking}>
              {visibleSources.map((source) => <li key={source.id}><span className={styles.rank}><Server size={16} /></span><div className={styles.rankBody}><strong>{source.name}</strong><span>{source.systemType} · {source.protocol} · {source.institutionId}</span></div><StatusTag tone={source.status === 'HEALTHY' ? 'healthy' : 'warning'}>{source.status === 'HEALTHY' ? '健康' : '待检查'}</StatusTag></li>)}
            </ul>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>采集链路摘要</h2><p>以运行记录作为统一事实</p></div><Activity size={18} color="var(--jade)" /></div>
            <div className={styles.summaryGrid}>
              <Summary label="来源数" value={String(visibleSources.length)} icon={<Server size={15} />} />
              <Summary label="任务数" value={String(visibleJobs.length)} icon={<Waypoints size={15} />} />
              <Summary label="健康来源" value={String(visibleSources.filter((source) => source.status === 'HEALTHY').length)} icon={<CheckCircle2 size={15} />} />
              <Summary label="待执行" value={String(visibleJobs.filter((job) => {
                const runStatus = latestRuns[job.id]?.status ?? job.latestRunStatus
                return runStatus ? !['SUBMITTED', 'RUNNING', 'UNKNOWN'].includes(runStatus) : job.status !== 'RUNNING'
              }).length)} icon={<CircleAlert size={15} />} />
            </div>
            <button className={styles.textButton} onClick={() => onNavigate('governance')}>查看治理结果 <ArrowUpRight size={13} /></button>
          </section>
        </div>

        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}><div><h2>采集任务</h2><p>运行状态由控制面统一回写；可在此手动拉取执行器最新结果</p></div><span className={styles.dashboardScope}>{visibleJobs.length} 个任务</span></div>
          <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>任务</th><th>来源</th><th>模式</th><th>执行通道</th><th>最近运行</th><th>操作</th></tr></thead><tbody>{visibleJobs.map((job) => {
            const run = latestRuns[job.id]
            const latestStatus = run?.status ?? job.latestRunStatus
            const status = latestStatus ? statusLabel(latestStatus) : job.status === 'RUNNING' ? { label: '运行中', tone: 'healthy' as const } : { label: '未运行', tone: 'neutral' as const }
            const activeRun = Boolean(latestStatus && ['SUBMITTED', 'RUNNING', 'UNKNOWN'].includes(latestStatus))
            const canSync = Boolean(run && activeRun)
            return <tr key={job.id}><td><strong>{job.name}</strong><small>{job.id.slice(0, 8)}</small></td><td>{sourceById.get(job.sourceId)?.name ?? 'LIS 检验系统'}</td><td>{job.mode === 'CDC' ? '增量变更' : '批量同步'}</td><td>{executorLabel(job.executor)}</td><td><StatusTag tone={status.tone}>{status.label}</StatusTag>{run ? <small className={styles.statusDetail}>{businessMessage(run.message)}</small> : null}</td><td><div className={styles.tableActions}><button className={styles.tableButton} disabled={runningJob === job.id || activeRun} onClick={() => void runJob(job)}><Play size={13} />{runningJob === job.id ? '处理中…' : activeRun ? '已有运行' : '启动运行'}</button>{canSync ? <button className={styles.tableButton} disabled={runningJob === job.id} onClick={() => void syncRun(job, run)}><RefreshCw size={13} />同步状态</button> : null}</div></td></tr>
          })}</tbody></table></div>
        </section>
      </div>
    </div>
  )
}

function Summary({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className={styles.summaryCard}><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>
}

const fallbackSources: SourceApiItem[] = [
  { id: 'fallback-lis', tenantId: 'default', institutionId: 'demo-hospital', name: 'LIS 检验系统', systemType: 'LIS', protocol: 'JDBC', status: 'HEALTHY', createdAt: '' },
  { id: 'fallback-emr', tenantId: 'default', institutionId: 'demo-hospital', name: 'EMR 病历系统', systemType: 'EMR', protocol: 'HTTP', status: 'PENDING', createdAt: '' },
]

const fallbackJobs: IngestionJobApiItem[] = [
  { id: 'fallback-job', sourceId: 'fallback-lis', name: '检验结果增量同步', mode: 'CDC', executor: 'SEATUNNEL', status: 'RUNNING', createdAt: '', latestRunStatus: null, lastRunAt: null },
]

function executorLabel(executor: string) {
  return executor.toUpperCase() === 'SEATUNNEL' ? '中心采集执行器' : '平台执行通道'
}

function statusLabel(status: string): { label: string; tone: 'healthy' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case 'SUCCEEDED': return { label: '已完成', tone: 'healthy' }
    case 'RUNNING': return { label: '运行中', tone: 'healthy' }
    case 'SUBMITTED': return { label: '已提交', tone: 'warning' }
    case 'FAILED':
    case 'SUBMIT_FAILED': return { label: '失败', tone: 'danger' }
    case 'CANCELED': return { label: '已取消', tone: 'neutral' }
    case 'BLOCKED_CONFIGURATION':
    case 'BLOCKED_DEPENDENCY':
    case 'UNSUPPORTED_EXECUTOR': return { label: '待处理', tone: 'warning' }
    case 'UNKNOWN': return { label: '状态待确认', tone: 'warning' }
    default: return { label: '待处理', tone: 'neutral' }
  }
}

function businessMessage(message: string) {
  return message.replace(/SeaTunnel/gi, '中心采集')
}

import {
  Activity,
  ArrowUpRight,
  Cable,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCog,
  Archive,
  Pause,
  PanelRightClose,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Waypoints,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Drawer } from '../components/ui/Drawer'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusTag } from '../components/ui/Primitives'
import {
  createIngestionJob,
  createSource,
  checkSource,
  confirmIngestionRunAbsent,
  fetchIngestionJobs,
  fetchIngestionRuns,
  fetchJobConfig,
  fetchSources,
  fetchWorkflowTemplates,
  saveJobConfig,
  startIngestionRun,
  syncIngestionRun,
  retryIngestionRun,
  updateIngestionJobStatus,
  type IngestionJobApiItem,
  type IngestionRunApiItem,
  type JobConfig,
  type SourceApiItem,
  type WorkflowTemplateApiItem,
} from '../data/controlPlane'
import { PortalHttpError } from '../data/http'
import { ACTIVE_RUN_STATUSES, formatDateTime, retryableRunStatus, runStatusView } from '../data/domain'
import { useAction } from '../hooks/useAction'
import { useKeyedResource } from '../hooks/useKeyedResource'
import { usePolling } from '../hooks/usePolling'
import { allowsTemplate, defaultTemplateKey, offersDemoTemplate } from '../data/runtimeMode'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'

interface Props {
  onNotice: (message: string) => void
  onUnavailable: (label: string) => void
  onNavigate: (route: RouteKey) => void
}

interface JobFormState {
  sourceId: string
  name: string
  mode: string
  templateKey: string
  templateVersion: number
  configText: string
}

const DEFAULT_TEMPLATE_KEY = 'FAKE_TO_CONSOLE'
const LIVE_TEMPLATE_KEY = 'CUSTOM_JSON'
const DEFAULT_TEMPLATE_VERSION = 1
const DEFAULT_FAKE_CONFIG: JobConfig = {
  env: { 'job.mode': 'BATCH', parallelism: 1 },
  source: [{
    plugin_name: 'FakeSource',
    plugin_output: 'fake',
    'row.num': 16,
    schema: { fields: { name: 'string', age: 'int' } },
  }],
  transform: [],
  sink: [{ plugin_name: 'Console', plugin_input: ['fake'] }],
}

function cloneConfig(config: JobConfig): JobConfig {
  return JSON.parse(JSON.stringify(config)) as JobConfig
}

function configForTemplate(templateKey: string, mode: string, templates: WorkflowTemplateApiItem[] = []): JobConfig {
  if (templateKey === DEFAULT_TEMPLATE_KEY) {
    const config = cloneConfig(DEFAULT_FAKE_CONFIG)
    const env = config.env as Record<string, unknown>
    env['job.mode'] = mode
    return config
  }
  const template = templates.find((item) => item.key === templateKey)
  if (template) {
    const config = cloneConfig(template.sampleConfig)
    const env = config.env as Record<string, unknown> | undefined
    if (env) env['job.mode'] = mode
    return config
  }
  return {}
}

function newJobForm(sourceId = ''): JobFormState {
  const templateKey = defaultTemplateKey(DEFAULT_TEMPLATE_KEY, LIVE_TEMPLATE_KEY)
  return {
    sourceId,
    name: '',
    mode: 'BATCH',
    templateKey,
    templateVersion: DEFAULT_TEMPLATE_VERSION,
    configText: JSON.stringify(configForTemplate(templateKey, 'BATCH'), null, 2),
  }
}

export function DataIngestionPage({ onNotice, onUnavailable, onNavigate }: Props) {
  const [sources, setSources] = useState<SourceApiItem[]>([])
  const [jobs, setJobs] = useState<IngestionJobApiItem[]>([])
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateApiItem[]>([])
  const [latestRuns, setLatestRuns] = useState<Record<string, IngestionRunApiItem>>({})
  const [state, setState] = useState<'loading' | 'live' | 'unavailable'>('loading')
  const { pendingKey, run: runJobAction } = useAction(onNotice)
  // 派生 busy：创建任务 / 保存配置 / 源检查三组 Drawer 动作共用互斥机。
  const creatingJob = pendingKey === 'create-job'
  const configSaving = pendingKey === 'save-config'
  const sourceCheckLoading = pendingKey === 'source-check'
  const runningJob = pendingKey
  const [sourceFormOpen, setSourceFormOpen] = useState(false)
  const [sourceForm, setSourceForm] = useState({ name: '', systemType: 'LIS', protocol: 'JDBC' })
  const [creatingSource, setCreatingSource] = useState(false)
  const [jobFormOpen, setJobFormOpen] = useState(false)
  const [jobForm, setJobForm] = useState<JobFormState>(newJobForm())
  const [configuringJob, setConfiguringJob] = useState<IngestionJobApiItem | null>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configTemplateKey, setConfigTemplateKey] = useState(DEFAULT_TEMPLATE_KEY)
  const [configTemplateVersion, setConfigTemplateVersion] = useState(DEFAULT_TEMPLATE_VERSION)
  const [configText, setConfigText] = useState('')
  const [detailsJob, setDetailsJob] = useState<IngestionJobApiItem | null>(null)
  const [detailsRuns, setDetailsRuns] = useState<IngestionRunApiItem[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [checkingSource, setCheckingSource] = useState<SourceApiItem | null>(null)
  const [sourceCheckText, setSourceCheckText] = useState('')
  const [sourceCheckError, setSourceCheckError] = useState<string | null>(null)
  // 主载入有意手写（不用 useApiResource）：列表先落位进入 live、各作业最新
  // 运行随后补齐的两段渐进 UX 需要在 onData 之后继续持有同一中止信号。
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 2500)
    Promise.all([fetchSources(controller.signal), fetchIngestionJobs(controller.signal)])
      .then(([sourceResponse, jobResponse]) => {
        setSources(sourceResponse.items)
        setJobs(jobResponse.items)
        setJobForm((current) => current.sourceId || !sourceResponse.items[0] ? current : { ...current, sourceId: sourceResponse.items[0].id })
        setState('live')
        setJobFormOpen(true)
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
        if (!controller.signal.aborted) {
          setSources([])
          setJobs([])
          setLatestRuns({})
          setState('unavailable')
        }
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  // 模板目录为从属资源：主链路 live 后载入，失败静默清空不塌页。
  useKeyedResource({
    key: state === 'live' ? 'templates' : null,
    load: (signal) => fetchWorkflowTemplates(signal),
    onData: setWorkflowTemplates,
    onError: () => setWorkflowTemplates([]),
  })

  // 运行详情抽屉的周期刷新（5 秒）；切换目标作业即重启。
  usePolling(useCallback(async () => {
    if (!detailsJob) return
    setDetailsLoading(true)
    try {
      const response = await fetchIngestionRuns(detailsJob.id)
      setDetailsRuns(response.items)
      setLatestRuns((current) => {
        const next = { ...current }
        if (response.items[0]) next[detailsJob.id] = response.items[0]
        else delete next[detailsJob.id]
        return next
      })
      setJobs((current) => current.map((job) => job.id === detailsJob.id
        ? { ...job, latestRunStatus: response.items[0]?.status ?? null }
        : job))
      setDetailsError(null)
    } catch {
      setDetailsError('运行记录暂时无法读取，请稍后重试')
    } finally {
      setDetailsLoading(false)
    }
  }, [detailsJob]), 5000, state === 'live' && !!detailsJob, detailsJob?.id)

  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const visibleSources = sources
  const visibleJobs = jobs

  async function runJob(job: IngestionJobApiItem) {
    if (state !== 'live') {
      onNotice('控制面未连接，当前未加载业务数据')
      return
    }
    if (!job.configured) {
      onNotice('请先保存采集任务配置，再启动运行')
      void openJobConfig(job)
      return
    }
    await runJobAction(job.id, '运行请求失败，请查看控制面运行日志', async () => {
      const run = await startIngestionRun(job.id, { idempotencyKey: createRequestKey() })
      setLatestRuns((current) => ({ ...current, [job.id]: run }))
      setDetailsRuns((current) => detailsJob?.id === job.id ? [run, ...current.filter((item) => item.id !== run.id)] : current)
      onNotice(run.status === 'BLOCKED_DEPENDENCY' ? '运行记录已保存，等待中心采集执行器上线' : `运行已提交：${runStatusView(run.status).label}`)
    }, () => onNotice('运行请求失败，请查看控制面运行日志'))
  }

  async function changeJobStatus(job: IngestionJobApiItem, status: string) {
    if (state !== 'live') return
    await runJobAction(job.id, '任务状态更新失败，请稍后重试', async () => {
      const updated = await updateIngestionJobStatus(job.id, status)
      setJobs((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (detailsJob?.id === updated.id) setDetailsJob(updated)
      onNotice(`任务状态已更新：${jobLifecycleLabel(updated.status)}`)
    })
  }

  async function syncRun(job: IngestionJobApiItem, run: IngestionRunApiItem) {
    if (state !== 'live') return
    await runJobAction(job.id, '运行状态同步失败，请稍后重试', async () => {
      const refreshed = await syncIngestionRun(job.id, run.id)
      setLatestRuns((current) => ({ ...current, [job.id]: refreshed }))
      setDetailsRuns((current) => current.map((item) => item.id === refreshed.id ? refreshed : item))
      onNotice(`运行状态已更新：${runStatusView(refreshed.status).label}`)
    }, () => onNotice('运行状态同步失败，请稍后重试'))
  }

  async function retryRun(job: IngestionJobApiItem, run: IngestionRunApiItem) {
    if (state !== 'live') return
    await runJobAction(job.id, '运行重试失败，请先确认任务未暂停且没有活动运行', async () => {
      const retried = await retryIngestionRun(job.id, run.id)
      setLatestRuns((current) => ({ ...current, [job.id]: retried }))
      setDetailsRuns((current) => detailsJob?.id === job.id
        ? [retried, ...current.filter((item) => item.id !== retried.id)]
        : current)
      onNotice(`已创建重试运行：${runStatusView(retried.status).label}`)
    })
  }

  async function confirmRunAbsent(job: IngestionJobApiItem, run: IngestionRunApiItem) {
    if (state !== 'live') return
    await runJobAction(job.id, '确认外部运行不存在失败，请刷新后重试', async () => {
      const confirmed = await confirmIngestionRunAbsent(job.id, run.id)
      setLatestRuns((current) => ({ ...current, [job.id]: confirmed }))
      setDetailsRuns((current) => current.map((item) => item.id === confirmed.id ? confirmed : item))
      onNotice('已确认外部运行不存在，当前运行允许重试')
    })
  }

  function openSourceCheck(source: SourceApiItem) {
    setConfiguringJob(null)
    setDetailsJob(null)
    setCheckingSource(source)
    setSourceCheckError(null)
    setSourceCheckText(JSON.stringify(sourceCheckDefaults(source.protocol), null, 2))
  }

  function selectJobTemplate(templateKey: string) {
    const selected = workflowTemplates.find((item) => item.key === templateKey)
    setJobForm((current) => ({
      ...current,
      templateKey,
      templateVersion: selected?.version ?? DEFAULT_TEMPLATE_VERSION,
      configText: JSON.stringify(configForTemplate(templateKey, current.mode, workflowTemplates), null, 2),
    }))
  }

  function selectConfigTemplate(templateKey: string) {
    if (!configuringJob) return
    const selected = workflowTemplates.find((item) => item.key === templateKey)
    setConfigTemplateKey(templateKey)
    setConfigTemplateVersion(selected?.version ?? DEFAULT_TEMPLATE_VERSION)
    setConfigText(JSON.stringify(configForTemplate(templateKey, configuringJob.mode, workflowTemplates), null, 2))
  }

  async function submitSourceCheck() {
    if (!checkingSource || state !== 'live') return
    let config: JobConfig
    try {
      config = parseConfig(sourceCheckText)
    } catch (error) {
      setSourceCheckError(error instanceof Error ? error.message : '检查配置 JSON 不合法')
      return
    }
    void runJobAction('source-check', '数据源检查失败，请稍后重试', async () => {
      const updated = await checkSource(checkingSource.id, config)
      setSources((current) => current.map((item) => item.id === updated.id ? updated : item))
      setCheckingSource(updated)
      onNotice(`数据源检查完成：${sourceStatusLabel(updated.status).label}`)
    }, (message) => setSourceCheckError(message))
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state !== 'live' || !sourceForm.name.trim()) return
    setCreatingSource(true)
    try {
      const source = await createSource({ ...sourceForm, name: sourceForm.name.trim() })
      setSources((current) => [source, ...current])
      setJobForm((current) => current.sourceId ? current : { ...current, sourceId: source.id })
      setSourceForm({ name: '', systemType: 'LIS', protocol: 'JDBC' })
      setSourceFormOpen(false)
      onNotice('数据源已登记，状态为待检查')
    } catch {
      onNotice('数据源登记失败，请检查控制面连接')
    } finally {
      setCreatingSource(false)
    }
  }

  async function submitJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state !== 'live') {
      onNotice('控制面未连接，无法创建采集任务')
      return
    }
    if (!jobForm.sourceId || !jobForm.name.trim()) {
      onNotice('请先选择数据源并填写任务名称')
      return
    }
    if (!allowsTemplate(jobForm.templateKey, DEFAULT_TEMPLATE_KEY)) {
      onNotice('真实模式不允许使用 FakeSource 演示模板，请改用自定义 JSON')
      return
    }
    let config: JobConfig
    try {
      config = parseConfig(jobForm.configText)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '配置 JSON 不合法')
      return
    }
    void runJobAction('create-job', '采集任务创建失败，请检查配置内容与控制面日志', async () => {
      const job = await createIngestionJob({
        sourceId: jobForm.sourceId,
        name: jobForm.name.trim(),
        mode: jobForm.mode,
        executor: 'SEATUNNEL',
        templateKey: jobForm.templateKey,
        templateVersion: jobForm.templateVersion,
        config,
      })
      setJobs((current) => [job, ...current])
      setJobForm(newJobForm(jobForm.sourceId))
      setJobFormOpen(false)
      onNotice(`采集任务已创建：${job.name}`)
    })
  }

  async function openJobConfig(job: IngestionJobApiItem) {
    if (state !== 'live') {
      onUnavailable('任务配置')
      return
    }
    setCheckingSource(null)
    setDetailsJob(null)
    setConfiguringJob(job)
    setConfigLoading(true)
    setConfigError(null)
    setConfigTemplateKey(job.templateKey ?? defaultTemplateKey(DEFAULT_TEMPLATE_KEY, LIVE_TEMPLATE_KEY))
    setConfigTemplateVersion(job.templateVersion ?? DEFAULT_TEMPLATE_VERSION)
    setConfigText(JSON.stringify(configForTemplate(job.templateKey ?? defaultTemplateKey(DEFAULT_TEMPLATE_KEY, LIVE_TEMPLATE_KEY), job.mode, workflowTemplates), null, 2))
    try {
      const saved = await fetchJobConfig(job.id)
      setConfigTemplateKey(saved.templateKey)
      setConfigTemplateVersion(saved.templateVersion)
      setConfigText(JSON.stringify(saved.config, null, 2))
    } catch (error) {
      if (!isNotFound(error)) setConfigError('配置读取失败，请检查控制面日志')
    } finally {
      setConfigLoading(false)
    }
  }

  async function saveConfiguration() {
    if (!configuringJob || state !== 'live') return
    let config: JobConfig
    if (!allowsTemplate(configTemplateKey, DEFAULT_TEMPLATE_KEY)) {
      setConfigError('真实模式不允许保存 FakeSource 演示模板，请改用自定义 JSON')
      return
    }
    try {
      config = parseConfig(configText)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '配置 JSON 不合法')
      return
    }
    void runJobAction('save-config', '配置保存失败。请确认 JSON 结构正确，且未填写明文密码或密钥。', async () => {
      const saved = await saveJobConfig(configuringJob.id, {
        templateKey: configTemplateKey,
        templateVersion: configTemplateVersion,
        config,
      })
      setJobs((current) => current.map((item) => item.id === configuringJob.id
        ? { ...item, configured: true, templateKey: saved.templateKey, templateVersion: saved.templateVersion }
        : item))
      setConfiguringJob((current) => current ? { ...current, configured: true, templateKey: saved.templateKey, templateVersion: saved.templateVersion } : current)
      onNotice(`任务配置已保存：${saved.templateKey} v${saved.templateVersion}`)
    }, (message) => setConfigError(message))
  }

  function openRunDetails(job: IngestionJobApiItem) {
    setCheckingSource(null)
    setConfiguringJob(null)
    setDetailsError(null)
    setDetailsRuns([])
    setDetailsJob(job)
  }

  return (
    <div className={styles.page}>
      <PageHeader title="数据接入" />
      <div className={styles.apiStatus} role="status" aria-live="polite">
        <span className={`${styles.apiDot} ${state === 'live' ? styles.apiDotLive : ''}`} />
        {state === 'loading' ? '正在连接采集控制面…' : state === 'live' ? '控制面已连接 · 数据源与任务来自 PostgreSQL' : '控制面暂不可用 · 未加载业务数据'}
      </div>
      {state === 'unavailable' ? <div className={styles.connectionNotice} role="alert"><CircleAlert size={17} /><div><strong>采集控制面不可用</strong><span>当前页面没有展示演示状态；请恢复控制面后重新加载。</span></div><button className={styles.secondaryButton} onClick={() => window.location.reload()}><RefreshCw size={13} />重新连接</button></div> : null}
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
              {visibleSources.map((source) => { const health = sourceStatusLabel(source.status); return <li key={source.id}><span className={styles.rank}><Server size={16} /></span><div className={styles.rankBody}><strong>{source.name}</strong><span>{source.systemType} · {source.protocol} · {source.institutionId}</span>{source.lastCheckMessage ? <small className={styles.statusDetail}>{source.lastCheckMessage} · {formatDateTime(source.lastCheckedAt)}</small> : null}</div><div className={styles.sourceRowActions}><StatusTag tone={health.tone}>{health.label}</StatusTag>{state === 'live' ? <button className={styles.tableButton} onClick={() => openSourceCheck(source)}><CheckCircle2 size={13} />检查</button> : null}</div></li> })}
              {visibleSources.length === 0 ? <li className={styles.emptyState}>暂无已登记数据源</li> : null}
            </ul>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>采集链路摘要</h2><p>以运行记录作为统一事实</p></div><Activity size={18} color="var(--jade)" /></div>
            <div className={styles.summaryGrid}>
              <Summary label="来源数" value={String(visibleSources.length)} icon={<Server size={15} />} />
              <Summary label="任务数" value={String(visibleJobs.length)} icon={<Waypoints size={15} />} />
              <Summary label="已配置任务" value={String(visibleJobs.filter((job) => job.configured).length)} icon={<FileCog size={15} />} />
              <Summary label="待执行" value={String(visibleJobs.filter((job) => {
                const runStatus = latestRuns[job.id]?.status ?? job.latestRunStatus
                return runStatus ? !ACTIVE_RUN_STATUSES.includes(runStatus) : job.status !== 'RUNNING'
              }).length)} icon={<CircleAlert size={15} />} />
            </div>
            <button className={styles.textButton} onClick={() => onNavigate('governance')}>查看治理结果 <ArrowUpRight size={13} /></button>
          </section>
        </div>

        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}><div><h2>采集任务</h2><p>配置模板可复用；运行状态由控制面统一回写</p></div><div className={styles.panelHeaderActions}><span className={styles.dashboardScope}>{visibleJobs.length} 个任务</span><button className={styles.primaryButton} onClick={() => {
            if (state !== 'live') { onUnavailable('新建采集任务'); return }
            if (sources.length === 0) { onNotice('请先登记至少一个数据源'); return }
            setJobForm((current) => current.sourceId ? current : newJobForm(sources[0].id))
            setJobFormOpen((open) => !open)
          }}><Plus size={14} />{jobFormOpen ? '收起' : '新建采集任务'}</button></div></div>
          {jobFormOpen ? <form className={styles.jobForm} onSubmit={(event) => void submitJob(event)}>
            <div className={styles.formField}><label htmlFor="job-source">数据源</label><select id="job-source" required value={jobForm.sourceId} onChange={(event) => setJobForm((current) => ({ ...current, sourceId: event.target.value }))}>{sources.map((source) => <option value={source.id} key={source.id}>{source.name} · {source.systemType}</option>)}</select></div>
            <div className={styles.formField}><label htmlFor="job-name">任务名称</label><input id="job-name" required value={jobForm.name} onChange={(event) => setJobForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：LIS 检验结果批量同步" /></div>
            <div className={styles.formField}><label htmlFor="job-mode">运行模式</label><select id="job-mode" value={jobForm.mode} onChange={(event) => setJobForm((current) => ({ ...current, mode: event.target.value, configText: JSON.stringify(configForTemplate(current.templateKey, event.target.value, workflowTemplates), null, 2) }))}><option value="BATCH">批量同步</option><option value="CDC">增量变更</option></select></div>
            <div className={styles.formField}><label htmlFor="job-template">配置模板</label><select id="job-template" value={jobForm.templateKey} onChange={(event) => selectJobTemplate(event.target.value)}>{offersDemoTemplate() ? <option value={DEFAULT_TEMPLATE_KEY}>FakeSource → Console（演示）</option> : null}{workflowTemplates.map((template) => <option value={template.key} key={template.key}>{template.displayName} · {template.systemType}</option>)}<option value={LIVE_TEMPLATE_KEY}>自定义 JSON</option></select></div>
            <div className={`${styles.formField} ${styles.formFieldWide}`}><details className={styles.configDetails} open><summary>采集配置 JSON <span>默认展开 · 可编辑</span></summary><label htmlFor="job-config">配置内容</label><textarea id="job-config" className={styles.codeInput} value={jobForm.configText} onChange={(event) => setJobForm((current) => ({ ...current, configText: event.target.value }))} spellCheck={false} /></details></div>
            <div className={styles.formActions}><span>{offersDemoTemplate() ? '仅保存结构配置；密码、密钥请使用后续凭据引用，不写入任务 JSON。' : workflowTemplates.length > 0 ? '临床模板来自控制面目录；请替换端点和 credentialRef 后再保存，密码、密钥不会写入任务 JSON。' : '真实模式请填写院内连接器 JSON；密码、密钥请使用凭据引用，不写入任务 JSON。'}</span><button className={styles.primaryButton} type="submit" disabled={creatingJob}>{creatingJob ? '创建中…' : '创建并保存配置'}</button></div>
          </form> : null}
          <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>任务</th><th>来源</th><th>模式</th><th>执行通道</th><th>最近运行</th><th>操作</th></tr></thead><tbody>{visibleJobs.map((job) => {
            const run = latestRuns[job.id]
            const latestStatus = run?.status ?? job.latestRunStatus
            const status = latestStatus ? runStatusView(latestStatus) : jobLifecycleStatusLabel(job.status)
            const activeRun = Boolean(latestStatus && ACTIVE_RUN_STATUSES.includes(latestStatus))
            const canSync = Boolean(run && activeRun)
            const canRetry = Boolean(run && retryableRunStatus(run.status))
            const lifecycle = jobLifecycleStatusLabel(job.status)
            const canStart = job.status !== 'PAUSED' && job.status !== 'ARCHIVED'
            return <tr key={job.id}><td><strong>{job.name}</strong><small>{job.id.slice(0, 8)}</small><span className={`${styles.configPill} ${job.configured ? styles.configPillReady : styles.configPillMissing}`}>{job.configured ? `${job.templateKey ?? '自定义'} v${job.templateVersion ?? 1}` : '未配置'}</span><span className={`${styles.lifecyclePill} ${lifecycleClass(lifecycle.tone)}`}>{lifecycle.label}</span></td><td>{sourceById.get(job.sourceId)?.name ?? '来源未登记'}</td><td>{job.mode === 'CDC' ? '增量变更' : '批量同步'}</td><td>{executorLabel(job.executor)}</td><td><StatusTag tone={status.tone}>{status.label}</StatusTag>{run ? <small className={styles.statusDetail}>{businessMessage(run.message)}</small> : null}</td><td><div className={styles.tableActions}>{job.status === 'ACTIVE' ? <button className={styles.tableButton} disabled={runningJob === job.id} onClick={() => void changeJobStatus(job, 'PAUSED')}><Pause size={13} />暂停</button> : job.status === 'PAUSED' || job.status === 'DRAFT' ? <button className={styles.tableButton} disabled={runningJob === job.id} onClick={() => void changeJobStatus(job, 'ACTIVE')}><Play size={13} />启用</button> : null}{job.status !== 'ARCHIVED' ? <button className={styles.tableButton} disabled={runningJob === job.id || activeRun} onClick={() => void changeJobStatus(job, 'ARCHIVED')}><Archive size={13} />归档</button> : null}<button className={styles.tableButton} onClick={() => void openJobConfig(job)}><Settings2 size={13} />配置</button><button className={styles.tableButton} onClick={() => openRunDetails(job)}><Clock3 size={13} />详情</button><button className={styles.tableButton} disabled={runningJob === job.id || activeRun || !canStart} onClick={() => job.configured ? void runJob(job) : void openJobConfig(job)}><Play size={13} />{runningJob === job.id ? '处理中…' : activeRun ? '已有运行' : !canStart ? '已暂停' : job.configured ? '启动' : '配置后运行'}</button>{canSync ? <button className={styles.tableButton} disabled={runningJob === job.id} onClick={() => void syncRun(job, run)}><RefreshCw size={13} />同步</button> : null}{canRetry ? <button className={styles.tableButton} disabled={runningJob === job.id || !canStart || activeRun} onClick={() => void retryRun(job, run)}><RotateCcw size={13} />重试</button> : null}</div></td></tr>
          })}{visibleJobs.length === 0 ? <tr><td colSpan={6} className={styles.emptyState}>暂无采集任务，先登记数据源再新建任务。</td></tr> : null}</tbody></table></div>
        </section>
      </div>

            {checkingSource ? <Drawer
        titleId="source-check-title"
        eyebrow={`数据源检查 · ${checkingSource.protocol}`}
        title={checkingSource.name}
        closeLabel="关闭数据源检查"
        onClose={() => setCheckingSource(null)}
        footer={<><button className={styles.secondaryButton} onClick={() => setCheckingSource(null)}>关闭</button><button className={styles.primaryButton} disabled={sourceCheckLoading} onClick={() => void submitSourceCheck()}><CheckCircle2 size={14} />{sourceCheckLoading ? '检查中…' : '开始检查'}</button></>}
      >
            <div className={styles.drawerNotice}><CheckCircle2 size={16} /><span>检查只在当前请求中使用连接参数，不会把密码或 Token 写入来源记录。结果会回写为健康、失败或待配置，并显示最近检查时间。</span></div>
            <div className={styles.formField}><label htmlFor="source-check-editor">检查配置 JSON</label><textarea id="source-check-editor" className={`${styles.codeInput} ${styles.codeInputLarge}`} value={sourceCheckText} onChange={(event) => setSourceCheckText(event.target.value)} spellCheck={false} disabled={sourceCheckLoading} /></div>
            {sourceCheckError ? <p className={styles.formError} role="alert">{sourceCheckError}</p> : null}
            {checkingSource.lastCheckMessage ? <div className={styles.checkResult}><StatusTag tone={sourceStatusLabel(checkingSource.status).tone}>{sourceStatusLabel(checkingSource.status).label}</StatusTag><p>{checkingSource.lastCheckMessage}</p><small>最近检查：{formatDateTime(checkingSource.lastCheckedAt)}</small></div> : null}
      </Drawer> : null}

            {configuringJob ? <Drawer
        titleId="job-config-title"
        eyebrow={`任务配置 · ${configuringJob.id.slice(0, 8)}`}
        title={configuringJob.name}
        closeLabel="关闭任务配置"
        onClose={() => setConfiguringJob(null)}
        footer={<><button className={styles.secondaryButton} onClick={() => setConfiguringJob(null)}>取消</button><button className={styles.primaryButton} disabled={configLoading || configSaving} onClick={() => void saveConfiguration()}><Save size={14} />{configSaving ? '保存中…' : '保存配置'}</button></>}
      >
            <div className={styles.drawerNotice}><Settings2 size={16} /><span>保存的是可审计的结构配置。连接密码、Token、Secret 等敏感值必须通过凭据引用接入，本版不会落库。</span></div>
            <div className={styles.drawerFields}><div className={styles.formField}><label htmlFor="config-template">模板标识</label><select id="config-template" value={configTemplateKey} onChange={(event) => selectConfigTemplate(event.target.value)}>{offersDemoTemplate() || configTemplateKey === DEFAULT_TEMPLATE_KEY ? <option value={DEFAULT_TEMPLATE_KEY} disabled={!offersDemoTemplate()}>FakeSource → Console（仅演示）</option> : null}{workflowTemplates.map((template) => <option value={template.key} key={template.key}>{template.displayName} · {template.systemType}</option>)}<option value={LIVE_TEMPLATE_KEY}>自定义 JSON</option></select></div><div className={styles.formField}><label htmlFor="config-version">模板版本</label><input id="config-version" type="number" min={1} value={configTemplateVersion} onChange={(event) => setConfigTemplateVersion(Math.max(1, Number(event.target.value) || 1))} /></div></div>
            <div className={styles.formField}><details className={styles.configDetails} open><summary>配置 JSON <span>默认展开 · 可编辑</span></summary><label htmlFor="config-editor">配置内容</label><textarea id="config-editor" className={`${styles.codeInput} ${styles.codeInputLarge}`} value={configText} onChange={(event) => setConfigText(event.target.value)} spellCheck={false} disabled={configLoading} /></details></div>
            {configLoading ? <p className={styles.drawerHint}>正在读取已保存配置…</p> : null}
            {configError ? <p className={styles.formError} role="alert">{configError}</p> : null}
      </Drawer> : null}

            {detailsJob ? <Drawer
        titleId="run-details-title"
        eyebrow="运行详情 · 自动刷新 5 秒"
        title={detailsJob.name}
        closeLabel="关闭运行详情"
        closeIcon={<PanelRightClose size={17} />}
        onClose={() => setDetailsJob(null)}
        footer={<><button className={styles.secondaryButton} onClick={() => setDetailsJob(null)}>关闭</button><button className={styles.primaryButton} disabled={runningJob === detailsJob.id || detailsJob.status === 'PAUSED' || detailsJob.status === 'ARCHIVED' || detailsRuns.some((run) => ACTIVE_RUN_STATUSES.includes(run.status))} onClick={() => detailsJob.configured ? void runJob(detailsJob) : void openJobConfig(detailsJob)}><Play size={14} />{detailsJob.status === 'PAUSED' ? '已暂停' : detailsJob.status === 'ARCHIVED' ? '已归档' : detailsJob.configured ? '再次启动' : '配置任务'}</button></>}
      >
            <div className={styles.runSummary}><span>执行通道</span><strong>{executorLabel(detailsJob.executor)}</strong><span>配置状态</span><strong className={detailsJob.configured ? styles.textHealthy : styles.textWarning}>{detailsJob.configured ? `${detailsJob.templateKey ?? '自定义'} v${detailsJob.templateVersion ?? 1}` : '未配置'}</strong></div>
            {detailsLoading && detailsRuns.length === 0 ? <p className={styles.drawerHint}>正在读取运行记录…</p> : null}
            {detailsError ? <p className={styles.formError} role="alert">{detailsError}</p> : null}
            {detailsRuns.length === 0 && !detailsLoading ? <div className={styles.emptyState}><Clock3 size={18} /><p>还没有运行记录</p><span>保存任务配置后，可从任务列表启动一次采集。</span></div> : null}
            <ol className={styles.runTimeline}>{detailsRuns.slice(0, 10).map((run) => { const status = runStatusView(run.status); const active = ACTIVE_RUN_STATUSES.includes(run.status); const retryable = retryableRunStatus(run.status); return <li key={run.id}><div className={styles.timelineDot} data-tone={status.tone} /><div className={styles.timelineBody}><div className={styles.timelineTitle}><strong>{status.label}</strong><time>{formatDateTime(run.submittedAt)}</time></div><p>{businessMessage(run.message)}</p>{run.reconciliationStatus === 'MANUAL_REQUIRED' ? <div className={styles.connectionNotice} role="status"><strong>待人工对账：</strong>{run.reconciliationMessage ?? '请先确认外部运行不存在后再重试。'}<div className={styles.timelineActions}><button className={styles.textButton} disabled={runningJob === detailsJob.id} onClick={() => void syncRun(detailsJob, run)}>重新查询</button><button className={styles.textButton} disabled={runningJob === detailsJob.id} onClick={() => void confirmRunAbsent(detailsJob, run)}>确认不存在</button></div></div> : null}<dl><div><dt>运行编号</dt><dd>{run.id.slice(0, 8)}</dd></div>{run.externalId ? <div><dt>外部编号</dt><dd>{run.externalId}</dd></div> : null}{run.finishedAt ? <div><dt>完成时间</dt><dd>{formatDateTime(run.finishedAt)}</dd></div> : null}</dl><div className={styles.timelineActions}>{active && run.reconciliationStatus !== 'MANUAL_REQUIRED' ? <button className={styles.textButton} disabled={runningJob === detailsJob.id} onClick={() => void syncRun(detailsJob, run)}><RefreshCw size={12} />同步状态</button> : null}{retryable ? <button className={styles.textButton} disabled={runningJob === detailsJob.id || detailsJob.status === 'PAUSED' || detailsJob.status === 'ARCHIVED'} onClick={() => void retryRun(detailsJob, run)}><RotateCcw size={12} />重试</button> : null}</div></div></li> })}</ol>
      </Drawer> : null}
    </div>
  )
}

function Summary({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className={styles.summaryCard}><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>
}

function executorLabel(executor: string) {
  return executor.toUpperCase() === 'SEATUNNEL' ? '中心采集执行器' : '平台执行通道'
}

function sourceStatusLabel(status: string): { label: string; tone: 'healthy' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case 'HEALTHY': return { label: '健康', tone: 'healthy' }
    case 'UNHEALTHY': return { label: '连接失败', tone: 'danger' }
    case 'BLOCKED_CONFIGURATION': return { label: '待配置', tone: 'warning' }
    default: return { label: '待检查', tone: 'warning' }
  }
}

function sourceCheckDefaults(protocol: string): JobConfig {
  if (protocol.toUpperCase() === 'JDBC') return { jdbcUrl: 'jdbc:postgresql://主机:5432/数据库', username: '只读账号' }
  if (protocol.toUpperCase() === 'HTTP' || protocol.toUpperCase() === 'FHIR') return { url: 'http://前置机地址/health' }
  return {}
}

function jobLifecycleStatusLabel(status: string): { label: string; tone: 'healthy' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case 'ACTIVE': return { label: '已启用', tone: 'healthy' }
    case 'PAUSED': return { label: '已暂停', tone: 'warning' }
    case 'ARCHIVED': return { label: '已归档', tone: 'neutral' }
    default: return { label: '草稿', tone: 'neutral' }
  }
}

function jobLifecycleLabel(status: string) {
  return jobLifecycleStatusLabel(status).label
}

function lifecycleClass(tone: 'healthy' | 'warning' | 'danger' | 'neutral') {
  switch (tone) {
    case 'healthy': return styles.lifecycleHealthy
    case 'warning': return styles.lifecycleWarning
    case 'danger': return styles.lifecycleDanger
    default: return styles.lifecycleNeutral
  }
}

function businessMessage(message: string) {
  return message.replace(/SeaTunnel/gi, '中心采集')
}

function parseConfig(text: string): JobConfig {
  if (!text.trim()) throw new Error('配置 JSON 不能为空')
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置必须是 JSON 对象')
  return parsed as JobConfig
}

function isNotFound(error: unknown) {
  return error instanceof PortalHttpError && error.status === 404
}

function createRequestKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`
}


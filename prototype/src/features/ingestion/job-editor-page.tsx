import { LoadingBlock } from '@/components/app/loading'
import { Input } from '@/components/ui/input'
import { CodeTextarea } from '@/components/app/code-textarea'
import { Badge } from '@/components/ui/badge'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, FileCog, KeyRound, LoaderCircle, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FormField, FormGrid, FormNotice } from '../../components/kit/form'
import { NativeSelect } from '../../components/kit/input'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel, ScopeNote } from '../../components/kit/panel'
import { EmptyState } from '../../components/kit/states'
import { useNotice } from '../../components/kit/toast'
import {
  createIngestionJob,
  saveJobConfig,
  saveStructuredJobConfig,
  type IngestionJobApiItem,
  type StructuredTaskSpec,
} from '../../data/controlPlane'
import { allowsTemplate, offersDemoTemplate } from '../../data/runtimeMode'
import { workLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { useDirtyLeaveGuard } from '../../app/dirty-leave-guard'
import { ingestionKeys, jobConfigQuery, jobsQuery, sourcesQuery, workflowTemplatesQuery } from './queries'
import {
  DEFAULT_TEMPLATE_KEY,
  DEFAULT_TEMPLATE_VERSION,
  LIVE_TEMPLATE_KEY,
  configForTemplate,
  defaultJobTemplateKey,
  errorMessage,
  isDolphinExecutor,
  parseConfig,
  preferredSourceId,
  sourceDisplayName,
} from './labels'
import { StructuredTaskFields } from './structured-fields'

/**
 * 采集任务工作区（独立页，替代旧 540px 抽屉）：
 * 创建走 /ingestion/new；已有任务的「配置」Tab 复用同一编辑器。
 * 完整参数不缩水：数据源、模式、执行通道、模板/JSON、结构化意图、平台调度绑定。
 */
export function JobConfigurationEditor({ jobId }: { jobId?: string }) {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()

  const sourcesRequest = useQuery(sourcesQuery())
  const jobsRequest = useQuery({ ...jobsQuery(), enabled: Boolean(jobId) })
  const templatesRequest = useQuery(workflowTemplatesQuery())

  const job = jobId ? jobsRequest.data?.items.find((item) => item.id === jobId) : undefined
  const sources = sourcesRequest.data?.items ?? []
  const templates = templatesRequest.data ?? []

  const [sourceId, setSourceId] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState('BATCH')
  const [executor, setExecutor] = useState<'SEATUNNEL' | 'DOLPHINSCHEDULER'>('SEATUNNEL')
  const [configMode, setConfigMode] = useState<'structured' | 'json'>('structured')
  const [templateKey, setTemplateKey] = useState(defaultJobTemplateKey)
  const [templateVersion, setTemplateVersion] = useState(DEFAULT_TEMPLATE_VERSION)
  const [configText, setConfigText] = useState('')
  const [dsProject, setDsProject] = useState('')
  const [dsWorkflow, setDsWorkflow] = useState('')
  const [structuredDirty, setStructuredDirty] = useState(false)
  const [structuredSpec, setStructuredSpec] = useState<StructuredTaskSpec | null>(null)
  const [error, setError] = useState<string | null>(null)

  const configRequest = useQuery({ ...jobConfigQuery(jobId ?? ''), enabled: Boolean(jobId && job) })

  // 新建：默认选已登记连接的源；已有任务：回填已保存配置。
  useEffect(() => {
    if (jobId) return
    if (!sourceId && sources.length > 0) setSourceId(preferredSourceId(sources))
  }, [jobId, sourceId, sources])

  useEffect(() => {
    if (!job) return
    setName(job.name)
    setSourceId(job.sourceId)
    setMode(job.mode)
    setExecutor(isDolphinExecutor(job.executor) ? 'DOLPHINSCHEDULER' : 'SEATUNNEL')
    setTemplateKey(job.templateKey ?? defaultJobTemplateKey())
    setTemplateVersion(job.templateVersion ?? DEFAULT_TEMPLATE_VERSION)
  }, [job])

  useEffect(() => {
    const saved = configRequest.data
    if (!saved) return
    setStructuredSpec(saved.structured)
    setConfigMode(saved.structured ? 'structured' : 'json')
    setTemplateKey(saved.templateKey)
    setTemplateVersion(saved.templateVersion)
    setConfigText(JSON.stringify(saved.config, null, 2))
    const binding = (saved.config as Record<string, unknown>)?.dolphinscheduler
    if (binding && typeof binding === 'object') {
      const record = binding as Record<string, unknown>
      setDsProject(record.projectCode === undefined ? '' : String(record.projectCode))
      setDsWorkflow(record.workflowDefinitionCode === undefined ? '' : String(record.workflowDefinitionCode))
    }
  }, [configRequest.data])

  const selectedSource = useMemo(() => sources.find((source) => source.id === sourceId), [sources, sourceId])
  const structuredReady = Boolean(selectedSource && selectedSource.protocol.toUpperCase() === 'JDBC' && selectedSource.connection)

  const dirty = Boolean(
    structuredDirty
    || (jobId
      ? name !== (job?.name ?? '') || sourceId !== (job?.sourceId ?? '') || mode !== (job?.mode ?? '') || Boolean(configText)
      : Boolean(name.trim())),
  )

  // 拦一切路由离开（含侧栏/页签）；页内出口只需正常 navigate，守卫会先询问。
  const { allowNextLeave, guard } = useDirtyLeaveGuard(dirty)

  function selectTemplate(nextKey: string) {
    const template = templates.find((item) => item.key === nextKey)
    setTemplateKey(nextKey)
    setTemplateVersion(template?.version ?? DEFAULT_TEMPLATE_VERSION)
    setConfigText(JSON.stringify(configForTemplate(nextKey, mode, templates), null, 2))
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSource) throw new Error('请选择数据源')
      if (!name.trim()) throw new Error('请填写任务名称')
      if (executor === 'DOLPHINSCHEDULER') {
        const projectCode = Number(dsProject)
        const workflowDefinitionCode = Number(dsWorkflow)
        if (!Number.isInteger(projectCode) || projectCode <= 0 || !Number.isInteger(workflowDefinitionCode) || workflowDefinitionCode <= 0) {
          throw new Error('平台调度通道需填写正整数的项目编号与工作流定义编号')
        }
        return createIngestionJob({
          sourceId: selectedSource.id,
          name: name.trim(),
          mode,
          executor: 'DOLPHINSCHEDULER',
          templateKey: 'CUSTOM',
          templateVersion: DEFAULT_TEMPLATE_VERSION,
          config: { dolphinscheduler: { projectCode, workflowDefinitionCode } },
        })
      }
      if (!allowsTemplate(templateKey, DEFAULT_TEMPLATE_KEY)) {
        throw new Error('真实模式不允许使用 FakeSource 演示模板，请改用自定义 JSON')
      }
      const config = parseConfig(configText)
      return createIngestionJob({
        sourceId: selectedSource.id,
        name: name.trim(),
        mode,
        executor: 'SEATUNNEL',
        templateKey,
        templateVersion,
        config,
      })
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      notify(`采集任务已创建：${created.name}`)
      allowNextLeave()
      navigate('/ingestion')
    },
    onError: (cause) => setError(errorMessage(cause, '采集任务创建失败，请检查配置内容与控制面日志')),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!job) throw new Error('任务不存在')
      if (isDolphinExecutor(job.executor)) {
        const projectCode = Number(dsProject)
        const workflowDefinitionCode = Number(dsWorkflow)
        if (!Number.isInteger(projectCode) || projectCode <= 0 || !Number.isInteger(workflowDefinitionCode) || workflowDefinitionCode <= 0) {
          throw new Error('需填写正整数的项目编号与工作流定义编号')
        }
        return saveJobConfig(job.id, { templateKey: 'CUSTOM', templateVersion: 1, config: { dolphinscheduler: { projectCode, workflowDefinitionCode } } })
      }
      if (!allowsTemplate(templateKey, DEFAULT_TEMPLATE_KEY)) {
        throw new Error('真实模式不允许保存 FakeSource 演示模板，请改用自定义 JSON')
      }
      return saveJobConfig(job.id, { templateKey, templateVersion, config: parseConfig(configText) })
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.config(saved.jobId) })
      setError(null)
      notify(`任务配置已保存：${saved.templateKey} v${saved.templateVersion}`)
    },
    onError: (cause) => setError(errorMessage(cause, '配置保存失败。请确认 JSON 结构正确，且未填写明文密码或密钥。')),
  })

  const structuredCreate = useMutation({
    mutationFn: async (spec: StructuredTaskSpec) => {
      if (!selectedSource) throw new Error('请选择数据源')
      if (!name.trim()) throw new Error('请填写任务名称')
      if (!structuredReady) throw new Error('结构化任务要求所选数据源已登记连接配置（在数据源「浏览」中保存）')
      const tables = spec.form === 'TABLE' ? (spec.tables ?? []) : [spec.targetTable ?? 'sql']
      const created: IngestionJobApiItem[] = []
      for (const table of tables) {
        const createdJob = await createIngestionJob({
          sourceId: selectedSource.id,
          name: tables.length > 1 ? `${name.trim()}_${table}` : name.trim(),
          mode,
          executor: 'SEATUNNEL',
          templateKey: '',
          templateVersion: DEFAULT_TEMPLATE_VERSION,
          config: {},
        })
        const saved = await saveStructuredJobConfig(createdJob.id, spec.form === 'TABLE' ? { ...spec, tables: [table] } : spec)
        created.push({ ...createdJob, configured: true, templateKey: saved.templateKey, templateVersion: saved.templateVersion })
      }
      return created
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      notify(created.length > 1 ? `已创建 ${created.length} 个结构化采集任务` : `采集任务已创建：${created[0].name}`)
      allowNextLeave()
      navigate('/ingestion')
    },
    onError: (cause) => setError(errorMessage(cause, '采集任务创建失败。请确认表单内容，且未填写明文密码或密钥。')),
  })

  const structuredSave = useMutation({
    mutationFn: (spec: StructuredTaskSpec) => saveStructuredJobConfig(job!.id, spec),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.config(saved.jobId) })
      setError(null)
      notify(`任务配置已保存：${saved.templateKey}（增量序列键按水位回放）`)
    },
    onError: (cause) => setError(errorMessage(cause, '配置保存失败。请确认表单内容，且未填写明文密码或密钥。')),
  })

  function requestLeave(target: string) {
    navigate(target)
  }

  if (jobId && jobsRequest.isPending) return <LoadingBlock>正在读取任务…</LoadingBlock>

  if (jobId && jobsRequest.isSuccess && !job) {
    return (
      <Panel>
        <EmptyState
          icon={<AlertTriangle />}
          title="采集任务不存在"
          description="该任务可能已被删除，或当前账号没有访问权限。"
          action={<Button variant="outline" onClick={() => navigate('/ingestion')}>返回数据接入</Button>}
        />
      </Panel>
    )
  }

  const saving = createMutation.isPending || saveMutation.isPending || structuredCreate.isPending || structuredSave.isPending
  const dolphin = executor === 'DOLPHINSCHEDULER' || Boolean(job && isDolphinExecutor(job.executor))
  const editingStructured = Boolean(job && configRequest.data?.structured)

  return (
    <div>

      {jobId && job ? (
        <div className="mb-3.5 flex items-center gap-3 rounded-panel border border-line bg-paper px-4 py-2.5 text-label text-muted-foreground">
          <Badge variant={job.configured ? 'info' : 'warning'}>{job.configured ? `${job.templateKey ?? '自定义'} v${job.templateVersion ?? 1}` : '未配置'}</Badge>
          <span>{job.id}</span>
          <span>·</span>
          <span>{selectedSource ? sourceDisplayName(selectedSource) : '来源未登记'}</span>
          {configRequest.isFetching ? <span className="ml-auto inline-flex items-center gap-1"><LoaderCircle className="size-3 animate-spin" />正在读取已保存配置…</span> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-0 overflow-clip rounded-panel border border-line bg-paper max-[1100px]:grid-cols-1">
        <section className="border-r border-line px-6 py-5 max-[1100px]:border-r-0 max-[1100px]:border-b">
          <h2 className="text-title font-semibold text-ink-soft">来源与策略</h2>
          <p className="mt-1.5 mb-5 text-label leading-relaxed text-muted-foreground">选择来源、命名任务并确定执行通道；结构化与 JSON 是同一任务的两种配置形态。</p>

          {jobId ? null : (
            <FormGrid>
              <FormField label="数据源" required htmlFor="job-source">
                <NativeSelect id="job-source" className="min-h-[35px]" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                  <option value="">选择数据源</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {sourceDisplayName(source)} · {source.systemType}{source.connection ? '' : ' · 未登记连接'}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="任务名称" required htmlFor="job-name">
                <Input id="job-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：LIS 检验结果批量同步" />
              </FormField>
              <FormField label="运行模式" htmlFor="job-mode">
                <NativeSelect id="job-mode" className="min-h-[35px]" value={mode} onChange={(event) => {
                  const nextMode = event.target.value
                  setMode(nextMode)
                  if (!jobId && configMode === 'json') setConfigText(JSON.stringify(configForTemplate(templateKey, nextMode, templates), null, 2))
                }}>
                  <option value="BATCH">批量同步</option>
                  <option value="CDC">增量变更</option>
                </NativeSelect>
              </FormField>
              <FormField label="执行通道" htmlFor="job-executor">
                <NativeSelect id="job-executor" className="min-h-[35px]" value={executor} onChange={(event) => setExecutor(event.target.value as 'SEATUNNEL' | 'DOLPHINSCHEDULER')} disabled={Boolean(job)}>
                  <option value="SEATUNNEL">中心采集执行器</option>
                  <option value="DOLPHINSCHEDULER">平台调度</option>
                </NativeSelect>
              </FormField>
            </FormGrid>
          )}

          {dolphin ? (
            <FormNotice icon={<CalendarClock />}>
              平台调度通道绑定平台调度中已发布的工作流；门户负责调度与运行面的统一管理。周期配置在任务详情「调度」页。
            </FormNotice>
          ) : null}

          {dolphin ? (
            <FormGrid>
              <FormField label="平台调度项目编号" htmlFor="job-ds-project">
                <Input id="job-ds-project" type="number" min={1} value={dsProject} onChange={(event) => setDsProject(event.target.value)} placeholder="例如：15187263948032" />
              </FormField>
              <FormField label="平台调度工作流编号" htmlFor="job-ds-workflow">
                <Input id="job-ds-workflow" type="number" min={1} value={dsWorkflow} onChange={(event) => setDsWorkflow(event.target.value)} placeholder="工作流定义编号" />
              </FormField>
            </FormGrid>
          ) : (
            <>
              <FormField label="配置方式">
                <div role="radiogroup" aria-label="配置方式" className="inline-flex gap-1 rounded-control border border-line bg-wash p-0.5">
                  {([
                    { value: 'structured' as const, label: '结构化表单' },
                    { value: 'json' as const, label: '模板 JSON' },
                  ]).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={configMode === option.value}
                      disabled={option.value === 'structured' && !structuredReady && !editingStructured}
                      onClick={() => setConfigMode(option.value)}
                      className={`rounded-chip px-2.5 py-1 text-label ${configMode === option.value ? 'bg-paper text-blue shadow-focus' : 'text-muted-foreground hover:text-ink'} disabled:opacity-50`}
                    >
                      {option.label}{option.value === 'structured' && !structuredReady ? '（需先登记连接）' : ''}
                    </button>
                  ))}
                </div>
              </FormField>

              {configMode === 'json' ? (
                <>
                  <FormField label="配置模板" htmlFor="job-template">
                    <NativeSelect id="job-template" className="min-h-[35px]" value={templateKey} onChange={(event) => selectTemplate(event.target.value)}>
                      {offersDemoTemplate() ? <option value={DEFAULT_TEMPLATE_KEY}>FakeSource → Console（演示）</option> : null}
                      {templates.map((template) => <option key={template.key} value={template.key}>{template.displayName} · {template.systemType}</option>)}
                      <option value={LIVE_TEMPLATE_KEY}>自定义 JSON</option>
                    </NativeSelect>
                  </FormField>
                  <FormField label="模板版本" htmlFor="job-template-version">
                    <Input id="job-template-version" type="number" min={1} value={templateVersion} onChange={(event) => setTemplateVersion(Math.max(1, Number(event.target.value) || 1))} className="w-[140px]" />
                  </FormField>
                </>
              ) : !structuredReady && !editingStructured ? (
                <FormNotice icon={<KeyRound />}>
                  结构化配置要求所选数据源已登记连接配置。
                  {selectedSource ? (
                    <button type="button" className="ml-2 text-blue underline underline-offset-2" onClick={() => requestLeave(workLinks.ingestionSourceExplorer(selectedSource.id))}>
                      去登记「{sourceDisplayName(selectedSource)}」连接
                    </button>
                  ) : null}
                </FormNotice>
              ) : null}
            </>
          )}

          {/* 结构化形态的保存按钮在右侧表单底部：左栏不出现第二个保存入口。 */}
          {!jobId ? (
            <div className="mt-2 flex items-center gap-2">
              {dolphin || configMode === 'json' || !structuredReady ? (
                <Button
                  disabled={saving}
                  onClick={() => { setError(null); createMutation.mutate() }}
                >
                  <Save size={14} />{createMutation.isPending ? '创建中…' : dolphin || configMode === 'json' ? '创建并保存配置' : '创建任务'}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => requestLeave('/ingestion')} disabled={saving}>取消</Button>
            </div>
          ) : editingStructured ? null : (
            <div className="mt-2 flex items-center gap-2">
              <Button disabled={saving} onClick={() => { setError(null); saveMutation.mutate() }}>
                <Save size={14} />{saveMutation.isPending ? '保存中…' : dolphin ? '保存绑定' : '保存配置'}
              </Button>
            </div>
          )}
          {error ? <p role="alert" className="mt-3 text-body-sm leading-relaxed text-red">{error}</p> : null}
        </section>

        <section className="bg-wash px-6 py-5">
          <h2 className="text-title font-semibold text-ink-soft">{dolphin ? '工作流绑定' : configMode === 'json' ? '采集配置 JSON' : '结构化意图'}</h2>
          <p className="mt-1.5 mb-4 text-label leading-relaxed text-muted-foreground">
            {dolphin
              ? '绑定失败会如实回显；周期调度随工作流生效，不受此处影响。'
              : configMode === 'json'
                ? 'JSON 默认展开可编辑；密码、密钥请使用凭据引用，本版不会落库。'
                : '表单只声明采集意图；保存时控制面对源实校验并编译为作业配置。'}
          </p>

          {dolphin ? (
            <div className="space-y-2 text-label text-ink-soft">
              <p>· 项目与工作流编号来自平台调度，需为真实存在且已发布的对象。</p>
              <p>· 创建后可在任务详情「调度」页配置 CRON、上下线、补数与实例。</p>
              <p>· 门户发起的运行进入任务运行记录；平台定时触发的实例在调度实例中查看。</p>
            </div>
          ) : configMode === 'json' ? (
            <details open className="rounded-control border border-line bg-paper">
              <summary className="cursor-pointer border-b border-line px-3 py-2 text-label font-medium text-ink-soft">
                配置内容 <span className="ml-1 font-normal text-muted-foreground">默认展开 · 可编辑</span>
              </summary>
              <div className="p-3">
                <CodeTextarea
                  aria-label="采集配置 JSON"
                  className="min-h-[420px]"
                  value={configText}
                  onChange={(event) => setConfigText(event.target.value)}
                  spellCheck={false}
                />
                {templatesRequest.isError ? <p className="mt-2 text-meta text-amber">模板目录读取失败：可直接填写 JSON 或稍后重试。</p> : null}
              </div>
            </details>
          ) : editingStructured && job && selectedSource && configRequest.data ? (
            <StructuredTaskFields
              source={selectedSource}
              initial={configRequest.data.structured}
              lastSuccessWatermark={configRequest.data.lastSuccessWatermark}
              saving={structuredSave.isPending}
              submitLabel="保存任务配置"
              onSubmit={(spec) => { setError(null); structuredSave.mutate(spec) }}
              onDirtyChange={setStructuredDirty}
              onCancel={() => requestLeave(workLinks.ingestionJob(job.id))}
            />
          ) : selectedSource && structuredReady ? (
            <StructuredTaskFields
              source={selectedSource}
              initial={structuredSpec}
              lastSuccessWatermark={null}
              saving={structuredCreate.isPending}
              submitLabel="创建任务并保存配置"
              submitHint="多选表时每表一个任务"
              onSubmit={(spec) => { setError(null); structuredCreate.mutate(spec) }}
              onDirtyChange={setStructuredDirty}
              onCancel={() => requestLeave('/ingestion')}
            />
          ) : (
            <FormNotice icon={<FileCog />}>所选数据源还没有可用的连接配置；先保存连接，或改用模板 JSON。</FormNotice>
          )}
        </section>
      </div>

      <ScopeNote>保存不会发起运行；运行只从任务列表或任务详情显式启动。</ScopeNote>

      {guard}
    </div>
  )
}

/**
 * 独立工作页包装：/ingestion/new 与 /ingestion/jobs/$jobId?tab=configuration
 * 共用同一编辑器；页头与退出路径由页面壳提供。
 */
export function JobEditorPage({ jobId }: { jobId?: string }) {
  const navigate = usePortalNavigate()
  return (
    <div>
      <Breadcrumb items={[
        { label: '数据管理' },
        { label: '数据接入' },
        ...(jobId ? [{ label: '采集任务' }, { label: '任务配置' }] : [{ label: '新建采集任务' }]),
      ]} />
      <PageHeading
        title={jobId ? '任务配置' : '新建采集任务'}
        description={jobId
          ? '保存的是可审计的结构配置；连接密码、Token、Secret 通过凭据引用接入。'
          : '表单只收集采集意图；库表、字段与连接在保存前由控制面对数据源实校验后编译。'}
        actions={<Button variant="outline" onClick={() => navigate(jobId ? workLinks.ingestionJob(jobId) : '/ingestion')}>返回</Button>}
      />
      <JobConfigurationEditor jobId={jobId} />
    </div>
  )
}

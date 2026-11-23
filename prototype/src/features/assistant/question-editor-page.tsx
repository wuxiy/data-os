import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { Download, FlaskConical, Plus, Save, ShieldQuestion, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../../components/kit/badge'
import { Button } from '../../components/kit/button'
import { FormField, FormGrid, FormNotice } from '../../components/kit/form'
import { CodeTextarea, Input, NativeSelect } from '../../components/kit/input'
import { Confirm } from '../../components/kit/overlay'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel, PanelHead } from '../../components/kit/panel'
import { Tabs, TabPanel } from '../../components/kit/popover'
import { EmptyState, LoadingBlock } from '../../components/kit/states'
import { DataTable, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  assistantParamLabel,
  assistantQuestionAction,
  deleteAssistantQuestion,
  QUESTION_STATUS_LABEL,
  saveAssistantQuestion,
  testAssistantQuestion,
  type AssistantAdminQuestionView,
  type AssistantAnswer,
  type AssistantQuestionDraft,
  type AssistantQuestionEventView,
} from '../../data/assistantApi'
import { formatDateTime } from '../../data/domain'
import { workLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { useDirtyLeaveGuard } from '../../app/dirty-leave-guard'
import { assistantKeys, assistantAdminQuestionsQuery, assistantQuestionEventsQuery } from './queries'

type TabValue = 'definition' | 'try' | 'events'

interface ParamRow {
  name: string
  type: string
  required: boolean
  defaultValue: string
  valuesText: string
}

interface DraftForm {
  code: string
  question: string
  aliasesText: string
  serviceCode: string
  answerTemplate: string
  paramRows: ParamRow[]
}

const EMPTY_FORM: DraftForm = { code: '', question: '', aliasesText: '', serviceCode: '', answerTemplate: '', paramRows: [] }

function formOf(question: AssistantAdminQuestionView): DraftForm {
  return {
    code: question.code,
    question: question.question,
    aliasesText: question.aliases.join('\n'),
    serviceCode: question.serviceCode,
    answerTemplate: question.answerTemplate,
    paramRows: (question.paramSchema ?? []).map((contract) => ({
      name: contract.name,
      type: contract.type,
      required: contract.required ?? false,
      defaultValue: contract.defaultValue ?? '',
      valuesText: (contract.values ?? []).join(','),
    })),
  }
}

function draftOf(form: DraftForm): AssistantQuestionDraft {
  return {
    code: form.code.trim(),
    question: form.question.trim(),
    aliases: form.aliasesText.split('\n').map((line) => line.trim()).filter(Boolean),
    paramSchema: form.paramRows
      .filter((row) => row.name.trim())
      .map((row) => ({
        name: row.name.trim(),
        type: row.type,
        required: row.required,
        ...(row.defaultValue.trim() ? { defaultValue: row.defaultValue.trim() } : {}),
        ...(() => {
          const values = row.valuesText.split(',').map((value) => value.trim()).filter(Boolean)
          return values.length > 0 ? { values } : {}
        })(),
      })),
    serviceCode: form.serviceCode.trim(),
    answerTemplate: form.answerTemplate,
  }
}

const eventHelper = listColumnHelper<AssistantQuestionEventView>()

/**
 * 已验证问题工作页：定义（DRAFT 可编辑、PUBLISHED 只读）、试运行、事件三 Tab。
 * 发布须「最近一次成功试运行晚于最后编辑」；试运行参数与结果留在页内可往返核对。
 */
export function QuestionEditorPage({ questionCode }: { questionCode?: string }) {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const search = useSearch({ strict: false }) as { tab?: TabValue }
  const tab: TabValue = search.tab && ['definition', 'try', 'events'].includes(search.tab) ? search.tab : 'definition'

  const questionsRequest = useQuery(assistantAdminQuestionsQuery())
  const question = questionCode ? questionsRequest.data?.find((item) => item.code === questionCode) : undefined
  const readOnly = question ? question.status !== 'DRAFT' : false
  const eventsRequest = useQuery({ ...assistantQuestionEventsQuery(questionCode ?? ''), enabled: Boolean(questionCode) && tab === 'events' })

  const [form, setForm] = useState<DraftForm>(EMPTY_FORM)
  const [initialized, setInitialized] = useState(!questionCode)
  const [testParams, setTestParams] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<AssistantAnswer | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!question || initialized) return
    setForm(formOf(question))
    setInitialized(true)
  }, [initialized, question])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.adminQuestions() })
    void queryClient.invalidateQueries({ queryKey: assistantKeys.questions() })
  }

  const dirty = !readOnly && initialized && (questionCode
    ? JSON.stringify(form) !== JSON.stringify(question ? formOf(question) : EMPTY_FORM)
    : JSON.stringify(form) !== JSON.stringify(EMPTY_FORM))

  // 拦一切路由离开（含侧栏/页签）；返回/问数审计只需正常 navigate，守卫会先询问。
  const { allowNextLeave, guard } = useDirtyLeaveGuard(dirty)

  const saveMutation = useMutation({
    mutationFn: () => saveAssistantQuestion(draftOf(form), questionCode || undefined),
    onSuccess: (saved) => {
      invalidate()
      notify(`问题 ${saved.code} 已保存（${QUESTION_STATUS_LABEL[saved.status] ?? saved.status}）`)
      if (!questionCode) {
        allowNextLeave()
        navigate(workLinks.assistantQuestion(saved.code, 'try'))
      }
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '问题保存失败'),
  })

  const actionMutation = useMutation({
    mutationFn: (action: 'publish' | 'deprecate' | 'reopen' | 'delete') =>
      action === 'delete' ? deleteAssistantQuestion(questionCode as string).then(() => ({ code: questionCode as string, status: 'DELETED' })) : assistantQuestionAction(questionCode as string, action),
    onSuccess: (_result, action) => {
      invalidate()
      if (action === 'delete') {
        notify('草稿已删除')
        allowNextLeave()
        navigate('/assistant/workspace')
        return
      }
      notify({ publish: `${questionCode} 已发布`, deprecate: `${questionCode} 已停用`, reopen: `${questionCode} 已重新起草（草稿）`, delete: '草稿已删除' }[action])
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '问题状态变更失败'),
  })

  const testMutation = useMutation({
    mutationFn: () => testAssistantQuestion(questionCode as string, testParams),
    onSuccess: (result) => {
      setTestResult(result)
      invalidate()
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '试运行失败'),
  })

  function goTab(next: TabValue) {
    if (!questionCode) return
    navigate(workLinks.assistantQuestion(questionCode, next))
  }

  if (questionCode && questionsRequest.isPending) return <LoadingBlock>正在读取问题…</LoadingBlock>
  if (questionCode && questionsRequest.isSuccess && !question) {
    return (
      <Panel>
        <EmptyState
          icon={<ShieldQuestion />}
          title="问题不存在"
          description="该问题可能已被删除，或当前账号没有治理权限。"
          action={<Button onClick={() => navigate('/assistant/workspace')}>返回问数工作区</Button>}
        />
      </Panel>
    )
  }

  const eventColumns = eventHelper.columns([
    eventHelper.display({ id: 'type', header: '事件', size: 160, cell: ({ row }) => <Badge>{row.original.action}</Badge> }),
    eventHelper.display({ id: 'actor', header: '操作者', size: 140, cell: ({ row }) => <span className="text-label">{row.original.actor}</span> }),
    eventHelper.display({ id: 'detail', header: '说明', cell: ({ row }) => <span className="text-label text-muted-foreground">{row.original.detail}</span> }),
    eventHelper.display({ id: 'at', header: '时间', size: 140, cell: ({ row }) => <span className="text-meta text-muted-foreground">{formatDateTime(row.original.createdAt)}</span> }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '数据应用' }, { label: '智能问数' }, { label: '专业工作区' }, { label: questionCode ?? '新建问题' }]} trailing={question ? <><Badge tone={question.status === 'PUBLISHED' ? 'success' : question.status === 'DRAFT' ? 'neutral' : 'warn'}>{QUESTION_STATUS_LABEL[question.status] ?? question.status}</Badge></> : null} />
      <PageHeading
        title={questionCode ? '已验证问题' : '新建已验证问题'}
        description="发布须最近一次成功试运行晚于最后一次编辑；已发布问题只读，可继续试运行核对口径。"
        actions={
          <>
            <Button onClick={() => navigate('/assistant/workspace')}>返回工作区</Button>
            {questionCode ? <Button onClick={() => navigate(workLinks.assistantAudit())}><Download size={14} />问数审计</Button> : null}
          </>
        }
      />

      <Panel>
        <Tabs
          value={tab}
          onValueChange={(value) => goTab(value as TabValue)}
          items={[
            { value: 'definition', label: '定义' },
            { value: 'try', label: '试运行' },
            { value: 'events', label: '事件', count: eventsRequest.data?.total },
          ]}
        >
          <TabPanel value="definition" className="px-5 py-4">
            <FormNotice icon={<ShieldQuestion />}>
              {readOnly
                ? '当前状态不可编辑定义。发布后仍可试运行核对口径；如需修改，先停用再重新起草。'
                : '门户只声明问题与参数契约；执行由已发布的数据服务受限完成，未知问题明确拒答。'}
            </FormNotice>
            <FormGrid>
              <FormField label="问题代码" required htmlFor="question-code" hint="小写字母/数字/连字符，创建后不可修改">
                <Input id="question-code" value={form.code} disabled={Boolean(questionCode)} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="prescription-daily-summary" />
              </FormField>
              <FormField label="数据服务代码" required htmlFor="question-service">
                <Input id="question-service" value={form.serviceCode} disabled={readOnly} onChange={(event) => setForm({ ...form, serviceCode: event.target.value })} placeholder="已发布的数据服务（Data API registry）" />
              </FormField>
            </FormGrid>
            <FormField label="问题原文" required htmlFor="question-text">
              <Input id="question-text" value={form.question} disabled={readOnly} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="用户将以此原文或别名命中该问题" />
            </FormField>
            <FormField label="同义别名（每行一个）" htmlFor="question-aliases">
              <CodeTextarea id="question-aliases" className="min-h-[90px]" value={form.aliasesText} disabled={readOnly} onChange={(event) => setForm({ ...form, aliasesText: event.target.value })} placeholder={'每日处方量趋势\n按天统计处方量'} />
            </FormField>

            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-body-sm text-ink-soft">参数 Schema（与数据服务契约一致）</span>
                {!readOnly ? <Button size="sm" variant="text" onClick={() => setForm({ ...form, paramRows: [...form.paramRows, { name: '', type: 'string', required: false, defaultValue: '', valuesText: '' }] })}><Plus size={12} />添加参数</Button> : null}
              </div>
              {form.paramRows.map((row, index) => (
                <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_120px_120px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <Input
                    aria-label={`参数 ${index + 1} 名称`}
                    value={row.name}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })}
                    placeholder="start_date"
                  />
                  <NativeSelect aria-label={`参数 ${index + 1} 类型`} className="min-h-[35px]" value={row.type} disabled={readOnly} onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) })}>
                    <option value="date">date</option><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option>
                  </NativeSelect>
                  <label className="flex items-center gap-1.5 text-label text-ink-soft">
                    <input type="checkbox" className="size-[13px] accent-blue" checked={row.required} disabled={readOnly} onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) })} />
                    必填
                  </label>
                  <Input aria-label={`参数 ${index + 1} 默认值`} value={row.defaultValue} disabled={readOnly} onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, defaultValue: event.target.value } : item) })} placeholder="默认值" />
                  <Input aria-label={`参数 ${index + 1} 枚举`} value={row.valuesText} disabled={readOnly} onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, valuesText: event.target.value } : item) })} placeholder="枚举（逗号分隔）" />
                  {!readOnly ? <Button size="sm" variant="text" aria-label={`移除参数 ${index + 1}`} onClick={() => setForm({ ...form, paramRows: form.paramRows.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={12} /></Button> : null}
                </div>
              ))}
              {form.paramRows.length === 0 ? <p className="text-label text-muted-foreground">无参数问题可直接执行；有参数时问数面会要求填写。</p> : null}
            </div>

            <FormField label="回答模板" htmlFor="question-template">
              <CodeTextarea id="question-template" className="min-h-[90px]" value={form.answerTemplate} disabled={readOnly} onChange={(event) => setForm({ ...form, answerTemplate: event.target.value })} placeholder="回答前缀或口径说明（可选）" />
            </FormField>

            {error ? <p role="alert" className="mb-3 text-body-sm text-red">{error}</p> : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <span className="text-meta text-muted-foreground">{question ? `最近${question.verified ? '已试运行通过' : '未验证'}` : '保存后进入草稿'}</span>
              <div className="flex flex-wrap items-center gap-2">
                {question?.status === 'DRAFT' ? (
                  <>
                    <Button disabled={saveMutation.isPending} onClick={() => setConfirmDelete(true)} variant="danger-outline"><Trash2 size={13} />删除草稿</Button>
                    <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}><Save size={13} />{saveMutation.isPending ? '保存中…' : '保存草稿'}</Button>
                    <Button variant="primary" disabled={!question.verified || actionMutation.isPending} title={question.verified ? '发布到问数面' : '需最近一次成功试运行晚于最后编辑'} onClick={() => actionMutation.mutate('publish')}>发布</Button>
                  </>
                ) : null}
                {question?.status === 'PUBLISHED' ? (
                  <Button variant="danger-outline" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate('deprecate')}>停用</Button>
                ) : null}
                {question?.status === 'DEPRECATED' ? (
                  <Button disabled={actionMutation.isPending} onClick={() => actionMutation.mutate('reopen')}>重新起草</Button>
                ) : null}
                {!questionCode ? <Button variant="primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}><Save size={13} />{saveMutation.isPending ? '保存中…' : '创建草稿'}</Button> : null}
              </div>
            </div>
          </TabPanel>

          <TabPanel value="try" className="px-5 py-4">
            {!questionCode ? (
              <EmptyState minHeight={220} icon={<FlaskConical />} title="先保存草稿再试运行" description="试运行需要问题代码与服务绑定；创建后即可在此验证参数与回答。" />
            ) : (
              <>
                <FormNotice icon={<FlaskConical />}>
                  试运行使用与问数面相同的执行链路；结果与拒答信封同构，参数与结果留在此页以便往返核对。
                </FormNotice>
                <div className="mb-3 flex flex-wrap items-end gap-2.5">
                  {(question?.paramSchema ?? []).map((contract) => {
                    const label = assistantParamLabel(contract.name, contract.description)
                    return (
                      <label key={contract.name} className="min-w-[150px]">
                        <span className="mb-1 block text-meta text-muted-foreground">{label}{contract.required ? ' *' : ''}</span>
                        <Input
                          type={contract.type === 'date' ? 'date' : contract.type === 'number' ? 'number' : 'text'}
                          aria-label={label}
                          value={testParams[contract.name] ?? contract.defaultValue ?? ''}
                          onChange={(event) => setTestParams({ ...testParams, [contract.name]: event.target.value })}
                        />
                      </label>
                    )
                  })}
                  <Button variant="primary" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
                    <FlaskConical size={13} />{testMutation.isPending ? '试运行中…' : '试运行'}
                  </Button>
                </div>
                {testResult ? (
                  <div className={`rounded-panel border px-4 py-3 ${testResult.answered ? 'border-line' : 'border-[#eee2c5] bg-[#fdf9ef]'}`}>
                    <div className="flex items-center gap-2">
                      <Badge tone={testResult.answered ? 'success' : 'warn'}>{testResult.answered ? '通过' : '拒答'}</Badge>
                      <span className="text-label text-muted-foreground">
                        {testResult.answered ? `${testResult.rowCount ?? testResult.rows?.length ?? 0} 行 · ${testResult.evidence?.elapsedMs ?? 0} ms` : (testResult.reason ?? '未命中已验证问题')}
                      </span>
                    </div>
                    {testResult.answered && (testResult.columns ?? []).length > 0 ? (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full border-collapse text-left text-label">
                          <thead className="bg-wash text-muted-foreground">
                            <tr>{(testResult.columns ?? []).map((column) => <th key={column} className="border-b border-line px-2 py-1.5 font-normal">{column}</th>)}</tr>
                          </thead>
                          <tbody>
                            {(testResult.rows ?? []).slice(0, 20).map((row, rowIndex) => (
                              <tr key={rowIndex} className="border-b border-line-soft last:border-b-0">
                                {(row as unknown[]).map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-1.5 font-mono text-meta text-ink-soft">{String(cell ?? '')}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    <p className="mt-2 text-meta text-muted-foreground">最近一次成功试运行须晚于最后编辑，才允许发布。</p>
                  </div>
                ) : null}
              </>
            )}
          </TabPanel>

          <TabPanel value="events" className="px-5 py-4">
            {!questionCode ? (
              <EmptyState minHeight={200} icon={<ShieldQuestion />} title="先保存草稿" description="问题创建后才有事件留痕。" />
            ) : (
              <DataTable
                columns={eventColumns}
                data={eventsRequest.data?.events ?? []}
                getRowId={(event, index) => `${event.action}-${event.createdAt}-${index}`}
                loading={eventsRequest.isPending}
                empty={<EmptyState minHeight={180} title="暂无事件" description="创建、保存、试运行与生命周期动作都会留下记录。" />}
                footer={eventsRequest.data && eventsRequest.data.total > eventsRequest.data.returned
                  ? <p className="px-4 py-2 text-meta text-muted-foreground">共 {eventsRequest.data.total} 条，已显示最近 {eventsRequest.data.returned} 条。</p>
                  : undefined}
              />
            )}
          </TabPanel>
        </Tabs>
      </Panel>

      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`删除草稿 ${questionCode ?? ''}`}
        description="草稿将被删除；已产生的试运行与审计记录保留。此操作不可撤销。"
        object={question ? { name: question.question, meta: question.code } : undefined}
        confirmLabel="删除草稿"
        tone="destructive"
        busy={actionMutation.isPending}
        onConfirm={() => actionMutation.mutate('delete')}
      />

      {guard}
    </div>
  )
}

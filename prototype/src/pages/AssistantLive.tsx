import { useMutation, useQuery } from '@tanstack/react-query'
import { Ban, MessageSquareText, Send, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { QueryBoundary } from '../app/query-boundary'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input, NativeSelect } from '../components/ui/input'
import { Panel, PanelHead } from '../components/ui/panel'
import { EmptyState, LoadingBlock, Skeleton } from '../components/ui/states'
import { DataTable, listColumnHelper } from '../components/table/data-table'
import {
  assistantParamLabel,
  askAssistantQuery,
  REFUSAL_LABEL,
  submitAssistantFeedback,
  type AssistantAnswer,
  type AssistantQuestionView,
} from '../data/assistantApi'
import { AssistantGovernanceSection } from '../features/assistant/governance-section'
import { assistantQuestionsQuery } from '../features/assistant/queries'

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/

function dataTimeRangeOf(answer: AssistantAnswer): string {
  const columns = answer.columns ?? []
  const rows = answer.rows ?? []
  const dateIndexes = columns.map((name, index) => (/date|日期/.test(name) ? index : -1)).filter((index) => index >= 0)
  const dates = rows
    .flatMap((row) => dateIndexes.map((index) => String(row[index] ?? '')))
    .filter((value) => DATE_LIKE.test(value))
    .sort()
  if (dates.length === 0) return ''
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`
}

/**
 * 智能问数（受控只读分析）：已验证问题 → 已发布数据服务。
 * 参数表单用受控原生输入——日期「输入即提交值」，避免手输未确认时丢参数被判必填。
 * 未命中的问题明确拒答，不生成任意 SQL；结果与证据同屏，审计号可复核。
 */
export function AssistantLive({
  onNotice,
  professional = false,
  governance = false,
}: {
  onNotice: (message: string) => void
  professional?: boolean
  governance?: boolean
}) {
  return (
    <QueryBoundary>
      <AssistantWorkspace onNotice={onNotice} professional={professional} governance={governance} />
    </QueryBoundary>
  )
}

function AssistantWorkspace({
  onNotice,
  professional,
  governance,
}: {
  onNotice: (message: string) => void
  professional: boolean
  governance: boolean
}) {
  const questionsRequest = useQuery(assistantQuestionsQuery())
  const questions = questionsRequest.data ?? []

  const [selectedCode, setSelectedCode] = useState('')
  const [params, setParams] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [displayQuestion, setDisplayQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [feedbackState, setFeedbackState] = useState<'idle' | 'recording' | 'recorded'>('idle')

  const selected = useMemo(() => questions.find((question) => question.code === selectedCode) ?? null, [questions, selectedCode])
  const dataTimeRange = answer?.answered ? dataTimeRangeOf(answer) : ''

  function selectQuestion(question: AssistantQuestionView) {
    setSelectedCode(question.code)
    setParams({})
    setDraft(question.question)
    setAnswer(null)
    setDisplayQuestion('')
    setFeedbackState('idle')
  }

  const ask = useMutation({
    mutationFn: ({ text, parameters }: { text: string; parameters: Record<string, string> }) => askAssistantQuery(text, parameters),
    onSuccess: (result) => {
      setAnswer(result)
      setFeedbackState('idle')
      if (!result.answered) onNotice(REFUSAL_LABEL[result.outcome ?? ''] ?? '问数已拒答')
    },
    onError: (cause) => onNotice(cause instanceof Error && cause.message ? cause.message : '本次查询未完成，请稍后重试。'),
  })

  const feedback = useMutation({
    mutationFn: ({ auditId, rating }: { auditId: string; rating: 'helpful' | 'not_helpful' }) => submitAssistantFeedback(auditId, rating),
    onSuccess: (_data, variables) => {
      setFeedbackState('recorded')
      onNotice(`反馈已记录到审计 ${variables.auditId.slice(0, 8)}`)
    },
    onError: (cause) => {
      setFeedbackState('idle')
      onNotice(cause instanceof Error && cause.message ? cause.message : '反馈提交失败')
    },
  })

  function submitQuestion(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || ask.isPending) return
    setDisplayQuestion(text)
    ask.mutate({ text, parameters: params })
  }

  function sendFeedback(rating: 'helpful' | 'not_helpful') {
    if (!answer?.auditId || feedbackState !== 'idle') return
    setFeedbackState('recording')
    feedback.mutate({ auditId: answer.auditId, rating })
  }

  const resultHelper = listColumnHelper<unknown[]>()
  const resultColumns = (answer?.columns ?? []).map((column, index) => resultHelper.display({
    id: `c-${index}`,
    header: column,
    cell: ({ row }) => <span className="text-label">{String(row.original[index] ?? '')}</span>,
  }))

  if (questionsRequest.isError) {
    return (
      <Panel>
        <EmptyState
          minHeight={240}
          icon={<MessageSquareText />}
          title="问数服务暂不可用"
          description="暂时无法读取已验证问题。可重新读取；持续失败时请联系平台运维核对服务连接。"
          action={<Button onClick={() => void questionsRequest.refetch()}>重新读取问题</Button>}
        />
      </Panel>
    )
  }

  const asking = ask.isPending

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-[280px_minmax(0,1fr)_300px] gap-3.5 max-[1320px]:grid-cols-[260px_minmax(0,1fr)] max-[1100px]:grid-cols-1">
        <Panel className="flex flex-col">
          <PanelHead title="已验证问题" count={questions.length} description={professional ? '专业模式 · 受控只读' : '问数面只列已发布问题'} />
          {questionsRequest.isPending ? <div className="px-4 pb-3"><Skeleton rows={3} /></div> : null}
          <ul className="m-0 min-h-0 flex-1 list-none px-2 pb-2">
            {questions.map((question) => (
              <li key={question.code}>
                <button
                  type="button"
                  aria-pressed={question.code === selectedCode}
                  disabled={asking}
                  onClick={() => selectQuestion(question)}
                  className={`mb-1 w-full rounded-control px-2.5 py-2 text-left ${question.code === selectedCode ? 'bg-blue-soft' : 'hover:bg-wash'}`}
                >
                  <span className="block text-body-sm text-[#43546e]">{question.question}</span>
                  <span className="mt-0.5 block font-mono text-meta text-[#8b94a1]">{question.serviceCode}</span>
                </button>
              </li>
            ))}
            {questions.length === 0 && questionsRequest.isSuccess ? <li className="px-3 py-6 text-center text-label text-muted">当前租户暂无已发布的已验证问题。</li> : null}
          </ul>
          <div className="border-t border-line px-3 py-2 text-meta leading-relaxed text-[#98a2ae]">
            同义表达命中同一问题代码；未知问题明确拒答，不生成任意 SQL。
          </div>
        </Panel>

        <Panel className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-chip bg-blue-soft text-blue"><MessageSquareText size={15} /></span>
              <div>
                <strong className="block text-body-sm text-[#43546e]">医疗运营问数助手</strong>
                <span className="block text-meta text-[#8b94a1]">已验证问题 → 已发布数据服务</span>
              </div>
            </div>
            <Badge tone="success">只读模式</Badge>
          </div>

          {selected && (selected.paramSchema ?? []).length > 0 ? (
            <form
              aria-label="问题参数"
              className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (!draft.trim() || asking) return
                setDisplayQuestion(draft.trim())
                ask.mutate({ text: draft.trim(), parameters: params })
              }}
            >
              {selected.paramSchema.map((contract) => {
                const label = assistantParamLabel(contract.name, contract.description)
                return (
                  <label key={contract.name} className="min-w-[140px]">
                    <span className="mb-1 block text-meta text-[#6b788b]">{label}{contract.required ? ' *' : ''}</span>
                    {contract.type === 'date' ? (
                      <Input
                        type="date"
                        value={params[contract.name] ?? ''}
                        aria-label={label}
                        onChange={(event) => setParams({ ...params, [contract.name]: event.target.value })}
                      />
                    ) : contract.type === 'boolean' ? (
                      <NativeSelect
                        aria-label={label}
                        className="min-h-[35px]"
                        value={params[contract.name] ?? ''}
                        onChange={(event) => setParams({ ...params, [contract.name]: event.target.value })}
                      >
                        <option value="">未指定</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </NativeSelect>
                    ) : (contract.values ?? []).length > 0 ? (
                      <NativeSelect
                        aria-label={label}
                        className="min-h-[35px]"
                        value={params[contract.name] ?? ''}
                        onChange={(event) => setParams({ ...params, [contract.name]: event.target.value })}
                      >
                        <option value="">请选择</option>
                        {(contract.values ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
                      </NativeSelect>
                    ) : (
                      <Input
                        type={contract.type === 'number' ? 'number' : 'text'}
                        value={params[contract.name] ?? ''}
                        placeholder={contract.description ?? contract.name}
                        aria-label={label}
                        onChange={(event) => setParams({ ...params, [contract.name]: event.target.value })}
                      />
                    )}
                  </label>
                )
              })}
              <Button type="submit" variant="primary" disabled={asking || !draft.trim()}>
                {asking ? '查询中…' : '按参数执行'}
              </Button>
            </form>
          ) : null}

          <div aria-live="polite" aria-busy={asking} className="min-h-[280px] flex-1 px-4 py-4">
            {displayQuestion ? (
              <div className="mb-3 flex justify-end">
                <div className="max-w-[80%] rounded-panel rounded-br-chip bg-blue-soft px-3 py-2 text-body-sm text-[#28456f]">{displayQuestion}</div>
              </div>
            ) : (
              <div className="rounded-panel border border-line bg-wash px-4 py-4">
                <h2 className="text-title font-semibold text-[#43546e]">{questions.length === 0 && questionsRequest.isSuccess ? '还没有可执行的问题' : '从一个已验证问题开始'}</h2>
                <p className="mt-1.5 text-label leading-relaxed text-[#738199]">
                  {questions.length === 0 && questionsRequest.isSuccess
                    ? '当前租户暂无已发布问题。请联系治理人员完成配置、试运行和发布后再查询。'
                    : '选择左侧问题，再按业务范围调整参数。结果和执行证据会在同一工作区展示。'}
                </p>
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-label text-[#6b7789]">
                  <li><strong>选问题</strong>，确认业务口径与受控数据服务。</li>
                  <li><strong>定范围</strong>，填写时间等必需参数后执行。</li>
                  <li><strong>核对结果</strong>，查看明细、统计窗口与审计号。</li>
                </ol>
              </div>
            )}

            {asking ? <LoadingBlock className="min-h-[120px]">正在执行受控查询，完成后展示结果与本次证据。</LoadingBlock> : null}
            {ask.isError ? (
              <div role="alert" className="mt-3 rounded-control border border-red-line bg-red-soft px-3 py-2 text-label text-[#8f1d13]">
                <strong>本次查询未完成</strong>
                <p className="mt-1">{ask.error instanceof Error ? ask.error.message : '请核对问题与参数后重新发送。'}</p>
              </div>
            ) : null}

            {answer && !answer.answered ? (
              <article className="mt-3 rounded-panel border border-[#eee2c5] bg-[#fdf9ef] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Ban size={16} className="text-amber" />
                  <strong className="text-body-sm text-[#8e7040]">拒答</strong>
                  <span className="text-label text-[#9a7a45]">{REFUSAL_LABEL[answer.outcome ?? ''] ?? answer.outcome}</span>
                </div>
                <p className="mt-2 text-label leading-relaxed text-[#8e7040]">{answer.reason}</p>
                {(answer.supportedQuestions ?? []).length > 0 ? <p className="mt-2 text-label text-[#9a7a45]"><strong>可问清单：</strong>{(answer.supportedQuestions ?? []).join('；')}</p> : null}
              </article>
            ) : null}

            {answer && answer.answered ? (
              <article className="mt-3 rounded-panel border border-line">
                <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-chip bg-[#edf6f0] text-green"><MessageSquareText size={15} /></span>
                    <div>
                      <strong className="block text-body-sm text-[#43546e]">分析结果</strong>
                      <span className="block text-meta text-[#8b94a1]">{answer.evidence?.serviceCode} {answer.evidence?.serviceVersion} · 受控执行</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex size-7 items-center justify-center rounded-chip text-[#6b7889] hover:bg-wash disabled:opacity-50" onClick={() => sendFeedback('helpful')} disabled={feedbackState !== 'idle'} aria-label={feedbackState === 'recorded' ? '反馈已记录' : '回答有帮助'}><ThumbsUp size={14} /></button>
                    <button type="button" className="inline-flex size-7 items-center justify-center rounded-chip text-[#6b7889] hover:bg-wash disabled:opacity-50" onClick={() => sendFeedback('not_helpful')} disabled={feedbackState !== 'idle'} aria-label="回答需要改进"><ThumbsDown size={14} /></button>
                  </div>
                </header>
                <div className="px-4 py-3">
                  <p className="text-body-sm leading-relaxed text-[#4a5666]">{answer.answer}</p>
                  {answer.truncated ? <p className="mt-2 text-label text-amber"><strong>结果截断：</strong>已按服务行数上限返回 {answer.rowCount} 行。</p> : null}
                  {feedbackState === 'recorded' ? <p className="mt-2 text-meta text-[#98a2ae]">反馈已记录（审计 {answer.auditId.slice(0, 8)}…）。</p> : null}
                  <h3 className="mt-3 mb-1.5 text-label font-medium text-[#566173]">核对明细</h3>
                  <DataTable
                    columns={resultColumns}
                    data={answer.rows ?? []}
                    getRowId={(_row, index) => String(index)}
                    empty={<p className="py-2 text-label text-muted">查询已完成，当前范围内没有数据。可调整统计参数后重试。</p>}
                  />
                </div>
              </article>
            ) : null}
          </div>

          <form className="border-t border-line px-4 py-3" onSubmit={submitQuestion}>
            <div className="flex items-center gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="输入问题原文或别名，例如：每日处方量趋势"
                aria-label="输入问数问题"
                rows={1}
                className="min-h-[38px] flex-1 resize-none rounded-control border border-line-strong bg-paper px-2.5 py-2 text-body-sm text-ink-soft"
              />
              <Button type="submit" variant="primary" size="icon" aria-label="发送问题" disabled={!draft.trim() || asking}><Send size={16} /></Button>
            </div>
            <p className="mt-1.5 text-meta text-[#98a2ae]">回答来自已发布数据服务的受限执行；重要结论请结合口径与数据时间复核。</p>
          </form>
        </Panel>

        <Panel className="max-[1320px]:col-span-2 max-[1100px]:col-span-1">
          <PanelHead
            title="回答证据"
            actions={<Badge tone={answer?.answered ? 'success' : answer ? 'warn' : 'neutral'}>{answer?.answered ? '可复核' : answer ? '拒答留痕' : asking ? '执行中' : ask.isError ? '查询未完成' : '待提问'}</Badge>}
          />
          <div className="px-4 pb-4">
            <div className="mb-3 flex items-center gap-2 rounded-control border border-line bg-wash px-3 py-2">
              <span className="flex size-7 items-center justify-center rounded-chip bg-paper text-blue"><MessageSquareText size={15} /></span>
              <div>
                <strong className="block text-label text-[#43546e]">问数审计号</strong>
                <span className="block font-mono text-meta text-[#8b94a1]">{answer ? `${answer.auditId.slice(0, 13)}…` : '提问后生成'}</span>
              </div>
            </div>
            <dl className="space-y-2">
              <Evidence label="数据服务" value={answer?.evidence ? `${answer.evidence.serviceCode} ${answer.evidence.serviceVersion}` : '—'} />
              <Evidence label="统计窗口" value={answer?.evidence ? Object.entries(answer.evidence.statisticsWindow).map(([key, value]) => `${key}=${String(value)}`).join(' · ') || '—' : '—'} />
              <Evidence label="数据时间" value={dataTimeRange || '—'} />
              <Evidence label="行数 / 截断" value={answer?.evidence ? `${answer.evidence.rowCount} 行${answer.evidence.truncated ? ' · 已截断' : ''}` : '—'} />
              <Evidence label="耗时" value={answer?.evidence ? `${answer.evidence.elapsedMs} ms` : '—'} />
              <Evidence label="执行路径" value={answer?.evidence?.executionPath ?? '—'} />
            </dl>
            <div className="mt-3 flex items-start gap-1.5 rounded-control border border-blue-line bg-[#f3f7ff] px-3 py-2 text-meta leading-relaxed text-[#536e9b]">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" />
              查询由受控服务执行；助手不能修改标准、质量规则、主数据或源系统。
            </div>
          </div>
        </Panel>
      </div>

      {professional && governance ? <AssistantGovernanceSection onNotice={onNotice} /> : null}
    </div>
  )
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta text-[#8a929e]">{label}</dt>
      <dd className="m-0 break-all text-label text-[#4a5666]">{value}</dd>
    </div>
  )
}

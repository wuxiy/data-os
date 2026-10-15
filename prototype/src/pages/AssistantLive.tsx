import { Ban, MessageSquareText, Send, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, DatePicker, Form, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { PageHeader } from '../components/ui/PageHeader'
import {
  askAssistantQuery,
  fetchAssistantQuestions,
  REFUSAL_LABEL,
  submitAssistantFeedback,
  type AssistantAnswer,
  type AssistantQuestionView,
} from '../data/assistantApi'
import { useApiResource } from '../hooks/useApiResource'
import { AssistantGovernance } from './AssistantGovernance'
import styles from './IntegrationPages.module.css'
import localStyles from './AssistantLive.module.css'

/**
 * 智能问数真实页（G26）：只回答已验证问题（确定性匹配），执行经 Data API
 * 受控路径；拒答显式呈现（无匹配/参数越界/无权限/下游不可用），真实构建
 * 不回退演示答案。反馈回写具体审计行。与演示页共用样式骨架。
 * 专业工作区在治理角色内附加问题治理区块（G27，{@link AssistantGovernance}）。
 */

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR = { healthy: 'success', warning: 'warning', danger: 'error', neutral: 'default' } as const

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/

function dataTimeRangeOf(answer: AssistantAnswer): string {
  const columns = answer.columns ?? []
  const rows = answer.rows ?? []
  const dateIndexes = columns
    .map((name, index) => (/date|日期/.test(name) ? index : -1))
    .filter((index) => index >= 0)
  const dates = rows
    .flatMap((row) => dateIndexes.map((index) => String(row[index] ?? '')))
    .filter((value) => DATE_LIKE.test(value))
    .sort()
  if (dates.length === 0) return ''
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`
}

function paramLabel(question: AssistantQuestionView | null): string {
  if (!question) return '未选择问题'
  return question.serviceCode
}

export function AssistantLive({ onNotice, professional = false, governance = false }: { onNotice: (message: string) => void; professional?: boolean; governance?: boolean }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [questions, setQuestions] = useState<AssistantQuestionView[]>([])
  const questionsState = useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchAssistantQuestions(signal),
    onData: setQuestions,
    onUnavailable: () => setQuestions([]),
  })

  const [selectedCode, setSelectedCode] = useState('')
  const [params, setParams] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [displayQuestion, setDisplayQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [feedbackState, setFeedbackState] = useState<'idle' | 'recording' | 'recorded'>('idle')
  const [asking, setAsking] = useState(false)

  const selected = useMemo(
    () => questions.find((question) => question.code === selectedCode) ?? null,
    [questions, selectedCode])
  const dataTimeRange = answer?.answered ? dataTimeRangeOf(answer) : ''

  function selectQuestion(question: AssistantQuestionView) {
    setSelectedCode(question.code)
    setParams({})
    setDraft(question.question)
    setAnswer(null)
    setFeedbackState('idle')
  }

  async function ask(text: string, parameters: Record<string, string>) {
    setAsking(true)
    try {
      const result = await askAssistantQuery(text, parameters)
      setAnswer(result)
      setFeedbackState('idle')
      if (!result.answered) {
        onNotice(REFUSAL_LABEL[result.outcome ?? ''] ?? '问数已拒答')
      }
    } catch (error) {
      onNotice(error instanceof Error && error.message ? error.message : '问数提问失败')
    } finally {
      setAsking(false)
    }
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || asking) return
    setDisplayQuestion(text)
    void ask(text, params)
  }

  async function sendFeedback(rating: 'helpful' | 'not_helpful') {
    if (!answer?.auditId || feedbackState !== 'idle') return
    setFeedbackState('recording')
    try {
      await submitAssistantFeedback(answer.auditId, rating)
      setFeedbackState('recorded')
      onNotice(`反馈已记录到审计 ${answer.auditId.slice(0, 8)}`)
    } catch (error) {
      setFeedbackState('idle')
      onNotice(error instanceof Error && error.message ? error.message : '反馈提交失败')
    }
  }

  if (questionsState === 'unavailable' && questions.length === 0) {
    return (
      <div className={styles.integrationPage}>
        <PageHeader
          title={professional ? '专业问数工作区' : '智能问数'}
          eyebrow={professional ? '受控只读分析 · 专业模式' : '受控只读分析'}
          subtitle="已验证问题 · 受控执行 · 可复核证据" compact
        />
        <section className={styles.evidenceSection} role="status">
          <h3>问数服务暂不可用</h3>
          <p>控制面问数接口不可达；本页不显示演示回退。</p>
          <Button onClick={() => setReloadKey((key) => key + 1)}>重试</Button>
        </section>
      </div>
    )
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader
        title={professional ? '专业问数工作区' : '智能问数'}
        eyebrow={professional ? '受控只读分析 · 专业模式' : '受控只读分析'}
        subtitle={professional
          ? '面向数据分析人员：已验证问题 · 受控执行 · 查询证据可复核。'
          : '只回答已验证问题；回答附服务版本、统计窗口与审计号。'}
        compact
      />
      <div className={styles.assistantWorkspace}>
        <aside className={styles.conversationRail} aria-label="支持的问题">
          <div className={styles.railHeader}><h2>已验证问题</h2><span className={styles.railCount}>{questions.length}</span></div>
          {questionsState === 'loading' && questions.length === 0 ? <p className={localStyles.railNote}>正在加载问题清单…</p> : null}
          <ul className={styles.conversationList}>
            {questions.map((question) => (
              <li key={question.code}>
                <button
                  className={`${styles.conversationItem} ${question.code === selectedCode ? styles.conversationItemSelected : ''}`}
                  onClick={() => selectQuestion(question)}
                  aria-pressed={question.code === selectedCode}
                >
                  <strong>{question.question}</strong><span>{paramLabel(question)}</span>
                </button>
              </li>
            ))}
          </ul>
          {questions.length === 0 && questionsState !== 'loading'
            ? <p className={localStyles.railNote}>当前租户暂无已发布的已验证问题。</p> : null}
          <section className={styles.promptGroup}>
            <h3>口径说明</h3>
            <ul className={styles.promptList}>
              <li className={localStyles.promptNote}>同义表达命中同一问题代码；未知问题明确拒答，不生成任意 SQL。</li>
            </ul>
          </section>
        </aside>

        <section className={styles.chatMain} aria-label="智能问数对话">
          <header className={styles.chatHeader}>
            <div className={styles.chatIdentity}>
              <span className={styles.chatIdentityIcon}><MessageSquareText size={17} /></span>
              <div><strong>医疗运营问数助手</strong><span>已验证问题 → 已发布数据服务</span></div>
            </div>
            <Tag color={TONE_COLOR.healthy}>只读模式</Tag>
          </header>

          {selected && (selected.paramSchema ?? []).length > 0 ? (
            <Form
              className={styles.assistantParamBar}
              aria-label="问题参数"
              onFinish={() => { if (draft.trim()) { setDisplayQuestion(draft.trim()); void ask(draft.trim(), params) } }}
            >
              {selected.paramSchema.map((contract) => (
                <Form.Item key={contract.name} className={styles.assistantParamField}
                  label={<>{contract.name}{contract.required ? ' *' : ''}</>}>
                  {contract.type === 'date'
                    ? <DatePicker value={params[contract.name] ? dayjs(params[contract.name]) : null}
                        onChange={(date) => setParams({ ...params, [contract.name]: date ? date.format('YYYY-MM-DD') : '' })} />
                    : contract.type === 'boolean'
                      ? <Select value={params[contract.name] ?? ''}
                          onChange={(value) => setParams({ ...params, [contract.name]: value })}
                          options={[{ value: '', label: '未指定' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
                      : (contract.values ?? []).length > 0
                        ? <Select value={params[contract.name] ?? ''}
                            onChange={(value) => setParams({ ...params, [contract.name]: value })}
                            options={[{ value: '', label: '请选择' }, ...(contract.values ?? []).map((value) => ({ value, label: value }))]} />
                        : <Input type={contract.type === 'number' ? 'number' : 'text'} value={params[contract.name] ?? ''}
                            placeholder={contract.description ?? contract.name}
                            onChange={(event) => setParams({ ...params, [contract.name]: event.target.value })} />}
                </Form.Item>
              ))}
              <Form.Item className={styles.assistantParamField}>
                <Button type="primary" htmlType="submit" disabled={asking || !draft.trim()}>
                  {asking ? '查询中…' : '按参数执行'}
                </Button>
              </Form.Item>
            </Form>
          ) : null}

          <div className={styles.chatScroll} aria-live="polite">
            {displayQuestion ? (
              <div className={styles.userBubbleRow}><div className={styles.userBubble}>{displayQuestion}</div></div>
            ) : (
              <p className={styles.composerNote}>从左侧选择一个已验证问题（可改参数），或直接在下方输入问题原文/别名。</p>
            )}

            {answer && !answer.answered ? (
              <article className={styles.assistantAnswer}>
                <header className={styles.answerHeader}>
                  <div className={styles.answerIdentity}>
                    <span className={styles.chatIdentityIcon}><Ban size={16} /></span>
                    <div><strong>拒答</strong><span>{REFUSAL_LABEL[answer.outcome ?? ''] ?? answer.outcome}</span></div>
                  </div>
                </header>
                <div className={styles.answerCopy}>
                  <p>{answer.reason}</p>
                  {(answer.supportedQuestions ?? []).length > 0 ? (
                    <div className={styles.finding}>
                      <Ban size={15} />
                      <span><strong>可问清单：</strong>{(answer.supportedQuestions ?? []).join('；')}</span>
                    </div>
                  ) : null}
                </div>
              </article>
            ) : null}

            {answer && answer.answered ? (
              <article className={styles.assistantAnswer}>
                <header className={styles.answerHeader}>
                  <div className={styles.answerIdentity}>
                    <span className={styles.chatIdentityIcon}><MessageSquareText size={16} /></span>
                    <div><strong>分析结果</strong><span>{answer.evidence?.serviceCode} {answer.evidence?.serviceVersion} · 受控执行</span></div>
                  </div>
                  <div className={styles.answerActions}>
                    <button className={styles.iconButton} onClick={() => void sendFeedback('helpful')}
                      disabled={feedbackState !== 'idle'} aria-label="回答有帮助"><ThumbsUp size={15} /></button>
                    <button className={styles.iconButton} onClick={() => void sendFeedback('not_helpful')}
                      disabled={feedbackState !== 'idle'} aria-label="回答需要改进"><ThumbsDown size={15} /></button>
                  </div>
                </header>
                <div className={styles.answerCopy}>
                  <p>{answer.answer}</p>
                  {answer.truncated ? (
                    <div className={styles.finding}><Ban size={15} /><span><strong>结果截断：</strong>已按服务行数上限返回 {answer.rowCount} 行。</span></div>
                  ) : null}
                  {feedbackState === 'recorded' ? <p className={styles.composerNote}>反馈已记录（审计 {answer.auditId.slice(0, 8)}…）。</p> : null}
                </div>
                <div className={styles.answerGrid}>
                  <section className={styles.answerPanel}>
                    <h3>核对明细</h3>
                    <div className={styles.horizontalScroll}>
                      <Table
                        rowKey={(_, index) => index ?? 0}
                        columns={(answer.columns ?? []).map((column, index) => ({
                          title: column,
                          key: column,
                          render: (_: unknown, row: unknown[]) => String(row[index] ?? ''),
                        })) as ColumnsType<unknown[]>}
                        dataSource={answer.rows ?? []}
                        pagination={false}
                        size="small"
                      />
                    </div>
                  </section>
                </div>
              </article>
            ) : null}
          </div>

          <form className={styles.composer} onSubmit={submitQuestion}>
            <div className={styles.composerBox}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)}
                placeholder="输入问题原文或别名，例如：每日处方量趋势" aria-label="输入问数问题" rows={1} />
              <button className={styles.sendButton} type="submit" disabled={!draft.trim() || asking} aria-label="发送问题"><Send size={17} /></button>
            </div>
            <p className={styles.composerNote}>回答来自已发布数据服务的受限执行；重要结论请结合口径与数据时间复核。</p>
          </form>
        </section>

        <aside className={styles.evidenceRail} aria-label="问数证据">
          <div className={styles.evidenceHeader}><h2>回答证据</h2><Tag color={answer ? TONE_COLOR.healthy : TONE_COLOR.neutral}>{answer ? '可复核' : '待提问'}</Tag></div>
          <div className={styles.evidenceBody}>
            <div className={styles.evidenceStamp}>
              <span className={styles.evidenceStampIcon}><MessageSquareText size={17} /></span>
              <div><strong>问数审计号</strong><span>{answer ? answer.auditId.slice(0, 13) + '…' : '提问后生成'}</span></div>
            </div>
            <dl className={styles.evidenceDefinition}>
              <div><dt>数据服务</dt><dd>{answer?.evidence ? `${answer.evidence.serviceCode} ${answer.evidence.serviceVersion}` : '—'}</dd></div>
              <div><dt>统计窗口</dt><dd>{answer?.evidence ? Object.entries(answer.evidence.statisticsWindow).map(([key, value]) => `${key}=${String(value)}`).join(' · ') || '—' : '—'}</dd></div>
              <div><dt>数据时间</dt><dd>{dataTimeRange || '—'}</dd></div>
              <div><dt>行数 / 截断</dt><dd>{answer?.evidence ? `${answer.evidence.rowCount} 行${answer.evidence.truncated ? ' · 已截断' : ''}` : '—'}</dd></div>
              <div><dt>耗时</dt><dd>{answer?.evidence ? `${answer.evidence.elapsedMs} ms` : '—'}</dd></div>
              <div><dt>执行路径</dt><dd>{answer?.evidence?.executionPath ?? '—'}</dd></div>
            </dl>
            <div className={styles.safeBoundary}><ShieldCheck size={15} /><span>查询由受控服务执行；助手不能修改标准、质量规则、主数据或源系统。</span></div>
          </div>
        </aside>
      </div>
      {professional && governance ? (
        <AssistantGovernance onNotice={onNotice} onQuestionsChanged={() => setReloadKey((key) => key + 1)} />
      ) : null}
    </div>
  )
}

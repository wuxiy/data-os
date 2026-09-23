import { FlaskConical, Pencil, Play, Plus, ShieldQuestion, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Drawer } from '../components/ui/Drawer'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  assistantQuestionAction,
  deleteAssistantQuestion,
  fetchAssistantAdminQuestions,
  fetchAssistantQuestionEvents,
  QUESTION_STATUS_LABEL,
  saveAssistantQuestion,
  testAssistantQuestion,
  type AssistantAdminQuestionView,
  type AssistantAnswer,
  type AssistantParamContract,
  type AssistantQuestionDraft,
  type AssistantQuestionEventView,
} from '../data/assistantApi'
import { useApiResource } from '../hooks/useApiResource'
import pageStyles from './Pages.module.css'
import styles from './IntegrationPages.module.css'

/**
 * 问数治理面（G27）：已验证问题生命周期管理——草稿建/改、试运行（发布前
 * 验证配置）、发布（须最近成功试运行晚于最后编辑）、停用、重新起草与草稿
 * 删除。动作全部走控制面治理接口并留事件痕；试运行结果与拒答信封同构。
 */

type ParamRow = AssistantParamContract & { required: boolean }

const EMPTY_FORM = {
  code: '',
  question: '',
  aliasesText: '',
  serviceCode: '',
  answerTemplate: '',
  paramRows: [] as ParamRow[],
}

function paramRowsOf(question: AssistantAdminQuestionView): ParamRow[] {
  return (question.paramSchema ?? []).map((contract) => ({
    ...contract,
    required: contract.required ?? false,
  }))
}

export function AssistantGovernance({ onNotice, onQuestionsChanged }: {
  onNotice: (message: string) => void
  onQuestionsChanged: () => void
}) {
  const [refreshTick, setRefreshTick] = useState(0)
  const [questions, setQuestions] = useState<AssistantAdminQuestionView[]>([])
  const governanceState = useApiResource({
    reloadKey: refreshTick,
    load: (signal) => fetchAssistantAdminQuestions(signal),
    onData: setQuestions,
    onUnavailable: () => setQuestions([]),
  })

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingCode, setEditingCode] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [testTarget, setTestTarget] = useState<AssistantAdminQuestionView | null>(null)
  const [testParams, setTestParams] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<AssistantAnswer | null>(null)
  const [testing, setTesting] = useState(false)

  const [eventsTarget, setEventsTarget] = useState<AssistantAdminQuestionView | null>(null)
  const [events, setEvents] = useState<AssistantQuestionEventView[] | null>(null)

  // 停用/删除是不可逆治理动作：两步确认，与数据服务下线同型。
  const [confirmKey, setConfirmKey] = useState('')
  const [pending, setPending] = useState('')

  function refresh() {
    setRefreshTick((tick) => tick + 1)
    onQuestionsChanged()
  }

  function openCreate() {
    setEditingCode('')
    setForm(EMPTY_FORM)
    setEditorOpen(true)
  }

  function openEdit(question: AssistantAdminQuestionView) {
    setEditingCode(question.code)
    setForm({
      code: question.code,
      question: question.question,
      aliasesText: question.aliases.join('\n'),
      serviceCode: question.serviceCode,
      answerTemplate: question.answerTemplate,
      paramRows: paramRowsOf(question),
    })
    setEditorOpen(true)
  }

  function draftOf(): AssistantQuestionDraft {
    return {
      code: form.code.trim(),
      question: form.question.trim(),
      aliases: form.aliasesText.split('\n').map((line) => line.trim()).filter(Boolean),
      paramSchema: form.paramRows
        .filter((row) => row.name.trim())
        .map(({ name, type, required, ...rest }) => ({ name: name.trim(), type, required, ...rest })),
      serviceCode: form.serviceCode.trim(),
      answerTemplate: form.answerTemplate,
    }
  }

  async function submitDraft(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const saved = await saveAssistantQuestion(draftOf(), editingCode || undefined)
      setEditorOpen(false)
      onNotice(`问题 ${saved.code} 已保存（${QUESTION_STATUS_LABEL[saved.status] ?? saved.status}）`)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error && error.message ? error.message : '问题保存失败')
    } finally {
      setSaving(false)
    }
  }

  function openTest(question: AssistantAdminQuestionView) {
    setTestTarget(question)
    setTestParams({})
    setTestResult(null)
  }

  async function runTest() {
    if (!testTarget || testing) return
    setTesting(true)
    try {
      const result = await testAssistantQuestion(testTarget.code, testParams)
      setTestResult(result)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error && error.message ? error.message : '试运行失败')
    } finally {
      setTesting(false)
    }
  }

  async function runAction(question: AssistantAdminQuestionView, action: 'publish' | 'deprecate' | 'reopen' | 'delete', successMessage: string) {
    const key = `${action}:${question.code}`
    if (pending) return
    setPending(key)
    try {
      if (action === 'delete') {
        await deleteAssistantQuestion(question.code)
      } else {
        await assistantQuestionAction(question.code, action)
      }
      setConfirmKey('')
      onNotice(successMessage)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error && error.message ? error.message : '问题状态变更失败')
    } finally {
      setPending('')
    }
  }

  async function openEvents(question: AssistantAdminQuestionView) {
    setEventsTarget(question)
    setEvents(null)
    try {
      setEvents(await fetchAssistantQuestionEvents(question.code, undefined))
    } catch {
      setEvents([])
    }
  }

  function twoStep(action: 'deprecate' | 'delete', question: AssistantAdminQuestionView, label: string) {
    const key = `${action}:${question.code}`
    if (confirmKey === key) {
      void runAction(question, action, `${question.code} 已${label}`)
    } else {
      setConfirmKey(key)
    }
  }

  return (
    <section className={styles.evidenceSection} aria-label="问数问题治理">
      <div className={styles.evidenceHeader}>
        <h2>问题治理</h2>
        <div className={styles.toolbarActions}>
          <Button onClick={() => setRefreshTick((tick) => tick + 1)}>刷新</Button>
          <Button variant="primary" onClick={openCreate}><Plus size={14} />新建问题（草稿）</Button>
        </div>
      </div>
      <p className={styles.composerNote}>
        发布须最近一次成功试运行晚于最后一次编辑（配置验证过才可上线）；停用问题从问数面消失并可重新起草。
      </p>
      {governanceState === 'unavailable' && questions.length === 0 ? (
        <p className={styles.composerNote}>治理清单暂不可达（接口不可用或当前角色无治理权限）。</p>
      ) : null}
      <div className={styles.horizontalScroll}>
        <table className={styles.resultTable}>
          <thead>
            <tr><th>问题 / 代码</th><th>状态</th><th>数据服务</th><th>试运行验证</th><th>操作</th></tr>
          </thead>
          <tbody>
            {questions.map((question) => {
              const key = `${'deprecate'}:${question.code}`
              const deleteKey = `delete:${question.code}`
              return (
                <tr key={question.code}>
                  <td>
                    <strong>{question.question}</strong>
                    <span className={styles.composerNote}>{question.code}</span>
                  </td>
                  <td><StatusTag tone={question.status === 'PUBLISHED' ? 'healthy' : question.status === 'DRAFT' ? 'neutral' : 'warning'}>
                    {QUESTION_STATUS_LABEL[question.status] ?? question.status}
                  </StatusTag></td>
                  <td>{question.serviceCode}</td>
                  <td>{question.verified
                    ? <span className={styles.assistantVerified}>已验证（试运行通过）</span>
                    : <span className={styles.composerNote}>未验证</span>}</td>
                  <td>
                    <div className={styles.assistantGovActions}>
                      {question.status === 'DRAFT' ? (
                        <>
                          <Button onClick={() => openEdit(question)}><Pencil size={13} />编辑</Button>
                          <Button onClick={() => openTest(question)}><FlaskConical size={13} />试运行</Button>
                          <Button
                            variant="primary"
                            disabled={!question.verified || pending === `publish:${question.code}`}
                            title={question.verified ? '发布到问数面' : '需最近一次成功试运行晚于最后编辑'}
                            onClick={() => void runAction(question, 'publish', `${question.code} 已发布`)}
                          >发布</Button>
                          <Button
                            variant={confirmKey === deleteKey ? 'danger' : 'secondary'}
                            disabled={pending === deleteKey}
                            onClick={() => twoStep('delete', question, '删除')}
                          >{confirmKey === deleteKey ? '确认删除' : '删除'}</Button>
                        </>
                      ) : null}
                      {question.status === 'PUBLISHED' ? (
                        <>
                          <Button onClick={() => openTest(question)}><FlaskConical size={13} />试运行</Button>
                          <Button
                            variant={confirmKey === key ? 'danger' : 'secondary'}
                            disabled={pending === key}
                            onClick={() => twoStep('deprecate', question, '停用')}
                          >{confirmKey === key ? '确认停用' : '停用'}</Button>
                        </>
                      ) : null}
                      {question.status === 'DEPRECATED' ? (
                        <Button
                          disabled={pending === `reopen:${question.code}`}
                          onClick={() => void runAction(question, 'reopen', `${question.code} 已重新起草（草稿）`)}
                        ><Play size={13} />重新起草</Button>
                      ) : null}
                      <Button onClick={() => void openEvents(question)}><ShieldQuestion size={13} />事件</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {questions.length === 0 && governanceState !== 'loading'
        ? <p className={styles.composerNote}>当前租户暂无已验证问题（含草稿）。</p> : null}

      {editorOpen ? (
        <Drawer
          titleId="assistant-question-editor-title"
          eyebrow="问数治理"
          title={editingCode ? `编辑问题 ${editingCode}` : '新建已验证问题（草稿）'}
          closeLabel="关闭问题编辑"
          onClose={() => setEditorOpen(false)}
          footer={<>
            <Button type="button" onClick={() => setEditorOpen(false)}>取消</Button>
            <button className={pageStyles.primaryButton} type="submit" form="assistant-question-form" disabled={saving}>
              {saving ? '保存中…' : '保存草稿'}
            </button>
          </>}
        >
          <form id="assistant-question-form" className={pageStyles.drawerForm} onSubmit={submitDraft}>
            <div className={pageStyles.drawerFormGrid}>
              <div className={pageStyles.formField}>
                <label htmlFor="assistant-question-code">问题代码</label>
                <input id="assistant-question-code" required pattern="[a-z0-9][a-z0-9-]{2,63}"
                  value={form.code} disabled={Boolean(editingCode)}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="如 prescription-daily-summary（创建后不可改）" />
              </div>
              <div className={pageStyles.formField}>
                <label htmlFor="assistant-question-service">数据服务代码</label>
                <input id="assistant-question-service" required pattern="[a-z0-9][a-z0-9-]{2,63}"
                  value={form.serviceCode}
                  onChange={(event) => setForm({ ...form, serviceCode: event.target.value })}
                  placeholder="已发布的数据服务（Data API registry）" />
              </div>
            </div>
            <div className={pageStyles.formField}>
              <label htmlFor="assistant-question-text">问题原文</label>
              <input id="assistant-question-text" required maxLength={256} value={form.question}
                onChange={(event) => setForm({ ...form, question: event.target.value })}
                placeholder="用户将以此原文或别名命中该问题" />
            </div>
            <div className={pageStyles.formField}>
              <label htmlFor="assistant-question-aliases">同义别名（每行一个）</label>
              <textarea id="assistant-question-aliases" rows={4} value={form.aliasesText}
                onChange={(event) => setForm({ ...form, aliasesText: event.target.value })}
                placeholder={'每日处方量趋势\n按天统计处方量'} />
            </div>
            <div className={pageStyles.formField}>
              <label>参数 Schema（与数据服务契约一致）</label>
              {form.paramRows.map((row, index) => (
                <div key={index} className={styles.assistantParamBar}>
                  <label className={styles.assistantParamField}>
                    <span>参数名</span>
                    <input value={row.name} pattern="[a-z_][a-z0-9_]{0,63}"
                      onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                  </label>
                  <label className={styles.assistantParamField}>
                    <span>类型</span>
                    <select value={row.type} onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) })}>
                      <option value="date">date</option>
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                  </label>
                  <label className={styles.assistantParamField}>
                    <span>必填</span>
                    <select value={row.required ? 'true' : 'false'}
                      onChange={(event) => setForm({ ...form, paramRows: form.paramRows.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.value === 'true' } : item) })}>
                      <option value="false">否</option>
                      <option value="true">是</option>
                    </select>
                  </label>
                  <Button type="button" aria-label={`移除参数 ${row.name || index + 1}`}
                    onClick={() => setForm({ ...form, paramRows: form.paramRows.filter((_, itemIndex) => itemIndex !== index) })}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
              <Button type="button"
                onClick={() => setForm({ ...form, paramRows: [...form.paramRows, { name: '', type: 'date', required: true }] })}>
                <Plus size={13} />添加参数
              </Button>
            </div>
            <div className={pageStyles.formField}>
              <label htmlFor="assistant-question-template">回答模板</label>
              <textarea id="assistant-question-template" rows={3} maxLength={512} value={form.answerTemplate}
                onChange={(event) => setForm({ ...form, answerTemplate: event.target.value })}
                placeholder="支持 {参数名} 与 {row_count}/{service_code}/{service_version}" />
            </div>
          </form>
        </Drawer>
      ) : null}

      {testTarget ? (
        <Drawer
          titleId="assistant-test-title"
          eyebrow="问数治理 · 发布前验证"
          title={`试运行 ${testTarget.code}`}
          closeLabel="关闭试运行"
          onClose={() => setTestTarget(null)}
          footer={<>
            <Button type="button" onClick={() => setTestTarget(null)}>关闭</Button>
            <button className={pageStyles.primaryButton} type="submit" form="assistant-test-form" disabled={testing}>
              {testing ? '执行中…' : '执行试运行'}
            </button>
          </>}
        >
          <form id="assistant-test-form" className={pageStyles.drawerForm} onSubmit={(event) => { event.preventDefault(); void runTest() }}>
            {paramRowsOf(testTarget).length === 0 ? (
              <p className={pageStyles.drawerNotice}>该问题无参数，直接执行。</p>
            ) : (
              <div className={styles.assistantParamBar}>
                {paramRowsOf(testTarget).map((contract) => (
                  <label key={contract.name} className={styles.assistantParamField}>
                    <span>{contract.name}{contract.required ? ' *' : ''}</span>
                    <input
                      type={contract.type === 'date' ? 'date' : contract.type === 'number' ? 'number' : 'text'}
                      value={testParams[contract.name] ?? ''} required={contract.required}
                      onChange={(event) => setTestParams({ ...testParams, [contract.name]: event.target.value })} />
                  </label>
                ))}
              </div>
            )}
          </form>
          {testResult ? (
            <div className={pageStyles.drawerForm}>
              {testResult.answered ? (
                <>
                  <p><strong>试运行通过：</strong>{testResult.answer}</p>
                  <div className={styles.horizontalScroll}>
                    <table className={styles.resultTable}>
                      <thead><tr>{(testResult.columns ?? []).map((column) => <th key={column}>{column}</th>)}</tr></thead>
                      <tbody>
                        {(testResult.rows ?? []).slice(0, 5).map((row, index) => (
                          <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell ?? '')}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.composerNote}>
                    共 {testResult.rowCount} 行 · {testResult.evidence?.elapsedMs} ms · 审计 {testResult.auditId.slice(0, 13)}…
                  </p>
                </>
              ) : (
                <>
                  <p><strong>试运行被拒：</strong>{testResult.reason}</p>
                  <p className={styles.composerNote}>outcome: {testResult.outcome} · 审计 {testResult.auditId.slice(0, 13)}…（拒答同样留痕）</p>
                </>
              )}
            </div>
          ) : null}
        </Drawer>
      ) : null}

      {eventsTarget ? (
        <Drawer
          titleId="assistant-events-title"
          eyebrow="问数治理 · 生命周期"
          title={`事件留痕 ${eventsTarget.code}`}
          closeLabel="关闭事件留痕"
          onClose={() => setEventsTarget(null)}
          footer={<Button type="button" onClick={() => setEventsTarget(null)}>关闭</Button>}
        >
          <ul className={styles.sourceList}>
            {(events ?? []).map((event, index) => (
              <li key={index}>
                <strong>{QUESTION_STATUS_LABEL[event.action] ?? event.action}</strong>
                <span>{event.actor || 'system'} · {new Date(event.createdAt).toLocaleString('zh-CN')}</span>
              </li>
            ))}
          </ul>
          {events && events.length === 0 ? <p className={styles.composerNote}>暂无事件记录。</p> : null}
        </Drawer>
      ) : null}
    </section>
  )
}

import { CircleAlert, LoaderCircle, RefreshCw, Search, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import { useKeyedResource } from '../hooks/useKeyedResource'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  fetchGovernanceIssue,
  fetchGovernanceIssues,
  confirmGovernanceIssueRunAbsent,
  remindGovernanceIssueOwner,
  reconcileGovernanceIssueRun,
  requestGovernanceIssueRecheck,
  syncGovernanceIssueRun,
  updateGovernanceIssueWorkflow,
  type GovernanceApiIssue,
  type GovernanceIssueDetailApiResponse,
} from '../data/controlPlane'
import {
  eventTitle,
  formatDateTime,
  isTerminalRun,
  issueStatusLabel,
  issueStatusTone,
  notificationStatusLabel,
  notificationStatusTone,
  runStatusLabel,
  runStatusTone,
  severityLabel,
  severityTone,
} from '../data/domain'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'

interface Props {
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

export function QualityIssuesPage({ onNavigate, onUnavailable, onNotice }: Props) {
  const [issues, setIssues] = useState<GovernanceApiIssue[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<GovernanceIssueDetailApiResponse | null>(null)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const { pendingKey: actionState, error: actionError, setError: setActionError, run: runAction } = useAction()

  const apiState = useApiResource({
    load: (signal) => fetchGovernanceIssues({ signal }),
    onData: (response) => {
      setIssues(response.items)
      setSelectedId((current) => current && response.items.some((issue) => issue.id === current) ? current : response.items[0]?.id ?? null)
    },
    onUnavailable: () => {
      setIssues([])
      setSelectedId(null)
      setDetail(null)
    },
  })

  // 键控从属加载：切换选中问题即中止重取；详情错误不塌列表页。
  const detailState = useKeyedResource({
    key: apiState === 'live' && selectedId ? selectedId : null,
    load: (signal) => fetchGovernanceIssue(selectedId as string, signal),
    onData: (response) => {
      setDetail(response)
      setNote(response.issue.processingNote ?? '')
    },
    onReset: () => {
      setDetail(null)
      setNote('')
    },
  })

  const visibleIssues = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return issues
    return issues.filter((issue) => `${issue.id}${issue.title}${issue.ownerDepartment}${issue.ownerName}${issue.datasetId}`.toLowerCase().includes(keyword))
  }, [issues, query])

  const selected = detail?.issue ?? issues.find((issue) => issue.id === selectedId) ?? null
  const canEdit = selected != null && selected.status !== 'CLOSED' && selected.status !== 'RECHECKING'
  const canRecheck = canEdit && selected?.status !== 'RECHECKING'

  function startRetest() {
    if (!selected) return
    void runAction('recheck', '复检请求失败，请稍后重试', async () => {
      const next = await requestGovernanceIssueRecheck(selected.id, '按原质量规则重新执行复检')
      applyDetail(next)
      const run = next.latestRun
      if (next.issue.status === 'RETURNED' || run?.status === 'SUBMIT_FAILED') {
        onNotice('复检投递失败，问题已退回，请检查执行器配置')
      } else if (run?.status === 'SUBMITTING') {
        onNotice('复检请求已登记，执行器暂不可用，将按策略自动重试')
      } else {
        onNotice('复检请求已投递，等待质量规则执行器回写结果')
      }
    })
  }

  function saveNote() {
    if (!selected || !note.trim()) return
    const status = selected.status === 'CLOSED' ? 'CLOSED' : 'IN_PROGRESS'
    void runAction('note', '处理说明保存失败，请稍后重试', async () => {
      const next = await updateGovernanceIssueWorkflow(selected.id, { status, note: note.trim() })
      applyDetail(next)
      onNotice('处理说明已保存，治理问题状态已回写')
    })
  }

  function syncRun() {
    if (!selected || !detail?.latestRun) return
    const latestRunId = detail.latestRun.id
    void runAction('sync', '质量复检结果同步失败，请稍后重试', async () => {
      const next = await syncGovernanceIssueRun(selected.id, latestRunId)
      applyDetail(next)
      onNotice(next.latestRun?.status === 'SUCCEEDED' ? (next.latestRun.passed ? '质量复检通过，问题已自动关闭' : '质量复检未通过，问题已退回') : '质量执行批次状态已同步')
    })
  }

  function reconcileRun() {
    if (!selected || !detail?.latestRun) return
    const latestRunId = detail.latestRun.id
    void runAction('reconcile', '质量执行批次重新对账失败，请稍后重试', async () => {
      const next = await reconcileGovernanceIssueRun(selected.id, latestRunId)
      applyDetail(next)
      onNotice('已重新查询质量执行器，状态已更新')
    })
  }

  function confirmRunAbsent() {
    if (!selected || !detail?.latestRun) return
    const latestRunId = detail.latestRun.id
    void runAction('confirm-absent', '确认质量执行批次不存在失败，请稍后重试', async () => {
      const next = await confirmGovernanceIssueRunAbsent(selected.id, latestRunId)
      applyDetail(next)
      onNotice('已确认外部质量执行批次不存在，问题已退回处理队列')
    })
  }

  function remindOwner() {
    if (!selected) return
    void runAction('notify', '责任人提醒请求失败，请稍后重试', async () => {
      const next = await remindGovernanceIssueOwner(selected.id)
      applyDetail(next)
      onNotice('责任人提醒已加入通知队列')
    })
  }

  function applyDetail(next: GovernanceIssueDetailApiResponse) {
    setDetail(next)
    setIssues((current) => current.map((issue) => issue.id === next.issue.id ? next.issue : issue))
    setNote(next.issue.processingNote ?? '')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="数据质量闭环" compact />
      <GovernanceTabs route="quality" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <div className={styles.apiStatus} role="status" aria-live="polite">
        <span className={`${styles.apiDot} ${apiState === 'live' ? styles.apiDotLive : ''}`} />
        {apiState === 'loading' ? '正在连接治理控制面…' : apiState === 'live' ? '控制面已连接 · 问题与处理记录来自 PostgreSQL' : '控制面暂不可用 · 未加载治理问题'}
      </div>
      {apiState === 'unavailable' ? <div className={styles.connectionNotice} role="alert"><CircleAlert size={17} /><div><strong>治理问题控制面不可用</strong><span>当前页面没有展示演示问题；请恢复控制面后重新加载。</span></div><button className={styles.secondaryButton} onClick={() => window.location.reload()}>重新连接</button></div> : null}
      <div className={styles.workspace}>
        <aside className={styles.workspaceRail}>
          <div className={styles.sectionTitle}><h2>问题队列</h2><span>{issues.filter((issue) => issue.status !== 'CLOSED').length} 待闭环</span></div>
          <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题或责任部门" aria-label="搜索质量问题" /></div>
          <ul className={styles.queue}>
            {visibleIssues.map((issue) => <li key={issue.id}><button className={selected?.id === issue.id ? styles.selected : ''} onClick={() => { setSelectedId(issue.id); setActionError(null) }}><span className={styles.queueTop}><span className={styles.queueId}>{issue.id}</span><StatusTag tone={severityTone(issue.severity)}>{severityLabel(issue.severity)}风险</StatusTag></span><span className={styles.queueTitle}>{issue.title}</span><span className={styles.queueMeta}>{issue.ownerDepartment} · {issue.ownerName} · {issueStatusLabel(issue.status)}</span></button></li>)}
            {apiState === 'loading' ? <li className={styles.emptyState}><LoaderCircle size={18} className={styles.spin} />正在加载治理问题…</li> : null}
            {apiState === 'live' && visibleIssues.length === 0 ? <li className={styles.emptyState}>当前范围暂无匹配的治理问题</li> : null}
          </ul>
        </aside>
        <section className={styles.workspaceMain}>
          {selected && detail ? <>
            <div className={styles.detailHero}>
              <StatusTag tone={issueStatusTone(selected.status)}>{issueStatusLabel(selected.status)}</StatusTag>
              <h2>{selected.title}</h2><p>{selected.id} · {selected.objectLabel || selected.datasetId}</p>
              <div className={styles.detailActions}><Button variant="primary" onClick={startRetest} disabled={!canRecheck || actionState !== null}>{actionState === 'recheck' ? '提交中…' : selected.status === 'RECHECKING' ? '复检中' : '开始复检'}</Button>{detail.latestRun && !isTerminalRun(detail.latestRun.status) ? <Button onClick={syncRun} disabled={actionState !== null}><RefreshCw size={14} className={actionState === 'sync' ? styles.spin : undefined} />{actionState === 'sync' ? '同步中…' : '同步复检结果'}</Button> : null}<Button onClick={remindOwner} disabled={actionState !== null || selected.status === 'CLOSED'}>{actionState === 'notify' ? '提醒中…' : selected.status === 'CLOSED' ? '问题已关闭' : '提醒责任人'}</Button></div>
            </div>
            <ol className={styles.timeline}>
              {detail.events.map((event) => <li key={event.id}><time>{formatDateTime(event.createdAt)}</time><div><strong>{eventTitle(event.eventType)}</strong><p>{event.note} · {event.actor}</p></div></li>)}
              {detail.events.length === 0 ? <li><time>{formatDateTime(selected.updatedAt)}</time><div><strong>问题已登记</strong><p>问题来自质量规则目录，等待责任人处理。</p></div></li> : null}
            </ol>
          </> : detailState === 'error' ? <div className={styles.connectionNotice} role="alert"><CircleAlert size={17} /><div><strong>治理问题详情不可用</strong><span>问题详情读取失败，请刷新后重试</span></div><button className={styles.secondaryButton} onClick={() => window.location.reload()}>重新读取</button></div> : <div className={styles.emptyState}>{apiState === 'loading' ? '正在读取问题详情…' : apiState === 'unavailable' ? '控制面恢复后可查看治理问题详情' : '请选择一个治理问题'}</div>}
        </section>
        <aside className={styles.workspaceInspector}>
          {selected && detail ? <>
            <div className={styles.sectionTitle}><h3>影响与证据</h3><StatusTag tone={severityTone(selected.severity)}>{severityLabel(selected.severity)}风险</StatusTag></div>
            <div className={styles.evidenceBox}><h3>影响范围</h3><p>{selected.impact}</p></div>
            <div className={styles.evidenceBox}><h3>规则证据</h3><p>{selected.ruleId}<br />最近更新：{formatDateTime(selected.updatedAt)}<br />规则结果来源：治理规则运行记录</p></div>
            <div className={styles.evidenceBox}>
              <h3>复检执行批次</h3>
              {detail.latestRun ? <>
                <p><StatusTag tone={runStatusTone(detail.latestRun.status)}>{runStatusLabel(detail.latestRun.status)}</StatusTag><br />执行器：{detail.latestRun.executor}<br />批次：<code className={styles.inlineCode}>{detail.latestRun.executionBatchId}</code><br />提交：{formatDateTime(detail.latestRun.submittedAt)}{detail.latestRun.finishedAt ? <><br />完成：{formatDateTime(detail.latestRun.finishedAt)}</> : null}</p>
                <p className={styles.evidenceMessage}>尝试 {detail.latestRun.attemptCount} 次{detail.latestRun.nextPollAt ? <> · 下次重试/轮询：{formatDateTime(detail.latestRun.nextPollAt)}</> : null}</p>
                {detail.latestRun.resultMessage ? <p className={styles.evidenceMessage}>{detail.latestRun.resultMessage}</p> : null}
                {detail.latestRun.lastError ? <p className={styles.formError}>最近错误：{detail.latestRun.lastError}</p> : null}
                {detail.latestRun.reconciliationStatus === 'MANUAL_REQUIRED' ? <div className={styles.connectionNotice} role="status"><CircleAlert size={17} /><div><strong>质量执行批次待人工对账</strong><span>{detail.latestRun.reconciliationMessage ?? '外部执行器未能可靠返回状态，请先重新查询；确认不存在后才允许结束本批次。'}</span></div><div className={styles.timelineActions}><button className={styles.secondaryButton} onClick={reconcileRun} disabled={actionState !== null}>{actionState === 'reconcile' ? '查询中…' : '重新查询'}</button><button className={styles.textButton} onClick={confirmRunAbsent} disabled={actionState !== null}>{actionState === 'confirm-absent' ? '确认中…' : '确认不存在'}</button></div></div> : null}
                {detail.latestRun.artifactUri ? <p className={styles.evidenceMessage}>制品地址：{isSafeArtifactLink(detail.latestRun.artifactUri) ? <a href={detail.latestRun.artifactUri} target="_blank" rel="noreferrer">打开复检制品</a> : <code className={styles.inlineCode}>{detail.latestRun.artifactUri}</code>}</p> : null}
                {detail.latestRun.sampleEvidence.length > 0 ? <div className={styles.sampleEvidence}><strong>样本证据（{detail.latestRun.sampleEvidence.length}）</strong>{detail.latestRun.sampleEvidence.map((item, index) => <pre key={`${detail.latestRun?.id}-${index}`}>{JSON.stringify(item, null, 2)}</pre>)}</div> : null}
                {detail.runs.length > 1 ? <div className={styles.runHistory}><strong>历史执行批次（{detail.runs.length}）</strong>{detail.runs.slice(1).map((run) => <div className={styles.runHistoryItem} key={run.id}><StatusTag tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusTag><span>{run.executionBatchId}</span><time>{formatDateTime(run.submittedAt)}</time><small>{run.sampleEvidence.length} 条证据</small></div>)}</div> : null}
              </> : <p>尚未提交质量规则复检。</p>}
            </div>
            <div className={styles.evidenceBox}><h3>责任人通知</h3>{detail.notifications.length > 0 ? detail.notifications.slice(0, 3).map((notification) => <p key={notification.id}><StatusTag tone={notificationStatusTone(notification.status)}>{notificationStatusLabel(notification.status)}</StatusTag> {notification.channel} · {notification.recipient}<br />{notification.subject}{notification.lastError ? <><br /><span className={styles.evidenceMessage}>{notification.lastError}</span></> : null}</p>) : <p>当前没有通知记录。</p>}</div>
            <div className={styles.evidenceBox}><h3>责任归属</h3><p>{selected.ownerDepartment} · {selected.ownerName}<br />来源：资产责任人与组织主数据</p></div>
            <div className={styles.noteBox}>
              <label htmlFor="processing-note">处理说明</label>
              <textarea id="processing-note" value={note} onChange={(event) => setNote(event.target.value)} disabled={!canEdit || actionState !== null} />
              {actionError ? <p className={styles.formError} role="alert">{actionError}</p> : null}
              <div className={styles.noteActions}><Button variant="primary" onClick={saveNote} disabled={!canEdit || !note.trim() || actionState !== null}><Send size={14} />{actionState === 'note' ? '保存中…' : '提交说明'}</Button></div>
            </div>
          </> : null}
        </aside>
      </div>
    </div>
  )
}


function isSafeArtifactLink(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

import { CircleAlert, LoaderCircle, RefreshCw, Search, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import { useKeyedResource } from '../hooks/useKeyedResource'
import { usePaged } from '../hooks/usePaged'
import { ConfirmDrawer } from '../components/ui/ConfirmDrawer'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { Pager } from '../components/ui/Pager'
import {
  confirmGovernanceIssueRunAbsent,
  fetchGovernanceIssue,
  fetchGovernanceIssues,
  reconcileGovernanceIssueRun,
  remindGovernanceIssueOwner,
  requestGovernanceIssueRecheck,
  syncGovernanceIssueRun,
  updateGovernanceIssueWorkflow,
} from '../data/controlPlane'
import {
  eventTitle,
  eventTone,
  executorLabel,
  executorOutputView,
  formatDateTime,
  isRecheckRetryEvent,
  isTerminalRun,
  issueStatusLabel,
  issueStatusTone,
  looksLikeExecutorOutput,
  notificationStatusLabel,
  notificationStatusTone,
  runStatusLabel,
  runStatusTone,
  shortBatchId,
  severityLabel,
  severityTone,
} from '../data/domain'
import type { GovernanceApiIssue, GovernanceIssueDetailApiResponse, GovernanceIssueEventApiItem } from '../data/controlPlane'
import type { RouteKey } from '../types'
import { QualityRulesAdmin } from './QualityRulesAdmin'
import styles from './Pages.module.css'

interface Props {
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

export function QualityIssuesPage({ onNavigate, onUnavailable, onNotice }: Props) {
  const [issues, setIssues] = useState<GovernanceApiIssue[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('issue') || null)

  // 深链回写（?issue=）：选中态进 URL，问题可收藏/分享（与资产页 ?asset= 同口径）。
  useEffect(() => {
    if (!selectedId) return
    const search = new URLSearchParams(window.location.search)
    if (search.get('issue') === selectedId) return
    search.set('issue', selectedId)
    window.history.replaceState({}, '', `${window.location.pathname}?${search.toString()}`)
  }, [selectedId])
  const [detail, setDetail] = useState<GovernanceIssueDetailApiResponse | null>(null)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const { pendingKey: actionState, error: actionError, setError: setActionError, run: runAction } = useAction()

  const apiState = useApiResource({
    load: (signal) => fetchGovernanceIssues({ signal }),
    onData: (response) => {
      setIssues(response.items)
      // 默认选中（2026-10-05 复评 P1-3）：优先第一条非 CLOSED（SLA 升序），
      // 访客落地即见可行动的问题；全部已关闭才回落第一项。
      setSelectedId((current) => {
        if (current && response.items.some((issue) => issue.id === current)) return current
        const open = response.items
          .filter((issue) => issue.status !== 'CLOSED')
          .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
        return open[0]?.id ?? response.items[0]?.id ?? null
      })
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
      // 历史数据里处理说明曾被执行器全文污染：指纹命中则不预填（P0-2），由折叠区呈现。
      setNote(looksLikeExecutorOutput(response.issue.processingNote) ? '' : (response.issue.processingNote ?? ''))
    },
    onReset: () => {
      setDetail(null)
      setNote('')
    },
  })

  // 队列状态筛选（2026-10-05 复评）：默认待闭环——与落地选中口径一致；
  // 批量提醒走确认抽屉，逐条投递、失败不阻断其余。
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [batchRemindOpen, setBatchRemindOpen] = useState(false)
  const openIssues = useMemo(() => issues.filter((issue) => issue.status !== 'CLOSED'), [issues])
  const visibleIssues = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const byStatus = issues.filter((issue) => statusFilter === 'all' || (statusFilter === 'open' ? issue.status !== 'CLOSED' : issue.status === 'CLOSED'))
    if (!keyword) return byStatus
    return byStatus.filter((issue) => `${issue.id}${issue.title}${issue.ownerDepartment}${issue.ownerName}${issue.datasetId}`.toLowerCase().includes(keyword))
  }, [issues, query, statusFilter])

  // 治理问题是长队列：侧栏分页，搜索重置回第一页。
  const QUEUE_PAGE_SIZE = 8
  const { page: queuePage, setPage: setQueuePage, paged: pagedIssues, pageCount: queuePageCount } = usePaged(visibleIssues, QUEUE_PAGE_SIZE)

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

  // 复检自动轮询（2026-10-05 复评）：执行器返回 nextPollAt 时到点自动同步，
  // 不再让用户人肉盯「同步复检结果」。护栏：同一运行最多自动同步 12 次；
  // 终态/切换问题/卸载由数据刷新与清理自然终止。
  const autoPollRef = useRef({ lastKey: '', runId: '', count: 0 })
  const autoPollRun = detail?.latestRun
  useEffect(() => {
    if (!autoPollRun || isTerminalRun(autoPollRun.status) || !autoPollRun.nextPollAt) return
    const key = `${autoPollRun.id}|${autoPollRun.nextPollAt}`
    const state = autoPollRef.current
    if (state.lastKey === key) return
    const due = new Date(autoPollRun.nextPollAt).getTime()
    if (Number.isNaN(due)) return
    if (state.runId !== autoPollRun.id) {
      state.runId = autoPollRun.id
      state.count = 0
    }
    if (state.count >= 12) return
    state.lastKey = key
    state.count += 1
    const timer = window.setTimeout(() => { void syncRun() }, Math.min(60000, Math.max(2000, due - Date.now())))
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncRun 闭包读取当帧 selected/detail，语义即当次轮询
  }, [autoPollRun?.id, autoPollRun?.status, autoPollRun?.nextPollAt])

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

  function runBatchRemind() {
    if (openIssues.length === 0) return
    void runAction('batch-notify', '批量提醒未能完成，请稍后重试', async () => {
      const failed: string[] = []
      let ok = 0
      for (const issue of openIssues) {
        try {
          await remindGovernanceIssueOwner(issue.id)
          ok += 1
        } catch {
          failed.push(issue.id)
        }
      }
      setBatchRemindOpen(false)
      onNotice(failed.length === 0
        ? `已向 ${ok} 个待闭环问题的责任人加入提醒队列`
        : `已提醒 ${ok} 个责任人，${failed.length} 个失败：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`)
    })
  }

  function applyDetail(next: GovernanceIssueDetailApiResponse) {
    setDetail(next)
    setIssues((current) => current.map((issue) => issue.id === next.issue.id ? next.issue : issue))
    setNote(looksLikeExecutorOutput(next.issue.processingNote) ? '' : (next.issue.processingNote ?? ''))
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
          <div className={styles.sectionTitle}><h2>问题队列</h2><span>{openIssues.length} 待闭环</span></div>
          <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setQueuePage(0) }} placeholder="搜索问题或责任部门" aria-label="搜索质量问题" /></div>
          <div className={styles.queueFilters} role="group" aria-label="队列状态筛选">
            {([['open', `待闭环 ${openIssues.length}`], ['closed', `已关闭 ${issues.length - openIssues.length}`], ['all', `全部 ${issues.length}`]] as const).map(([value, label]) => (
              <button key={value} className={styles.queueFilter} aria-pressed={statusFilter === value} onClick={() => { setStatusFilter(value); setQueuePage(0) }}>{label}</button>
            ))}
            {openIssues.length > 0 && apiState === 'live' ? <button className={styles.queueFilter} onClick={() => setBatchRemindOpen(true)}>批量提醒</button> : null}
          </div>
          <ul className={styles.queue}>
            {pagedIssues.map((issue) => <li key={issue.id}><button className={selected?.id === issue.id ? styles.selected : ''} aria-pressed={selected?.id === issue.id} onClick={() => { setSelectedId(issue.id); setActionError(null) }}><span className={styles.queueTop}><span className={styles.queueId}>{issue.id}</span><StatusTag tone={severityTone(issue.severity)}>{severityLabel(issue.severity)}风险</StatusTag></span><span className={styles.queueTitle}>{issue.title}</span><span className={styles.queueMeta}>{issue.ownerDepartment} · {issue.ownerName} · {issueStatusLabel(issue.status)}</span></button></li>)}
            {apiState === 'loading' ? <li className={styles.emptyState}><LoaderCircle size={18} className={styles.spin} />正在加载治理问题…</li> : null}
            {apiState === 'live' && visibleIssues.length === 0 ? <li className={styles.emptyState}>当前范围暂无匹配的治理问题</li> : null}
          </ul>
          <Pager label="问题队列分页" page={queuePage} pageCount={queuePageCount} pageSize={QUEUE_PAGE_SIZE} onPageChange={setQueuePage} />
        </aside>
        <section className={styles.workspaceMain}>
          {selected && detail ? <>
            <div className={styles.detailHero}>
              <StatusTag tone={issueStatusTone(selected.status)}>{issueStatusLabel(selected.status)}</StatusTag>
              <h2>{selected.title}</h2><p>{selected.id} · {selected.objectLabel || selected.datasetId}</p>
              <div className={styles.detailActions}><Button variant="primary" onClick={startRetest} disabled={!canRecheck || actionState !== null}>{actionState === 'recheck' ? '提交中…' : selected.status === 'RECHECKING' ? '复检中' : '开始复检'}</Button>{detail.latestRun && !isTerminalRun(detail.latestRun.status) ? <Button onClick={syncRun} disabled={actionState !== null}><RefreshCw size={14} className={actionState === 'sync' ? styles.spin : undefined} />{actionState === 'sync' ? '同步中…' : '同步复检结果'}</Button> : null}<Button onClick={remindOwner} disabled={actionState !== null || selected.status === 'CLOSED'}>{actionState === 'notify' ? '提醒中…' : selected.status === 'CLOSED' ? '问题已关闭' : '提醒责任人'}</Button>{selected.status === 'CLOSED' ? <span className={styles.closedHint}>问题已关闭，主操作停用；如需重新处理请从队列选择未闭环问题</span> : null}</div>
            </div>
            <ol className={styles.timeline}>
              {groupedTimeline(detail.events).map((group) => group.kind === 'retries' ? (
                /* 连续复检重试折叠（2026-10-05 复评 P2-4）：N 条等权事件收成一条可展开记录。 */
                <li key={group.events[0].id} data-tone="neutral">
                  <time>{(() => {
                    const span = [group.events[0].createdAt, group.events[group.events.length - 1].createdAt].sort()
                    return `${formatDateTime(span[0])}${span[0] !== span[1] ? ` – ${formatDateTime(span[1])}` : ''}`
                  })()}</time>
                  <div>
                    <strong>复检投递重试（共 {group.events.length} 条）</strong>
                    <details className={styles.executorLog}>
                      <summary>展开每次记录</summary>
                      {group.events.map((event) => <p key={event.id}>{formatDateTime(event.createdAt)} · {eventTitle(event.eventType)}{event.note ? ` · ${event.note}` : ''}</p>)}
                    </details>
                  </div>
                </li>
              ) : (
                <li key={group.event.id} data-tone={eventTone(group.event.eventType)}>
                  <time>{formatDateTime(group.event.createdAt)}</time>
                  <div><strong>{eventTitle(group.event.eventType)}</strong><p>{executorOutputView(group.event.note).folded ? <>{executorOutputView(group.event.note).head}…</> : group.event.note} · {group.event.actor}</p></div>
                </li>
              ))}
              {detail.events.length === 0 ? <li><time>{formatDateTime(selected.updatedAt)}</time><div><strong>问题已登记</strong><p>问题来自质量规则目录，等待责任人处理。</p></div></li> : null}
            </ol>
            {/* 处理说明随主列（2026-10-05 复评）：与开始复检/提醒责任人同一操作域，
                检辅栏只保留只读证据——两栏高度也随之平衡。 */}
            <div className={styles.noteBox}>
              <label htmlFor="processing-note">处理说明</label>
              {looksLikeExecutorOutput(selected.processingNote) ? <details className={styles.executorLog}><summary>历史执行器输出（仅参考，不作为处理结论）</summary><pre>{selected.processingNote}</pre></details> : null}
              <textarea id="processing-note" value={note} onChange={(event) => setNote(event.target.value)} disabled={!canEdit || actionState !== null} placeholder={canEdit ? '填写人工处理结论（处置动作、原因与复核口径）' : ''} />
              {actionError ? <p className={styles.formError} role="alert">{actionError}</p> : null}
              <div className={styles.noteActions}><Button variant="primary" onClick={saveNote} disabled={!canEdit || !note.trim() || actionState !== null}><Send size={14} />{actionState === 'note' ? '保存中…' : '提交说明'}</Button></div>
            </div>
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
                <p><StatusTag tone={runStatusTone(detail.latestRun.status)}>{runStatusLabel(detail.latestRun.status)}</StatusTag><br />执行器：{executorLabel(detail.latestRun.executor)}<br />批次：<code className={styles.inlineCode} title={detail.latestRun.executionBatchId}>{shortBatchId(detail.latestRun.executionBatchId)}</code><br />提交：{formatDateTime(detail.latestRun.submittedAt)}{detail.latestRun.finishedAt ? <><br />完成：{formatDateTime(detail.latestRun.finishedAt)}</> : null}</p>
                <p className={styles.evidenceMessage}>尝试 {detail.latestRun.attemptCount} 次{detail.latestRun.nextPollAt ? <> · {formatDateTime(detail.latestRun.nextPollAt)} 自动同步轮询结果（也可手动同步）</> : null}</p>
                {detail.latestRun.resultMessage ? (() => { const view = executorOutputView(detail.latestRun!.resultMessage!); return <p className={styles.evidenceMessage}>{view.head}{view.folded ? <>…<details className={styles.executorLog}><summary>查看完整执行输出</summary><pre>{view.folded}</pre></details></> : null}</p> })() : null}
                {detail.latestRun.lastError ? <p className={styles.formError}>最近错误：{detail.latestRun.lastError}</p> : null}
                {detail.latestRun.reconciliationStatus === 'MANUAL_REQUIRED' ? <div className={styles.connectionNotice} role="status"><CircleAlert size={17} /><div><strong>质量执行批次待人工对账</strong><span>{detail.latestRun.reconciliationMessage ?? '外部执行器未能可靠返回状态，请先重新查询；确认不存在后才允许结束本批次。'}</span></div><div className={styles.timelineActions}><button className={styles.secondaryButton} onClick={reconcileRun} disabled={actionState !== null}>{actionState === 'reconcile' ? '查询中…' : '重新查询'}</button><button className={styles.textButton} onClick={confirmRunAbsent} disabled={actionState !== null}>{actionState === 'confirm-absent' ? '确认中…' : '确认不存在'}</button></div></div> : null}
                {detail.latestRun.artifactUri ? <p className={styles.evidenceMessage}>制品地址：{isSafeArtifactLink(detail.latestRun.artifactUri) ? <a href={detail.latestRun.artifactUri} target="_blank" rel="noreferrer">打开复检制品</a> : <code className={styles.inlineCode}>{detail.latestRun.artifactUri}</code>}</p> : null}
                {detail.latestRun.sampleEvidence.length > 0 ? <div className={styles.sampleEvidence}><strong>样本证据（{detail.latestRun.sampleEvidence.length}）</strong>{detail.latestRun.sampleEvidence.map((item, index) => <pre key={`${detail.latestRun?.id}-${index}`}>{JSON.stringify(item, null, 2)}</pre>)}</div> : null}
                {detail.runs.length > 1 ? <div className={styles.runHistory}><strong>历史执行批次（{detail.runs.length}）</strong>{detail.runs.slice(1).map((run) => <div className={styles.runHistoryItem} key={run.id}><StatusTag tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusTag><span title={run.executionBatchId}>{shortBatchId(run.executionBatchId)}</span><time>{formatDateTime(run.submittedAt)}</time><small>{run.sampleEvidence.length} 条证据</small></div>)}</div> : null}
              </> : <p>尚未提交质量规则复检。</p>}
            </div>
            <div className={styles.evidenceBox}><h3>责任人通知</h3>{detail.notifications.length > 0 ? detail.notifications.slice(0, 3).map((notification) => <p key={notification.id}><StatusTag tone={notificationStatusTone(notification.status)}>{notificationStatusLabel(notification.status)}</StatusTag> {notification.channel} · {notification.recipient}<br />{notification.subject}{notification.lastError ? <><br /><span className={styles.evidenceMessage}>{notification.lastError}</span></> : null}</p>) : <p>当前没有通知记录。</p>}</div>
            <div className={styles.evidenceBox}><h3>责任归属</h3><p>{selected.ownerDepartment} · {selected.ownerName}<br />来源：资产责任人与组织主数据</p></div>
          </> : null}
        </aside>
      </div>
      <QualityRulesAdmin onNotice={onNotice} />
      {batchRemindOpen ? <ConfirmDrawer
        titleId="batch-remind-confirm-title"
        eyebrow="问题队列 · 批量提醒"
        title={`提醒 ${openIssues.length} 个待闭环问题的责任人`}
        confirmLabel={actionState === 'batch-notify' ? '提醒中…' : `确认提醒 ${openIssues.length} 位责任人`}
        busy={actionState !== null}
        onConfirm={runBatchRemind}
        onClose={() => setBatchRemindOpen(false)}
        body={<p>将按队列当前未闭环清单（{openIssues.length} 条）逐一向责任人投递提醒通知；单条失败不影响其余，已关闭问题不会被打扰。</p>}
      /> : null}
    </div>
  )
}


type TimelineEntry = { kind: 'single'; event: GovernanceIssueEventApiItem } | { kind: 'retries'; events: GovernanceIssueEventApiItem[] }

/** 时间线分组（2026-10-05 复评 P2-4）：相邻的复检投递/执行中间事件收为一组可展开记录，
 * 其余事件逐条呈现——重试墙不再以等权条目淹没关键节点。 */
function groupedTimeline(events: GovernanceIssueEventApiItem[]): TimelineEntry[] {
  const out: TimelineEntry[] = []
  let buffer: GovernanceIssueEventApiItem[] = []
  const flush = () => {
    if (buffer.length === 0) return
    if (buffer.length === 1) out.push({ kind: 'single', event: buffer[0] })
    else out.push({ kind: 'retries', events: buffer })
    buffer = []
  }
  for (const event of events) {
    if (isRecheckRetryEvent(event.eventType)) buffer.push(event)
    else {
      flush()
      out.push({ kind: 'single', event })
    }
  }
  flush()
  return out
}

function isSafeArtifactLink(value: string) {  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

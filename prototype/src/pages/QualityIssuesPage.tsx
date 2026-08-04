import { CircleAlert, LoaderCircle, Play, Search, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  fetchGovernanceIssue,
  fetchGovernanceIssues,
  requestGovernanceIssueRecheck,
  updateGovernanceIssueWorkflow,
  type GovernanceApiIssue,
  type GovernanceIssueDetailApiResponse,
} from '../data/controlPlane'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'

interface Props {
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

type ApiState = 'loading' | 'live' | 'unavailable'
type ActionState = 'note' | 'recheck' | null

export function QualityIssuesPage({ onNavigate, onUnavailable, onNotice }: Props) {
  const [apiState, setApiState] = useState<ApiState>('loading')
  const [issues, setIssues] = useState<GovernanceApiIssue[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<GovernanceIssueDetailApiResponse | null>(null)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [actionState, setActionState] = useState<ActionState>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setApiState('loading')
    fetchGovernanceIssues({ signal: controller.signal })
      .then((response) => {
        setIssues(response.items)
        setSelectedId((current) => current && response.items.some((issue) => issue.id === current) ? current : response.items[0]?.id ?? null)
        setApiState('live')
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIssues([])
          setSelectedId(null)
          setDetail(null)
          setApiState('unavailable')
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (apiState !== 'live' || !selectedId) {
      setDetail(null)
      return
    }
    const controller = new AbortController()
    setDetail(null)
    setDetailError(null)
    fetchGovernanceIssue(selectedId, controller.signal)
      .then((response) => {
        setDetail(response)
        setNote(response.issue.processingNote ?? '')
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailError('问题详情读取失败，请刷新后重试')
      })
    return () => controller.abort()
  }, [apiState, selectedId])

  const visibleIssues = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return issues
    return issues.filter((issue) => `${issue.id}${issue.title}${issue.ownerDepartment}${issue.ownerName}${issue.datasetId}`.toLowerCase().includes(keyword))
  }, [issues, query])

  const selected = detail?.issue ?? issues.find((issue) => issue.id === selectedId) ?? null
  const canEdit = selected != null && selected.status !== 'CLOSED'
  const canRecheck = canEdit && selected?.status !== 'RECHECKING'

  async function startRetest() {
    if (!selected || actionState) return
    setActionState('recheck')
    setActionError(null)
    try {
      const next = await requestGovernanceIssueRecheck(selected.id, '按原质量规则重新执行复检')
      applyDetail(next)
      onNotice('复检请求已记录，状态已回写为复检中')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '复检请求失败，请稍后重试')
    } finally {
      setActionState(null)
    }
  }

  async function saveNote() {
    if (!selected || actionState || !note.trim()) return
    setActionState('note')
    setActionError(null)
    const status = selected.status === 'CLOSED' ? 'CLOSED' : 'IN_PROGRESS'
    try {
      const next = await updateGovernanceIssueWorkflow(selected.id, { status, note: note.trim() })
      applyDetail(next)
      onNotice('处理说明已保存，治理问题状态已回写')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '处理说明保存失败，请稍后重试')
    } finally {
      setActionState(null)
    }
  }

  function applyDetail(next: GovernanceIssueDetailApiResponse) {
    setDetail(next)
    setIssues((current) => current.map((issue) => issue.id === next.issue.id ? next.issue : issue))
    setNote(next.issue.processingNote ?? '')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="数据质量闭环" compact onFilterNotice={onNotice} />
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
            {visibleIssues.map((issue) => <li key={issue.id}><button className={selected?.id === issue.id ? styles.selected : ''} onClick={() => { setSelectedId(issue.id); setActionError(null) }}><span className={styles.queueTop}><span className={styles.queueId}>{issue.id}</span><StatusTag tone={severityTone(issue.severity)}>{severityLabel(issue.severity)}风险</StatusTag></span><span className={styles.queueTitle}>{issue.title}</span><span className={styles.queueMeta}>{issue.ownerDepartment} · {issue.ownerName} · {issueStatus(issue.status)}</span></button></li>)}
            {apiState === 'loading' ? <li className={styles.emptyState}><LoaderCircle size={18} className={styles.spin} />正在加载治理问题…</li> : null}
            {apiState === 'live' && visibleIssues.length === 0 ? <li className={styles.emptyState}>当前范围暂无匹配的治理问题</li> : null}
          </ul>
        </aside>
        <section className={styles.workspaceMain}>
          {selected && detail ? <>
            <div className={styles.detailHero}>
              <StatusTag tone={statusTone(selected.status)}>{issueStatus(selected.status)}</StatusTag>
              <h2>{selected.title}</h2><p>{selected.id} · {selected.objectLabel || selected.datasetId}</p>
              <div className={styles.detailActions}><Button variant="primary" onClick={() => void startRetest()} disabled={!canRecheck || actionState !== null}>{actionState === 'recheck' ? '提交中…' : selected.status === 'RECHECKING' ? '复检中' : '开始复检'}</Button><Button onClick={() => onUnavailable('责任人提醒')}>提醒责任人</Button></div>
            </div>
            <ol className={styles.timeline}>
              {detail.events.map((event) => <li key={event.id}><time>{formatDateTime(event.createdAt)}</time><div><strong>{eventTitle(event.eventType)}</strong><p>{event.note} · {event.actor}</p></div></li>)}
              {detail.events.length === 0 ? <li><time>{formatDateTime(selected.updatedAt)}</time><div><strong>问题已登记</strong><p>问题来自质量规则目录，等待责任人处理。</p></div></li> : null}
            </ol>
          </> : detailError ? <div className={styles.connectionNotice} role="alert"><CircleAlert size={17} /><div><strong>治理问题详情不可用</strong><span>{detailError}</span></div><button className={styles.secondaryButton} onClick={() => window.location.reload()}>重新读取</button></div> : <div className={styles.emptyState}>{apiState === 'loading' ? '正在读取问题详情…' : apiState === 'unavailable' ? '控制面恢复后可查看治理问题详情' : '请选择一个治理问题'}</div>}
        </section>
        <aside className={styles.workspaceInspector}>
          {selected && detail ? <>
            <div className={styles.sectionTitle}><h3>影响与证据</h3><StatusTag tone={severityTone(selected.severity)}>{severityLabel(selected.severity)}风险</StatusTag></div>
            <div className={styles.evidenceBox}><h3>影响范围</h3><p>{selected.impact}</p></div>
            <div className={styles.evidenceBox}><h3>规则证据</h3><p>{selected.ruleId}<br />最近更新：{formatDateTime(selected.updatedAt)}<br />规则结果来源：治理规则运行记录</p></div>
            <div className={styles.evidenceBox}><h3>责任归属</h3><p>{selected.ownerDepartment} · {selected.ownerName}<br />来源：资产责任人与组织主数据</p></div>
            <div className={styles.noteBox}>
              <label htmlFor="processing-note">处理说明</label>
              <textarea id="processing-note" value={note} onChange={(event) => setNote(event.target.value)} disabled={!canEdit || actionState !== null} />
              {actionError ? <p className={styles.formError} role="alert">{actionError}</p> : null}
              <div className={styles.noteActions}><Button variant="primary" onClick={() => void saveNote()} disabled={!canEdit || !note.trim() || actionState !== null}><Send size={14} />{actionState === 'note' ? '保存中…' : '提交说明'}</Button></div>
            </div>
          </> : null}
        </aside>
      </div>
    </div>
  )
}

function severityLabel(value: string) {
  return ({ HIGH: '高', MEDIUM: '中', LOW: '低' } as Record<string, string>)[value] ?? value
}

function severityTone(value: string): 'danger' | 'warning' | 'neutral' {
  if (value === 'HIGH') return 'danger'
  if (value === 'MEDIUM') return 'warning'
  return 'neutral'
}

function statusTone(value: string): 'danger' | 'warning' | 'healthy' | 'neutral' {
  if (value === 'OVERDUE') return 'danger'
  if (value === 'RECHECKING' || value === 'IN_PROGRESS' || value === 'PENDING_RECHECK') return 'warning'
  if (value === 'CLOSED') return 'healthy'
  return 'neutral'
}

function issueStatus(value: string) {
  return ({ OVERDUE: '逾期', IN_PROGRESS: '处理中', PENDING: '待处理', PENDING_RECHECK: '待复检', RECHECKING: '复检中', CLOSED: '已关闭' } as Record<string, string>)[value] ?? value
}

function eventTitle(value: string) {
  return ({ WORKFLOW_UPDATED: '责任人提交处理说明', RECHECK_REQUESTED: '已发起质量规则复检' } as Record<string, string>)[value] ?? '治理问题状态更新'
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace('/', '-').replace('/', ' ')
}

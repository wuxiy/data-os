import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { AlertTriangle, CircleAlert, Plus, RefreshCw, Search, Send, Shield, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input, SearchField, NativeSelect } from '../../components/ui/input'
import { Breadcrumb, PageHeading } from '../../components/ui/page-heading'
import { Count, Panel, PanelHead, ScopeNote } from '../../components/ui/panel'
import { Confirm } from '../../components/ui/overlay'
import { EmptyState, LoadingBlock, LoadingInline, Skeleton } from '../../components/ui/states'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/ui/toast'
import {
  confirmGovernanceIssueRunAbsent,
  deleteQualityRule,
  reconcileGovernanceIssueRun,
  remindGovernanceIssueOwner,
  requestGovernanceIssueRecheck,
  setQualityRuleEnabled,
  syncGovernanceIssueRun,
  updateGovernanceIssueWorkflow,
  QUALITY_RULE_TYPE_LABELS,
  type GovernanceIssueEventApiItem,
  type GovernanceIssueDetailApiResponse,
  type GovernanceQualityRunApiItem,
  type QualityRuleDefinitionApiItem,
} from '../../data/controlPlane'
import {
  actorLabel,
  executorLabel,
  executorOutputView,
  eventTitle,
  eventTone,
  formatDateTime,
  formatInlineDateTimes,
  isRecheckRetryEvent,
  isTerminalRun,
  issueStatusLabel,
  issueStatusTone,
  looksLikeExecutorOutput,
  notificationStatusLabel,
  runStatusLabel,
  runStatusTone,
  severityLabel,
  severityTone,
  shortBatchId,
} from '../../data/domain'
import { workLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { governanceIssueQuery, governanceIssuesQuery, qualityRulesQuery } from './queries'
import { ResponsibilitySheet } from './responsibility-sheet'

const QUEUE_PAGE_SIZE = 8

type TimelineEntry = { kind: 'single'; event: GovernanceIssueEventApiItem } | { kind: 'retries'; events: GovernanceIssueEventApiItem[] }

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
    else { flush(); out.push({ kind: 'single', event }) }
  }
  flush()
  return out
}

function isSafeArtifactLink(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function toneBadge(tone: 'healthy' | 'warning' | 'danger' | 'neutral') {
  return tone === 'healthy' ? 'success' : tone === 'danger' ? 'danger' : tone === 'warning' ? 'warn' : 'neutral'
}

/**
 * 数据质量工作台（FE3）：问题队列 + 证据/责任链 + 处理记录常驻主从，
 * 规则台账在同一页面下方。抽屉只用于责任链这类只读核对，不承载处置。
 */
export function QualityPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const search = useSearch({ strict: false }) as { issue?: string }
  const selectedId = typeof search.issue === 'string' && search.issue ? search.issue : null

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [page, setPage] = useState(0)
  const [note, setNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [chainOpen, setChainOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<QualityRuleDefinitionApiItem | null>(null)

  const issuesRequest = useQuery(governanceIssuesQuery())
  const detailRequest = useQuery(governanceIssueQuery(selectedId))
  const rulesRequest = useQuery(qualityRulesQuery())

  const issues = issuesRequest.data?.items ?? []
  const detail = detailRequest.data ?? null

  // 默认选中：优先第一条非 CLOSED（SLA 升序），访客落地即见可行动问题。
  const effectiveId = selectedId ?? (() => {
    const open = issues.filter((issue) => issue.status !== 'CLOSED')
      .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
    return open[0]?.id ?? issues[0]?.id ?? null
  })()

  useEffect(() => {
    if (!selectedId && effectiveId) {
      void navigate(`/governance/quality?issue=${encodeURIComponent(effectiveId)}`, { replace: true })
    }
  }, [effectiveId, navigate, selectedId])

  // 详情落位后回填处理说明（历史执行器全文不预填，收进折叠区）。
  useEffect(() => {
    const issue = detail?.issue
    if (!issue) { setNote(''); return }
    setNote(looksLikeExecutorOutput(issue.processingNote) ? '' : (issue.processingNote ?? ''))
  }, [detail?.issue.id, detail?.issue.processingNote])

  // 自动轮询：执行器返回 nextPollAt 时到点同步，2–60 秒边界、同一运行最多 12 次。
  const autoPollRef = useRef({ lastKey: '', runId: '', count: 0 })
  const latestRun = detail?.latestRun ?? null

  const applyDetail = (next: GovernanceIssueDetailApiResponse) => {
    queryClient.setQueryData(['governance', 'issue', next.issue.id], next)
    void queryClient.invalidateQueries({ queryKey: ['governance', 'issues'] })
    setNote(looksLikeExecutorOutput(next.issue.processingNote) ? '' : (next.issue.processingNote ?? ''))
  }

  const syncMutation = useMutation({
    mutationFn: ({ issueId, runId }: { issueId: string; runId: string }) => syncGovernanceIssueRun(issueId, runId),
    onSuccess: (next) => {
      applyDetail(next)
      notify(next.latestRun?.status === 'SUCCEEDED'
        ? (next.latestRun.passed ? '质量复检通过，问题已自动关闭' : '质量复检未通过，问题已退回')
        : '质量执行批次状态已同步')
    },
    onError: (cause) => setActionError(cause instanceof Error ? cause.message : '质量复检结果同步失败，请稍后重试'),
  })

  useEffect(() => {
    if (!latestRun || isTerminalRun(latestRun.status) || !latestRun.nextPollAt) return
    const key = `${latestRun.id}|${latestRun.nextPollAt}`
    const state = autoPollRef.current
    if (state.lastKey === key) return
    const due = new Date(latestRun.nextPollAt).getTime()
    if (Number.isNaN(due)) return
    if (state.runId !== latestRun.id) { state.runId = latestRun.id; state.count = 0 }
    if (state.count >= 12) return
    state.lastKey = key
    state.count += 1
    const issueId = detail?.issue.id
    if (!issueId) return
    const timer = window.setTimeout(() => {
      syncMutation.mutate({ issueId, runId: latestRun.id })
    }, Math.min(60000, Math.max(2000, due - Date.now())))
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 轮询以运行键为触发源
  }, [latestRun?.id, latestRun?.status, latestRun?.nextPollAt])

  const recheckMutation = useMutation({
    mutationFn: (issueId: string) => requestGovernanceIssueRecheck(issueId, '按原质量规则重新执行复检'),
    onSuccess: (next) => {
      applyDetail(next)
      const run = next.latestRun
      notify(next.issue.status === 'RETURNED' || run?.status === 'SUBMIT_FAILED'
        ? '复检投递失败，问题已退回，请检查执行器配置'
        : run?.status === 'SUBMITTING'
          ? '复检请求已登记，执行器暂不可用，将按策略自动重试'
          : '复检请求已投递，等待质量规则执行器回写结果')
    },
    onError: (cause) => setActionError(cause instanceof Error ? cause.message : '复检请求失败，请稍后重试'),
  })

  const noteMutation = useMutation({
    mutationFn: ({ issueId, status, text }: { issueId: string; status: string; text: string }) => updateGovernanceIssueWorkflow(issueId, { status, note: text }),
    onSuccess: (next) => { applyDetail(next); notify('处理说明已保存，治理问题状态已回写') },
    onError: (cause) => setActionError(cause instanceof Error ? cause.message : '处理说明保存失败，请稍后重试'),
  })

  const remindMutation = useMutation({
    mutationFn: (issueId: string) => remindGovernanceIssueOwner(issueId),
    onSuccess: (next) => { applyDetail(next); notify('责任人提醒已加入通知队列') },
    onError: (cause) => setActionError(cause instanceof Error ? cause.message : '责任人提醒请求失败，请稍后重试'),
  })

  const reconcileMutation = useMutation({
    mutationFn: ({ issueId, runId }: { issueId: string; runId: string }) => reconcileGovernanceIssueRun(issueId, runId),
    onSuccess: (next) => { applyDetail(next); notify('已重新查询质量执行器，状态已更新') },
    onError: (cause) => setActionError(cause instanceof Error ? cause.message : '质量执行批次重新对账失败，请稍后重试'),
  })

  const confirmAbsentMutation = useMutation({
    mutationFn: ({ issueId, runId }: { issueId: string; runId: string }) => confirmGovernanceIssueRunAbsent(issueId, runId),
    onSuccess: (next) => { applyDetail(next); notify('已确认外部质量执行批次不存在，问题已退回处理队列') },
    onError: (cause) => setActionError(cause instanceof Error ? cause.message : '确认质量执行批次不存在失败，请稍后重试'),
  })

  const batchRemindMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const failed: string[] = []
      let ok = 0
      for (const id of ids) {
        try { await remindGovernanceIssueOwner(id); ok += 1 } catch { failed.push(id) }
      }
      return { ok, failed }
    },
    onSuccess: ({ ok, failed }) => {
      setBatchOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['governance', 'issues'] })
      notify(failed.length === 0
        ? `已向 ${ok} 个待闭环问题的责任人加入提醒队列`
        : `已提醒 ${ok} 个责任人，${failed.length} 个失败：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`)
    },
    onError: (cause) => {
      setBatchOpen(false)
      notify(cause instanceof Error ? cause.message : '批量提醒未能完成，请稍后重试')
    },
  })

  const ruleToggle = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) => setQualityRuleEnabled(ruleId, enabled),
    onSuccess: (rule) => {
      void queryClient.invalidateQueries({ queryKey: ['governance', 'rules'] })
      notify(`规则已${rule.enabled ? '启用' : '停用'}：${rule.ruleId}`)
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '规则状态更新失败'),
  })

  const ruleDelete = useMutation({
    mutationFn: (ruleId: string) => deleteQualityRule(ruleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['governance', 'rules'] })
      setPendingDelete(null)
      notify('规则已删除，并从质量执行器同步摘除')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '规则删除失败'),
  })

  const openIssues = useMemo(() => issues.filter((issue) => issue.status !== 'CLOSED'), [issues])
  const visibleIssues = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    const byStatus = issues.filter((issue) => statusFilter === 'all' || (statusFilter === 'open' ? issue.status !== 'CLOSED' : issue.status === 'CLOSED'))
    if (!text) return byStatus
    return byStatus.filter((issue) => `${issue.id}${issue.title}${issue.ownerDepartment}${issue.ownerName}${issue.datasetId}`.toLowerCase().includes(text))
  }, [issues, keyword, statusFilter])
  const pageCount = Math.max(1, Math.ceil(visibleIssues.length / QUEUE_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pagedIssues = visibleIssues.slice(currentPage * QUEUE_PAGE_SIZE, (currentPage + 1) * QUEUE_PAGE_SIZE)

  const selected = detail?.issue ?? issues.find((issue) => issue.id === effectiveId) ?? null
  const canEdit = selected != null && selected.status !== 'CLOSED' && selected.status !== 'RECHECKING'
  const canRecheck = canEdit
  const busy = syncMutation.isPending || recheckMutation.isPending || noteMutation.isPending || remindMutation.isPending || reconcileMutation.isPending || confirmAbsentMutation.isPending

  function select(id: string) {
    setActionError(null)
    void navigate(`/governance/quality?issue=${encodeURIComponent(id)}`)
  }

  const ruleHelper = listColumnHelper<QualityRuleDefinitionApiItem>()
  const ruleColumns = ruleHelper.columns([
    ruleHelper.display({
      id: 'rule',
      header: '规则',
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-label text-[#313c4d]">{row.original.ruleId}</div>
          <div className="mt-0.5 text-meta text-[#707c8c]">{QUALITY_RULE_TYPE_LABELS[row.original.ruleType] ?? row.original.ruleType}{row.original.targetColumn ? ` · ${row.original.targetColumn}` : ''}</div>
        </div>
      ),
    }),
    ruleHelper.accessor('datasetId', { header: '数据集' }),
    ruleHelper.display({
      id: 'enabled',
      header: '状态',
      size: 90,
      cell: ({ row }) => <Badge tone={row.original.enabled ? 'success' : 'neutral'}>{row.original.enabled ? '启用' : '停用'}</Badge>,
    }),
    ruleHelper.display({ id: 'updated', header: '更新', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.updatedAt)}</span> }),
    ruleHelper.display({
      id: 'actions',
      header: '操作',
      size: 210,
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5" onClick={(event) => event.stopPropagation()}>
          <Button variant="text" onClick={() => navigate(workLinks.qualityRuleEdit(row.original.ruleId))}>编辑</Button>
          <Button variant="text" disabled={ruleToggle.isPending} onClick={() => ruleToggle.mutate({ ruleId: row.original.ruleId, enabled: !row.original.enabled })}>
            {row.original.enabled ? '停用' : '启用'}
          </Button>
          <Button variant="text" className="text-[#b44848]" onClick={() => setPendingDelete(row.original)}><Trash2 size={12} />删除</Button>
        </div>
      ),
    }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '数据治理' }, { label: '数据质量' }]} trailing={issuesRequest.data ? <span>{openIssues.length} 项待闭环</span> : null} />
      <PageHeading
        title="数据质量"
        description="定位质量问题，沿证据与责任链推进闭环。"
        actions={
          <>
            <Button onClick={() => navigate('/governance/quality/scoring')}>评分标准</Button>
            <Button variant="primary" onClick={() => navigate(workLinks.qualityRuleNew())}><Plus size={14} />新建质量规则</Button>
          </>
        }
      />

      {issuesRequest.isPending ? <LoadingBlock>正在读取治理问题…</LoadingBlock> : null}

      {issuesRequest.isError ? (
        <Panel>
          <EmptyState
            minHeight={240}
            icon={<CircleAlert />}
            title="治理问题控制面不可用"
            description="控制面暂不可用 · 未加载治理问题。当前页面没有展示演示问题；请恢复控制面后重新加载。"
            action={<Button onClick={() => void issuesRequest.refetch()}>重新连接</Button>}
          />
        </Panel>
      ) : null}

      {issuesRequest.isSuccess ? (
        <div className="grid grid-cols-[300px_minmax(0,1fr)_320px] gap-3.5 max-[1320px]:grid-cols-[280px_minmax(0,1fr)] max-[1100px]:grid-cols-1">
          <Panel className="flex flex-col">
            <div className="flex items-center justify-between px-[18px] pt-4 pb-2">
              <h2 className="text-title font-semibold">问题队列<Count>{openIssues.length}</Count></h2>
              <span className="text-meta text-[#8b94a1]">按 SLA 排序</span>
            </div>
            <div className="px-[18px] pb-2">
              <SearchField
                value={keyword}
                onValueChange={(value) => { setKeyword(value); setPage(0) }}
                placeholder="搜索问题或责任部门"
                className="w-full"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 px-[18px] pb-2">
              {([['open', `待闭环 ${openIssues.length}`], ['closed', `已关闭 ${issues.length - openIssues.length}`], ['all', `全部 ${issues.length}`]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={statusFilter === value}
                  onClick={() => { setStatusFilter(value); setPage(0) }}
                  className={`rounded-chip border px-2 py-0.5 text-label ${statusFilter === value ? 'border-blue-line bg-blue-soft text-blue' : 'border-line bg-paper text-[#6b788b] hover:bg-wash'}`}
                >
                  {label}
                </button>
              ))}
              {openIssues.length > 0 ? <button type="button" onClick={() => setBatchOpen(true)} className="rounded-chip border border-line bg-paper px-2 py-0.5 text-label text-[#6b788b] hover:bg-wash">批量提醒</button> : null}
            </div>
            <p className="px-[18px] pb-2 text-meta text-[#98a2ae]">当前筛选 {visibleIssues.length} 项</p>
            <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-2 pb-2">
              {pagedIssues.map((issue) => {
                const active = selected?.id === issue.id
                return (
                  <li key={issue.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => select(issue.id)}
                      className={`mb-1 w-full rounded-control px-2.5 py-2 text-left ${active ? 'bg-blue-soft' : 'hover:bg-wash'}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-meta text-[#8b94a1]">{issue.id}</span>
                        <Badge tone={toneBadge(severityTone(issue.severity))}>{severityLabel(issue.severity)}风险</Badge>
                      </span>
                      <span className="mt-1 block text-body-sm text-[#43546e]">{issue.title}</span>
                      <span className="mt-0.5 block text-meta text-[#6c798c]">{issue.ownerDepartment} · {issue.ownerName} · {issueStatusLabel(issue.status)}</span>
                    </button>
                  </li>
                )
              })}
              {visibleIssues.length === 0 ? (
                <li className="px-3 py-6 text-center text-label text-muted">
                  当前范围暂无匹配的治理问题
                  {keyword || statusFilter !== 'all' ? <Button variant="text" size="sm" className="ml-1" onClick={() => { setKeyword(''); setStatusFilter('all'); setPage(0) }}>查看全部问题</Button> : null}
                </li>
              ) : null}
            </ul>
            <div className="border-t border-line px-3">
              <TablePagination page={currentPage} pageSize={QUEUE_PAGE_SIZE} total={visibleIssues.length} onPageChange={setPage} label="问题队列分页" className="border-t-0 px-0" />
            </div>
          </Panel>

          <Panel>
            {detailRequest.isPending && selected ? <Skeleton rows={5} /> : null}
            {detailRequest.isError ? (
              <div className="px-5 py-8 text-center">
                <p className="text-body-sm font-medium text-[#59677d]">治理问题详情不可用</p>
                <p className="mt-1 text-label text-muted">问题详情读取失败，请刷新后重试</p>
                <Button size="sm" className="mt-3" onClick={() => void detailRequest.refetch()}>重新读取</Button>
              </div>
            ) : null}
            {selected && detail ? (
              <>
                <div className="border-b border-line px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={toneBadge(issueStatusTone(selected.status))}>{issueStatusLabel(selected.status)}</Badge>
                    <span className="text-meta text-[#8b94a1]">更新于 {formatDateTime(selected.updatedAt ?? null)}</span>
                  </div>
                  <h2 className="mt-2 text-subject font-semibold text-[#2c3a4d]">{selected.title}</h2>
                  <p className="mt-1 text-label text-muted">{selected.id} · {selected.objectLabel || selected.datasetId}</p>
                  <dl className="mt-3 grid grid-cols-3 gap-4">
                    <Fact label="责任人" value={`${selected.ownerDepartment} · ${selected.ownerName}`} />
                    <Fact label="SLA 截止" value={formatDateTime(selected.dueAt)} />
                    <Fact label="最近更新" value={formatDateTime(selected.updatedAt ?? null)} />
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button variant="primary" disabled={!canRecheck || busy} onClick={() => selected && recheckMutation.mutate(selected.id)}>
                      {recheckMutation.isPending ? '提交中…' : selected.status === 'RECHECKING' ? '复检中' : '开始复检'}
                    </Button>
                    {detail.latestRun && !isTerminalRun(detail.latestRun.status) ? (
                      <Button disabled={busy} onClick={() => selected && detail.latestRun && syncMutation.mutate({ issueId: selected.id, runId: detail.latestRun.id })}>
                        <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : undefined} />{syncMutation.isPending ? '同步中…' : '同步复检结果'}
                      </Button>
                    ) : null}
                    <Button disabled={busy || selected.status === 'CLOSED'} onClick={() => remindMutation.mutate(selected.id)}>
                      {remindMutation.isPending ? '提醒中…' : selected.status === 'CLOSED' ? '问题已关闭' : '提醒责任人'}
                    </Button>
                    <Button onClick={() => setChainOpen(true)}><Shield size={13} />责任链</Button>
                    {selected.status === 'CLOSED' ? <span className="text-meta text-[#98a2ae]">问题已关闭，主操作停用；如需重新处理请从队列选择未闭环问题</span> : null}
                  </div>
                  {selected.status === 'RECHECKING' ? <p className="mt-2 text-label text-[#8e7040]">复检请求已登记，正在等待执行器异步回写；本状态尚不代表质量规则通过。</p> : null}
                  {actionError ? <p role="alert" className="mt-2 text-body-sm text-[#b04747]">{actionError}</p> : null}
                </div>

                <div className="flex items-center justify-between px-5 pt-4 pb-2">
                  <h3 className="text-label font-medium text-[#566173]">处理记录</h3>
                  <span className="text-meta text-[#98a2ae]">{detail.events.length} 条事件</span>
                </div>
                <ol className="m-0 list-none px-5 pb-4">
                  {groupedTimeline(detail.events).map((group) => group.kind === 'retries' ? (
                    <li key={group.events[0].id} className="border-l border-[#e2e8f0] pb-4 pl-5">
                      <div className="text-body-sm font-medium text-[#43546e]">
                        复检投递重试（共 {group.events.length} 条）
                      </div>
                      <details className="mt-1 text-label text-[#8b94a1]">
                        <summary className="cursor-pointer">展开每次记录</summary>
                        {group.events.map((event) => (
                          <p key={event.id} className="mt-1">
                            {formatDateTime(event.createdAt)} · {eventTitle(event.eventType)}{event.note ? ` · ${formatInlineDateTimes(event.note)}` : ''}
                          </p>
                        ))}
                      </details>
                    </li>
                  ) : (
                    <li key={group.event.id} className="border-l border-[#e2e8f0] pb-4 pl-5">
                      <div className="flex items-start justify-between gap-3">
                        <strong className="text-body-sm font-medium text-[#43546e]">{eventTitle(group.event.eventType)}</strong>
                        <time className="shrink-0 text-meta text-[#8d96a3]">{formatDateTime(group.event.createdAt)}</time>
                      </div>
                      <p className="mt-1 text-label leading-relaxed text-[#8b94a1]">
                        {executorOutputView(group.event.note).folded
                          ? <>{formatInlineDateTimes(executorOutputView(group.event.note).head)}…</>
                          : formatInlineDateTimes(group.event.note)} · {actorLabel(group.event.actor)}
                      </p>
                    </li>
                  ))}
                  {detail.events.length === 0 ? (
                    <li className="pl-1 text-label text-muted">问题来自质量规则目录，等待责任人处理。</li>
                  ) : null}
                </ol>

                <div className="border-t border-line px-5 py-4">
                  <label htmlFor="processing-note" className="mb-1.5 block text-body-sm text-[#566173]">处理说明</label>
                  {looksLikeExecutorOutput(selected.processingNote) ? (
                    <details className="mb-2 rounded-control border border-line bg-wash px-3 py-2 text-label text-[#7c8795]">
                      <summary className="cursor-pointer">历史执行器输出（仅参考，不作为处理结论）</summary>
                      <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap font-mono text-meta">{selected.processingNote}</pre>
                    </details>
                  ) : null}
                  <textarea
                    id="processing-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    disabled={!canEdit || busy}
                    placeholder={canEdit ? '填写人工处理结论（处置动作、原因与复核口径）' : ''}
                    className="min-h-[96px] w-full rounded-control border border-line-strong bg-paper px-2.5 py-2 text-body-sm text-ink-soft disabled:bg-wash disabled:text-faint"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="primary"
                      disabled={!canEdit || !note.trim() || busy}
                      onClick={() => selected && noteMutation.mutate({ issueId: selected.id, status: selected.status === 'CLOSED' ? 'CLOSED' : 'IN_PROGRESS', text: note.trim() })}
                    >
                      <Send size={14} />{noteMutation.isPending ? '保存中…' : '提交说明'}
                    </Button>
                  </div>
                </div>
              </>
            ) : (!detailRequest.isPending && !detailRequest.isError) ? (
              <EmptyState minHeight={320} icon={<Search />} title="请选择一个治理问题" description="从左侧队列选择问题，查看证据、处理记录与责任链。" />
            ) : null}
          </Panel>

          <Panel className="max-[1320px]:col-span-2 max-[1100px]:col-span-1">
            {selected && detail ? (
              <div className="px-4 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-label font-medium text-[#566173]">影响与证据</h3>
                  <Badge tone={toneBadge(severityTone(selected.severity))}>{severityLabel(selected.severity)}风险</Badge>
                </div>
                <EvidenceBox title="影响范围">{selected.impact}</EvidenceBox>
                <EvidenceBox title="规则证据">{selected.ruleId}<br />规则结果来源：治理规则运行记录</EvidenceBox>
                <EvidenceBox title="复检执行批次">
                  {detail.latestRun ? <RunEvidence run={detail.latestRun} /> : <p>尚未提交质量规则复检。</p>}
                  {detail.runs.length > 1 ? (
                    <div className="mt-2 border-t border-line pt-2">
                      <strong className="text-label text-[#566173]">历史执行批次（{detail.runs.length}）</strong>
                      {detail.runs.slice(1).map((run) => (
                        <div key={run.id} className="mt-1 flex items-center gap-2 text-meta text-[#6b7889]">
                          <Badge tone={toneBadge(runStatusTone(run.status))}>{runStatusLabel(run.status)}</Badge>
                          <span title={run.executionBatchId}>{shortBatchId(run.executionBatchId)}</span>
                          <time>{formatDateTime(run.submittedAt)}</time>
                          <small>{run.sampleEvidence.length} 条证据</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </EvidenceBox>
                {detail.latestRun?.reconciliationStatus === 'MANUAL_REQUIRED' ? (
                  <div role="status" className="mb-2 rounded-control border border-[#eee2c5] bg-[#fdf9ef] px-3 py-2 text-label text-[#8e7040]">
                    <strong>质量执行批次待人工对账</strong>
                    <p className="mt-1">{detail.latestRun.reconciliationMessage ?? '外部执行器未能可靠返回状态，请先重新查询；确认不存在后才允许结束本批次。'}</p>
                    <div className="mt-1.5 flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => selected && detail.latestRun && reconcileMutation.mutate({ issueId: selected.id, runId: detail.latestRun.id })}>
                        {reconcileMutation.isPending ? '查询中…' : '重新查询'}
                      </Button>
                      <Button size="sm" variant="danger-outline" disabled={busy} onClick={() => selected && detail.latestRun && confirmAbsentMutation.mutate({ issueId: selected.id, runId: detail.latestRun.id })}>
                        {confirmAbsentMutation.isPending ? '确认中…' : '确认不存在'}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <EvidenceBox title="责任人通知">
                  {detail.notifications.length > 0
                    ? detail.notifications.slice(0, 3).map((notification) => (
                      <p key={notification.id} className="mb-1.5">
                        <Badge tone={notification.status === 'SENT' ? 'success' : notification.status === 'FAILED' ? 'danger' : 'warn'}>{notificationStatusLabel(notification.status)}</Badge>
                        <span className="ml-1.5">{notification.channel} · {notification.recipient}</span>
                        <br />{notification.subject}
                        {notification.lastError ? <><br /><span className="text-[#b04747]">{notification.lastError}</span></> : null}
                      </p>
                    ))
                    : <p>当前没有通知记录。</p>}
                </EvidenceBox>
                <EvidenceBox title="责任归属">{selected.ownerDepartment} · {selected.ownerName}<br />来源：资产责任人与组织主数据</EvidenceBox>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}

      <Panel className="mt-3.5">
        <PanelHead
          title="质量规则"
          count={rulesRequest.data?.total ?? 0}
          description="动态规则台账：保存即推送质量执行器编译，失败原因如实回显"
          actions={<Button size="sm" variant="primary" onClick={() => navigate(workLinks.qualityRuleNew())}><Plus size={13} />新建规则</Button>}
        />
        <ScopeNote>删除会从执行器同步摘除规则；如需暂停执行请使用「停用」。已产生的治理问题与运行记录保留。</ScopeNote>
        <DataTable
          columns={ruleColumns}
          data={rulesRequest.data?.items ?? []}
          getRowId={(rule) => rule.ruleId}
          rowLabel={(rule) => rule.ruleId}
          loading={rulesRequest.isPending}
          empty={<EmptyState minHeight={200} icon={<Shield />} title="还没有动态质量规则" description="新建规则后保存即推送执行器；执行器对目标表列做实校验。" />}
        />
      </Panel>

      <Confirm
        open={batchOpen}
        onOpenChange={setBatchOpen}
        title={`提醒 ${openIssues.length} 个待闭环问题的责任人`}
        description="将按当前未闭环清单逐一向责任人投递提醒通知；单条失败不影响其余，已关闭问题不会被打扰。"
        object={{ name: `${openIssues.length} 个待闭环问题`, meta: openIssues.slice(0, 3).map((issue) => issue.id).join('、') + (openIssues.length > 3 ? '…' : '') }}
        confirmLabel={`确认提醒 ${openIssues.length} 位责任人`}
        busy={batchRemindMutation.isPending}
        onConfirm={() => batchRemindMutation.mutate(openIssues.map((issue) => issue.id))}
      />

      <Confirm
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={`删除 ${pendingDelete?.ruleId ?? ''}`}
        description={`规则${pendingDelete ? `（${QUALITY_RULE_TYPE_LABELS[pendingDelete.ruleType] ?? pendingDelete.ruleType} · ${pendingDelete.datasetId}${pendingDelete.targetColumn ? ` · ${pendingDelete.targetColumn}` : ''}）` : ''}将被删除，并从质量执行器同步摘除，已产生的治理问题与运行记录保留。`}
        object={pendingDelete ? { name: pendingDelete.ruleId, meta: `${pendingDelete.ruleType} · ${pendingDelete.datasetId}` } : undefined}
        hint="此操作不可撤销；如需暂停执行请使用「停用」。"
        confirmLabel="删除规则"
        tone="destructive"
        busy={ruleDelete.isPending}
        onConfirm={() => pendingDelete && ruleDelete.mutate(pendingDelete.ruleId)}
      />

      <ResponsibilitySheet issue={selected} open={chainOpen} onOpenChange={setChainOpen} updatedAt={selected?.updatedAt} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mb-0.5 text-meta text-[#8a929e]">{label}</dt>
      <dd className="m-0 text-body-sm text-[#4a5666]">{value}</dd>
    </div>
  )
}

function EvidenceBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 rounded-control border border-line bg-wash px-3 py-2.5">
      <h4 className="mb-1 text-label font-medium text-[#566173]">{title}</h4>
      <div className="text-label leading-relaxed text-[#6b7789]">{children}</div>
    </div>
  )
}

function RunEvidence({ run }: { run: GovernanceQualityRunApiItem }) {
  const view = run.resultMessage ? executorOutputView(run.resultMessage) : null
  return (
    <>
      <p>
        <Badge tone={toneBadge(runStatusTone(run.status))}>{runStatusLabel(run.status)}</Badge>
        <br />执行器：{executorLabel(run.executor)}
        <br />批次：<code className="font-mono text-meta" title={run.executionBatchId}>{shortBatchId(run.executionBatchId)}</code>
        <br />提交：{formatDateTime(run.submittedAt)}
        {run.finishedAt ? <><br />完成：{formatDateTime(run.finishedAt)}</> : null}
      </p>
      <p className="mt-1">
        尝试 {run.attemptCount} 次{run.nextPollAt ? <> · {formatDateTime(run.nextPollAt)} 自动同步轮询结果（也可手动同步）</> : null}
      </p>
      {view ? (
        <p className="mt-1">
          {view.head}
          {view.folded ? <>…<details className="mt-1 text-meta"><summary className="cursor-pointer">查看完整执行输出</summary><pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap font-mono">{view.folded}</pre></details></> : null}
        </p>
      ) : null}
      {run.lastError ? <p className="mt-1 text-[#b04747]">最近错误：{run.lastError}</p> : null}
      {run.artifactUri ? (
        <p className="mt-1">
          制品地址：{isSafeArtifactLink(run.artifactUri)
            ? <a href={run.artifactUri} target="_blank" rel="noreferrer" className="text-blue underline underline-offset-2">打开复检制品</a>
            : <code className="font-mono text-meta">{run.artifactUri}</code>}
        </p>
      ) : null}
      {run.sampleEvidence.length > 0 ? (
        <div className="mt-2">
          <strong className="text-label text-[#566173]">样本证据（{run.sampleEvidence.length}）</strong>
          {run.sampleEvidence.map((item, index) => (
            <pre key={`${run.id}-${index}`} className="mt-1 max-h-[140px] overflow-auto rounded-chip border border-line bg-paper p-2 font-mono text-meta">{JSON.stringify(item, null, 2)}</pre>
          ))}
        </div>
      ) : null}
    </>
  )
}

import { TableSkeleton } from '@/components/app/table-skeleton'
import { LoadingBlock } from '@/components/app/loading'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { Drawer, DrawerClose, DrawerDescription, DrawerFooter, DrawerHeader, DrawerPanel, DrawerPopup, DrawerTitle } from '@/components/ui/drawer'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, GitMerge, GitPullRequestArrow, LoaderCircle, RefreshCw, ShieldCheck, XCircle, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { QueryBoundary } from '../app/query-boundary'

import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/app/search-field'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { Panel, PanelHead } from '../components/kit/panel'
import { EmptyState } from '@/components/app/empty-state'
import { DataTable, TablePagination, listColumnHelper } from '../components/table/data-table'
import { formatDateTime } from '../data/domain'
import {
  decideMpiTask,
  fetchMpiCandidates,
  fetchMpiMetrics,
  fetchMpiPerson,
  mpiEvidenceLine,
  mpiRuleLabel,
  rebuildMpi,
  splitMpiPerson,
  type MpiCandidateItem,
  type MpiPersonDetail,
} from '../data/mpiApi'

/**
 * 患者主索引复核（常驻宽复核工作区）：左侧候选队列、中间双身份对照与证据、
 * 下方操作影响与合并确认。黄金人详情用 Sheet 只读核对，拆分另用 AlertDialog
 * （OVERLAY-AUDIT：整张 Sheet 不承担危险动作确认）。
 *
 * 数据生命周期由 Query 持有；深链 `?task=` 保留。队列搜索走服务端（mpi-service
 * 在全队列上过滤姓名/卡号/规则），不做首 100 条的客户端过滤。
 */
export function MpiReviewLive({ onNotice }: { onNotice: (message: string) => void }) {
  return (
    <QueryBoundary>
      <MpiWorkspace onNotice={onNotice} />
    </QueryBoundary>
  )
}

function MpiWorkspace({ onNotice }: { onNotice: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(0)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('task') || null)
  const [confirmed, setConfirmed] = useState(false)
  const [personId, setPersonId] = useState<string | null>(null)
  const [splitTarget, setSplitTarget] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const metricsRequest = useQuery({
    queryKey: ['mpi', 'metrics'],
    queryFn: ({ signal }) => fetchMpiMetrics(signal),
    staleTime: 30_000,
  })
  const queueRequest = useQuery({
    queryKey: ['mpi', 'candidates', 'OPEN'],
    queryFn: ({ signal }) => fetchMpiCandidates({ status: 'OPEN', size: 100 }, signal),
  })
  const searchRequest = useQuery({
    queryKey: ['mpi', 'candidates', 'OPEN', debounced],
    queryFn: ({ signal }) => fetchMpiCandidates({ status: 'OPEN', size: 100, query: debounced }, signal),
    enabled: debounced.length > 0,
  })

  const candidates = searchRequest.data?.items ?? queueRequest.data?.items ?? []
  const queueTotal = searchRequest.data?.total ?? queueRequest.data?.total ?? null
  const selected = useMemo(
    () => candidates.find((item) => item.taskId === selectedTaskId) ?? candidates[0] ?? null,
    [candidates, selectedTaskId],
  )

  useEffect(() => {
    if (!selected) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('task') === selected.taskId) return
    params.set('task', selected.taskId)
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }, [selected])

  const pageCount = Math.max(1, Math.ceil(candidates.length / 8))
  const currentPage = Math.min(page, pageCount - 1)
  const paged = candidates.slice(currentPage * 8, (currentPage + 1) * 8)

  const refreshQueue = () => {
    void queryClient.invalidateQueries({ queryKey: ['mpi'] })
    setConfirmed(false)
  }

  const decision = useMutation({
    mutationFn: ({ taskId, resolution }: { taskId: string; resolution: 'SAME_PERSON' | 'DIFFERENT_PERSON' }) =>
      decideMpiTask(taskId, resolution, resolution === 'SAME_PERSON' ? '工作台人工确认同人' : '工作台人工确认不同人'),
    onSuccess: (result, variables) => {
      refreshQueue()
      setSelectedTaskId(null)
      if (variables.resolution === 'SAME_PERSON' && result.mergedPersonId) {
        onNotice('已确认同一人并并入黄金记录；可在黄金人详情中拆分撤销')
        setPersonId(result.mergedPersonId)
      } else {
        onNotice('已确认不同人：该候选对不再自动进入复核（人工否决生效）')
      }
    },
    onError: () => onNotice('决策提交失败，请稍后重试'),
  })

  const rebuild = useMutation({
    mutationFn: () => rebuildMpi(),
    onSuccess: (result) => {
      refreshQueue()
      onNotice(`重算完成：${result.identitiesLoaded} 身份 / ${result.candidatePairs} 候选对 / 自动匹配 ${result.outcomes.autoMatch}`)
    },
    onError: () => onNotice('主索引重算失败，请稍后重试'),
  })

  const evidence = selected?.evidence ?? []
  const identityRows = selected ? [
    { field: '姓名', valueA: selected.identityA.name, valueB: selected.identityB.name },
    { field: '性别', valueA: selected.identityA.gender, valueB: selected.identityB.gender },
    { field: '卡号（掩码）', valueA: selected.identityA.cardNo || '—', valueB: selected.identityB.cardNo || '—' },
    { field: '患者主键（掩码）', valueA: selected.identityA.patientId, valueB: selected.identityB.patientId },
    { field: '机构', valueA: selected.identityA.institution, valueB: selected.identityB.institution },
    { field: '源系统', valueA: selected.identityA.sourceSystem, valueB: selected.identityB.sourceSystem },
    { field: '年龄（仅展示）', valueA: selected.identityA.age || '—', valueB: selected.identityB.age || '—' },
  ] : []

  const identityHelper = listColumnHelper<{ field: string; valueA: string; valueB: string }>()
  const identityColumns = identityHelper.columns([
    identityHelper.accessor('field', { header: '身份属性', size: 160 }),
    identityHelper.accessor('valueA', { header: '源身份 A' }),
    identityHelper.display({
      id: 'valueB',
      header: '源身份 B',
      cell: ({ row }) => (
        <div>
          {row.original.valueB}
          {row.original.valueA !== row.original.valueB ? <small className="ml-2 text-meta text-amber">与源身份 A 不同</small> : null}
        </div>
      ),
    }),
  ])

  const loading = queueRequest.isPending || metricsRequest.isPending
  const unavailable = queueRequest.isError

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-label text-muted-foreground">
        <i aria-hidden="true" className={`size-1.5 rounded-full ${unavailable ? 'bg-[#929daa]' : 'bg-[#4d8c6e]'}`} />
        {loading ? '正在连接 MPI 服务…' : unavailable ? 'MPI 服务暂不可用 · 不可用时不展示演示候选' : 'MPI 服务已连接 · 候选与决策来自 mpi-service'}
      </div>

      {metricsRequest.data ? (
        <section className="mb-3.5 grid grid-cols-5 gap-3.5 rounded-panel border border-line bg-paper px-0 py-3 max-[1100px]:grid-cols-3">
          <MetricCell label="已装载源身份" value={metricsRequest.data.identitiesLoaded} />
          <MetricCell label="黄金人" value={metricsRequest.data.goldenPersons} />
          <MetricCell label="自动匹配" value={metricsRequest.data.autoMatches} />
          <MetricCell label="待复核" value={metricsRequest.data.reviewPending} alert={metricsRequest.data.reviewPending > 0} />
          <MetricCell label="已裁决" value={metricsRequest.data.reviewResolved} />
        </section>
      ) : null}

      {unavailable ? (
        <Panel className="mb-3.5">
          <EmptyState
            minHeight={200}
            icon={<CircleAlert />}
            title="MPI 服务不可用"
            description="当前页面不展示演示候选；请恢复 mpi-service 后重新加载。"
            action={<Button variant="outline" onClick={refreshQueue}>重新连接</Button>}
          />
        </Panel>
      ) : null}

      {loading && !unavailable ? <LoadingBlock>正在读取复核队列与身份信息…</LoadingBlock> : null}

      {!loading && !unavailable ? (
        <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
          <Panel className="flex flex-col">
            <PanelHead title="候选队列" count={metricsRequest.data?.reviewPending ?? candidates.length} description="按规则评分降序" />
            <div className="px-[18px] pb-2">
              <SearchField value={query} onValueChange={(value) => { setQuery(value); setPage(0) }} placeholder="姓名 / 卡号 / 规则（全队列检索）" label="搜索复核候选" className="w-full" />
            </div>
            {searchRequest.isError ? (
              <Alert variant="error" className="mx-[18px] mb-2">
                <CircleAlert />
                <AlertDescription>候选搜索失败，请调整关键词后重试</AlertDescription>
              </Alert>
            ) : null}
            {searchRequest.isFetching ? <p className="px-[18px] pb-2 text-meta text-muted-foreground">正在全队列检索…</p> : null}
            <ul className="m-0 min-h-0 flex-1 list-none px-2 pb-2">
              {paged.map((candidate) => {
                const active = selected?.taskId === candidate.taskId
                return (
                  <li key={candidate.taskId}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setSelectedTaskId(candidate.taskId); setConfirmed(false) }}
                      className={`mb-1 w-full rounded-control px-2.5 py-2 text-left ${active ? 'bg-blue-soft' : 'hover:bg-wash'}`}
                    >
                      <span className="block text-meta text-muted-foreground">{mpiRuleLabel[candidate.ruleId] ?? candidate.ruleId}</span>
                      <span className="mt-0.5 block text-body-sm text-ink-soft">{candidate.identityA.name} ↔ {candidate.identityB.name}</span>
                      <span className="mt-0.5 block text-meta text-muted-foreground">{candidate.identityA.institution} · {candidate.identityA.cardNo || '无卡号'}</span>
                    </button>
                  </li>
                )
              })}
              {candidates.length === 0 ? (
                <li className="px-3 py-6 text-center text-label text-muted-foreground">
                  {debounced ? '全队列未找到匹配候选，请调整姓名 / 卡号 / 规则关键词' : '当前没有待复核候选'}
                </li>
              ) : null}
            </ul>
            {!debounced && queueTotal != null && queueTotal > candidates.length ? (
              <p className="px-[18px] pb-2 text-meta text-muted-foreground">已加载前 {candidates.length} 条（共 {queueTotal} 条待复核；可用上方搜索定位）</p>
            ) : null}
            {debounced && searchRequest.data && searchRequest.data.total > searchRequest.data.items.length ? (
              <p className="px-[18px] pb-2 text-meta text-muted-foreground">命中 {searchRequest.data.total} 条，已加载前 {searchRequest.data.items.length} 条</p>
            ) : null}
            <div className="border-t border-line px-2">
              <TablePagination page={currentPage} pageSize={8} total={candidates.length} onPageChange={setPage} label="复核候选分页" compact className="border-t-0 px-1" />
            </div>
            <div className="px-[18px] py-2">
              <Button variant="outline" size="sm" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
                <RefreshCw size={13} className={rebuild.isPending ? 'animate-spin' : undefined} />{rebuild.isPending ? '重算中…' : '重算主索引'}
              </Button>
            </div>
          </Panel>

          <Panel>
            {selected ? (
              <>
                <div className="border-b border-line px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">需人工确认</Badge>
                    <span className="text-label text-muted-foreground">{evidence.filter((item) => !item.match).length} 项证据不一致 · 请逐项核对</span>
                  </div>
                  <h2 className="mt-1.5 text-subject font-semibold text-ink">{selected.identityA.name} 与 {selected.identityB.name}</h2>
                  <p className="mt-1 text-label text-muted-foreground">{mpiRuleLabel[selected.ruleId] ?? selected.ruleId} · 候选对 {selected.pairId} · 规则版本 v1</p>
                </div>
                <div className="px-5 py-4">
                  <DataTable
                    columns={identityColumns}
                    data={identityRows}
                    getRowId={(row) => row.field}
                    empty={<p className="py-2 text-label text-muted-foreground">当前候选缺少可比对的身份属性。</p>}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3.5 px-5 pb-4 max-[1100px]:grid-cols-1">
                  <section className="rounded-control border border-line px-3.5 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <h3 className="text-label font-medium text-ink-soft">匹配证据</h3>
                        <p className="text-meta text-muted-foreground">逐字段对比 · 敏感值已掩码</p>
                      </div>
                      <ShieldCheck size={16} className="text-blue" />
                    </div>
                    <ul className="m-0 list-none space-y-1 p-0">
                      {evidence.map((item) => (
                        <li key={item.field} className={`flex items-start gap-1.5 text-label ${item.match ? 'text-ink-soft' : 'text-amber'}`}>
                          {item.match ? <CheckCircle2 size={14} className="mt-0.5 text-green" /> : <XCircle size={14} className="mt-0.5 text-amber" />}
                          {mpiEvidenceLine(item)}
                        </li>
                      ))}
                      {evidence.length === 0 ? <li className="text-label text-muted-foreground">该候选对没有逐字段证据。</li> : null}
                    </ul>
                  </section>
                  <section className="rounded-control border border-line px-3.5 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <h3 className="text-label font-medium text-ink-soft">操作影响</h3>
                        <p className="text-meta text-muted-foreground">决策即审计，人工否决高于规则</p>
                      </div>
                      <GitMerge size={16} className="text-blue" />
                    </div>
                    <dl className="m-0 space-y-1.5 text-label text-muted-foreground">
                      <div><dt className="font-medium text-ink-soft">确认同人</dt><dd className="m-0">两身份并入黄金人（决策源=人工），可在详情中拆分撤销</dd></div>
                      <div><dt className="font-medium text-ink-soft">确认不同人</dt><dd className="m-0">终态否决：该对永不再自动候选或自动合并</dd></div>
                      <div><dt className="font-medium text-ink-soft">误合并防护</dt><dd className="m-0">卡号复用等弱证据冲突一律进入本队列，不自动合并</dd></div>
                    </dl>
                  </section>
                </div>
                <div className="border-t border-line px-5 py-4">
                  <div className="flex items-start gap-2">
                    <Checkbox id="mpi-review-confirm" className="mt-0.5" checked={confirmed} disabled={decision.isPending} onCheckedChange={setConfirmed} />
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="mpi-review-confirm">我已核对身份属性与证据</Label>
                      <p className="text-muted-foreground text-xs">错误合并的临床风险高于漏合并——弱证据冲突请确认不同人。</p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => decision.mutate({ taskId: selected.taskId, resolution: 'DIFFERENT_PERSON' })} disabled={decision.isPending}>
                      <GitPullRequestArrow size={14} />确认不同人
                    </Button>
                    <Button disabled={!confirmed || decision.isPending} onClick={() => decision.mutate({ taskId: selected.taskId, resolution: 'SAME_PERSON' })}>
                      {decision.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <GitMerge size={14} />}确认同人并合并
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState minHeight={360} icon={<ShieldCheck />} title="当前没有待复核候选" description="点击左侧「重算主索引」装载最新数据，或用搜索定位历史候选。" />
            )}
          </Panel>
        </div>
      ) : null}

      {personId ? (
        <MpiPersonSheet
          personId={personId}
          onClose={() => setPersonId(null)}
          onSplitApplied={refreshQueue}
          onRequestSplit={(identity) => setSplitTarget(identity)}
        />
      ) : null}

      <ConfirmDialog
        open={splitTarget !== null}
        onOpenChange={(open) => { if (!open) setSplitTarget(null) }}
        title="拆分黄金人身份"
        description="该源身份将拆分为独立黄金人；它与原黄金人的组合永不再自动合并。原黄金人的其他有效身份不受影响。"
        object={{ name: splitTarget ?? '', meta: personId ? `当前黄金人 ${personId}` : '' }}
        hint="拆分不可撤销；人工否决与拆分都会保留审计记录。"
        confirmLabel="拆分身份"
        tone="destructive"
        onConfirm={() => {
          if (!personId || !splitTarget) return
          void splitMpiPerson(personId, splitTarget, '工作台人工拆分')
            .then(() => {
              onNotice('已拆分为独立黄金人：该身份与原黄金人的组合永不再自动合并')
              setSplitTarget(null)
              refreshQueue()
              void fetchMpiPerson(personId).catch(() => null)
            })
            .catch(() => onNotice('拆分失败，请稍后重试'))
        }}
      />
    </div>
  )
}

function MetricCell({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="border-r border-line px-[18px] last:border-r-0">
      <strong className={`block text-[22px] leading-tight font-medium ${alert ? 'text-amber' : 'text-ink'}`}>{value}</strong>
      <span className="text-label text-muted-foreground">{label}</span>
    </div>
  )
}

function MpiPersonSheet({
  personId,
  onClose,
  onSplitApplied,
  onRequestSplit,
}: {
  personId: string
  onClose: () => void
  onSplitApplied: () => void
  onRequestSplit: (identityGroup: string) => void
}) {
  const personRequest = useQuery({
    queryKey: ['mpi', 'person', personId],
    queryFn: ({ signal }) => fetchMpiPerson(personId, signal),
  })
  const person: MpiPersonDetail | undefined = personRequest.data
  const activeLinks = person?.links.filter((link) => link.linkStatus === 'ACTIVE') ?? []
  const canSplit = activeLinks.length > 1

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose() }} position="right">
      <DrawerPopup className="max-w-[610px]" variant="straight" showCloseButton={false}>
        <DrawerClose className="absolute end-2 top-2 z-1" render={<Button size="icon" variant="ghost" aria-label="关闭" />}>
          <X />
        </DrawerClose>
        <DrawerHeader className="pr-14">
          <DrawerTitle>黄金人详情</DrawerTitle>
          <DrawerDescription>{person?.goldenName ?? '黄金人 · 身份链接与审计'}</DrawerDescription>
        </DrawerHeader>
        <DrawerPanel>
          {personRequest.isPending ? <LoadingBlock className="min-h-[200px]">正在读取黄金人…</LoadingBlock> : null}
          {personRequest.isError ? (
            <Alert variant="error">
              <CircleAlert />
              <AlertDescription>黄金人详情不可用，请稍后重试</AlertDescription>
            </Alert>
          ) : null}
          {person ? (
            <>
              <h3 className="mb-1 text-label font-medium text-ink-soft">身份链接（当前有效成员）</h3>
              <ul className="m-0 mb-4 list-none p-0">
                {activeLinks.map((link) => (
                  <li key={link.sourceIdentifier} className="flex flex-wrap items-center gap-2 border-b border-line-soft py-2 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate font-mono text-label text-muted-foreground">{link.sourceIdentifier}</span>
                    <Badge variant={link.decisionSource === 'MANUAL' ? 'info' : 'outline'}>{link.decisionSource === 'MANUAL' ? '人工' : '规则'}</Badge>
                    {canSplit ? (
                      <Button size="sm" variant="destructive-outline" onClick={() => onRequestSplit(link.sourceIdentifier)}>拆分</Button>
                    ) : (
                      // 禁用态收不到悬停与焦点：按 coss 的写法包一层可聚焦的 span 来承载原因。
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
                          <Button size="sm" variant="destructive-outline" disabled>拆分</Button>
                        </TooltipTrigger>
                        <TooltipPopup>至少保留一个有效身份</TooltipPopup>
                      </Tooltip>
                    )}
                  </li>
                ))}
                {activeLinks.length === 0 ? <li className="py-2 text-label text-muted-foreground">暂无有效身份链接。</li> : null}
              </ul>
              <h3 className="mb-1 text-label font-medium text-ink-soft">操作历史（最近 20 条）</h3>
              <ol className="m-0 list-none p-0">
                {(person.history ?? []).map((event, index) => (
                  <li key={`${event.action}-${event.createdAt}-${index}`} className="border-b border-line-soft py-1.5 text-label text-muted-foreground last:border-b-0">
                    {event.action} · {event.actor} · {formatDateTime(event.createdAt)}
                  </li>
                ))}
                {(person.history ?? []).length === 0 ? <li className="py-2 text-label text-muted-foreground">暂无历史事件</li> : null}
              </ol>
              {!canSplit ? <p className="mt-3 text-meta text-muted-foreground">只剩一个有效身份时不能拆分。</p> : null}
            </>
          ) : null}
        </DrawerPanel>
        <DrawerFooter>
          <span className="text-muted-foreground text-xs sm:mr-auto">拆分是不可逆的人工决策；操作与决策源都会进入审计。</span>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  )
}

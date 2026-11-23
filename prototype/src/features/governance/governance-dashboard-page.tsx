import { useQuery } from '@tanstack/react-query'
import { ChevronRight, RefreshCw, Shield } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/kit/badge'
import { Button } from '@/components/ui/button'
import { MetricCard, MetricStrip } from '../../components/app/metric'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Count, Panel, PanelHead } from '../../components/kit/panel'
import { EmptyState, LoadingBlock } from '../../components/kit/states'
import { DataTable, listColumnHelper } from '../../components/table/data-table'
import { formatDateTime, issueStatusLabel, issueStatusTone } from '../../data/domain'
import type { GovernanceApiIssue } from '../../data/controlPlane'
import { deepLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { governanceSummaryQuery } from './queries'
import { QualityScorePanel } from './quality-score-panel'
import { ResponsibilitySheet } from './responsibility-sheet'

/** 指标卡 → 工作台：标签来自治理摘要接口，未知标签不跳转。 */
const METRIC_ROUTES: Record<string, string> = {
  标准覆盖率: '/governance/standards',
  质量规则通过率: '/governance/quality',
  问题按时闭环率: '/governance/quality',
  血缘完整率: '/assets/technical',
  标准映射覆盖: '/governance/mapping',
  有效数据合同: '/data-services',
}

function isIssueOverdue(issue: GovernanceApiIssue, now = Date.now()): boolean {
  if (issue.status === 'CLOSED' || !issue.dueAt) return false
  const due = new Date(issue.dueAt).getTime()
  return !Number.isNaN(due) && due < now
}

/** 治理待办：过滤已闭环，按 SLA 截止时间升序，最多 5 条。 */
function todaysIssues(issues: GovernanceApiIssue[]) {
  return issues
    .filter((issue) => issue.status !== 'CLOSED')
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
    .slice(0, 5)
}

function riskRankingFromIssues(issues: GovernanceApiIssue[]) {
  const byDataset = new Map<string, { dataset: string; owners: Set<string>; count: number; overdue: number }>()
  for (const issue of issues) {
    if (issue.status === 'CLOSED') continue
    const entry = byDataset.get(issue.datasetId) ?? { dataset: issue.datasetId || '未标注数据集', owners: new Set<string>(), count: 0, overdue: 0 }
    if (issue.ownerDepartment) entry.owners.add(issue.ownerDepartment)
    entry.count += 1
    if (isIssueOverdue(issue)) entry.overdue += 1
    byDataset.set(issue.datasetId, entry)
  }
  return Array.from(byDataset.values())
    .sort((a, b) => (b.overdue - a.overdue) || (b.count - a.count))
    .slice(0, 4)
    .map(({ dataset, owners, count, overdue }) => ({
      dataset, owner: Array.from(owners).join('、') || '责任部门未提供', overdue,
      value: overdue > 0 ? `${count} 项 · ${overdue} 逾期` : `${count} 项`,
    }))
}

const helper = listColumnHelper<GovernanceApiIssue>()
const todoColumns = helper.columns([
  helper.display({
    id: 'title',
    header: '问题',
    cell: ({ row }) => (
      <span className="text-body-sm text-ink">
        {row.original.title}
        {isIssueOverdue(row.original) ? <span className="ml-2 rounded-chip bg-red-soft px-1 py-px text-meta text-red">SLA 逾期</span> : null}
      </span>
    ),
  }),
  helper.accessor('impact', { header: '影响范围' }),
  helper.accessor('ownerDepartment', { header: '责任部门', size: 120 }),
  helper.display({
    id: 'dueAt',
    header: 'SLA',
    size: 120,
    meta: { align: 'right' },
    cell: ({ row }) => <span className="tabular-nums text-label">{formatDateTime(row.original.dueAt)}</span>,
  }),
  helper.display({
    id: 'status',
    header: '状态',
    size: 100,
    cell: ({ row }) => {
      const tone = issueStatusTone(row.original.status)
      return <Badge tone={tone === 'healthy' ? 'success' : tone === 'danger' ? 'danger' : tone === 'warning' ? 'warn' : 'neutral'}>{issueStatusLabel(row.original.status)}</Badge>
    },
  }),
])

/**
 * 治理驾驶舱：先处理逾期风险，再追溯规则证据与责任归属。
 * 指标、待办与风险排行全部来自治理摘要；不可用时显示真实不可用态，不补静态样例。
 */
export function GovernanceDashboardPage() {
  const navigate = usePortalNavigate()
  const query = useQuery(governanceSummaryQuery())
  const [chainOpen, setChainOpen] = useState(false)

  const summary = query.data
  const issues = summary?.issues ?? []
  const todoIssues = todaysIssues(issues)
  const chainTodo = todoIssues[0] ?? null
  const riskRanking = riskRankingFromIssues(issues)

  function openIssue(issue: GovernanceApiIssue) {
    navigate(deepLinks.qualityIssue(issue.id))
  }

  const metrics = (summary?.metrics ?? []).map((metric) => ({
    label: metric.label,
    value: Number.isInteger(metric.value) ? String(metric.value) : metric.value.toFixed(1),
    unit: metric.unit,
    note: metric.detail,
    tone: metric.tone === 'danger' ? 'danger' as const : metric.tone === 'warning' ? 'warn' as const : 'neutral' as const,
    route: METRIC_ROUTES[metric.label],
  }))

  return (
    <div>
      <Breadcrumb items={[{ label: '数据治理' }, { label: '治理驾驶舱' }]} trailing={summary ? <span>数据截至 {formatDateTime(summary.asOf)}</span> : null} />
      <PageHeading
        title="治理驾驶舱"
        description="先处理逾期风险，再追溯规则证据与责任归属。"
        actions={
          <>
            <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw size={14} className={query.isFetching ? 'animate-spin' : undefined} />刷新
            </Button>
            <Button onClick={() => navigate('/governance/quality')}>进入质量闭环</Button>
          </>
        }
      />

      {query.isPending ? <LoadingBlock>正在读取治理指标…</LoadingBlock> : null}

      {query.isError ? (
        <Panel>
          <EmptyState
            minHeight={240}
            icon={<Shield />}
            title="治理控制面不可用"
            description="控制面暂不可用 · 未加载真实治理指标或问题。为避免误导，当前没有展示本地演示指标、问题或责任链样例。请恢复控制面后重新连接。"
            action={<Button variant="outline" onClick={() => void query.refetch()}>重新连接</Button>}
          />
        </Panel>
      ) : null}

      {summary ? (
        <>
          {metrics.length > 0 ? (
            <MetricStrip>
              {metrics.map((metric) => (
                <MetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  unit={metric.unit}
                  note={metric.note}
                  tone={metric.tone}
                  onClick={metric.route ? () => navigate(metric.route) : undefined}
                />
              ))}
            </MetricStrip>
          ) : null}

          <Panel className="mb-3.5">
            <PanelHead
              title="治理待办"
              count={todoIssues.length}
              description="未闭环问题按 SLA 截止时间排序"
              actions={<Button variant="link" onClick={() => navigate('/governance/quality')}>进入质量闭环<ChevronRight size={13} /></Button>}
            />
            <DataTable
              columns={todoColumns}
              data={todoIssues}
              getRowId={(issue) => issue.id}
              rowLabel={(issue) => `打开问题：${issue.title}`}
              onRowClick={openIssue}
              empty={<EmptyState minHeight={200} icon={<Shield />} title="当前机构暂无待办问题" description="新问题由质量规则运行登记后出现在这里。" />}
            />
          </Panel>

          <Panel className="mb-3.5">
            <PanelHead
              title="治理责任链 · v1"
              description="围绕同一问题核对对象、规则、责任人与处理记录"
              actions={chainTodo
                ? <Button variant="link" onClick={() => setChainOpen(true)}>打开 {chainTodo.id} 的责任链<ChevronRight size={13} /></Button>
                : <Button variant="link" onClick={() => navigate('/governance/quality')}>前往质量问题工作台<ChevronRight size={13} /></Button>}
            />
            {chainTodo ? (
              <div className="px-5 pb-5">
                <div className="mb-3 rounded-control border border-line bg-wash px-3.5 py-3">
                  <span className="text-meta text-muted-foreground">优先跟进</span>
                  <strong className="mt-1 block text-body-sm text-ink-soft">{chainTodo.title}</strong>
                  <span className="mt-0.5 block text-meta text-muted-foreground">{chainTodo.id} · 更新于 {formatDateTime(chainTodo.updatedAt ?? null)}</span>
                </div>
                <dl className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2">
                  <Fact label="影响对象" value={chainTodo.objectLabel || chainTodo.impact || chainTodo.datasetId} />
                  <Fact label="触发规则" value={chainTodo.ruleId} />
                  <Fact label="责任归属" value={`${chainTodo.ownerDepartment} · ${chainTodo.ownerName}`} />
                  <Fact label="关联工单" value={chainTodo.ticketId || '尚未关联工单'} />
                </dl>
              </div>
            ) : (
              <p className="px-5 pb-5 text-label text-muted-foreground">当前没有待闭环问题。新问题登记后，可在此追踪治理责任链。</p>
            )}
          </Panel>

          <div className="mb-3.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3.5 max-[1100px]:grid-cols-1">
            <Panel>
              <PanelHead title="数据集风险排行" description="按数据集聚合，依逾期与未闭环问题排序" actions={<Button variant="link" onClick={() => navigate('/governance/quality')}>查看全部<ChevronRight size={13} /></Button>} />
              <ol className="m-0 list-none px-5 pb-4">
                {riskRanking.map((item, index) => (
                  <li key={item.dataset} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-b-0">
                    <span className="flex size-6 items-center justify-center rounded-chip border border-line bg-[#f7f9fc] text-label text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-body-sm font-medium text-ink-soft">{item.dataset}</strong>
                      <span className="block text-meta text-muted-foreground">{item.owner}</span>
                    </div>
                    <span className={`text-label ${item.overdue > 0 ? 'text-red' : 'text-ink-soft'}`}>{item.value}</span>
                  </li>
                ))}
                {riskRanking.length === 0 ? <li className="py-6 text-center text-label text-muted-foreground">当前没有未闭环风险问题</li> : null}
              </ol>
            </Panel>
            <QualityScorePanel compact />
          </div>
        </>
      ) : null}

      <ResponsibilitySheet issue={chainTodo} open={chainOpen} onOpenChange={setChainOpen} updatedAt={chainTodo?.updatedAt} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mb-1 text-meta text-muted-foreground">{label}</dt>
      <dd className="m-0 text-body-sm text-ink-soft">{value}</dd>
    </div>
  )
}

export { Count }

import { useQuery } from '@tanstack/react-query'
import { Gauge, Settings2 } from 'lucide-react'

import { LoadingBlock } from '@/components/app/loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FrameDescription, FrameHeader, FramePanel } from '@/components/ui/frame'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

import { usePortalNavigate } from '../../app/navigate'
import { DataTable, listColumnHelper } from '../../components/table/data-table'
import { QUALITY_RULE_TYPE_LABELS, type QualityScoreSummary } from '../../data/controlPlane'
import { formatDateTime } from '../../data/domain'
import { qualityScoreQuery } from './queries'

export const QUALITY_DIMENSIONS = ['完整性', '一致性', '规范性', '准确性', '时效性', '稳定性']

const helper = listColumnHelper<QualityScoreSummary['rules'][number]>()

/**
 * 质量评分面板：六维分 → 加权总分 → 等级。
 * 无终态运行的规则不计入均值（与执行器评分同口径）；无带评分规则时收成一行空态，
 * 不再渲染巨号占位与六根空条（2026-10-05 复评 P1-1）。
 */
export function QualityScorePanel({ compact = false }: { compact?: boolean }) {
  const navigate = usePortalNavigate()
  const query = useQuery(qualityScoreQuery())
  const summary = query.data

  const columns = helper.columns([
    helper.display({
      id: 'rule',
      header: '规则',
      cell: ({ row }) => {
        const typeLabel = row.original.ruleType ? (QUALITY_RULE_TYPE_LABELS[row.original.ruleType] ?? row.original.ruleType) : null
        return typeLabel
          ? (
            <Tooltip>
              <TooltipTrigger render={<span />}>{typeLabel}{row.original.targetColumn ? ` · ${row.original.targetColumn}` : ''}</TooltipTrigger>
              <TooltipPopup className="font-mono text-xs">{row.original.ruleId}</TooltipPopup>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<code className="font-mono text-label text-muted-foreground" />}>{row.original.ruleId}</TooltipTrigger>
              <TooltipPopup className="font-mono text-xs">{row.original.ruleId}</TooltipPopup>
            </Tooltip>
          )
      },
    }),
    helper.accessor('datasetId', { header: '数据集' }),
    helper.display({
      id: 'score',
      header: '得分',
      size: 100,
      meta: { align: 'right' },
      cell: ({ row }) => <strong className="tabular-nums">{row.original.score == null ? '—' : row.original.score.toFixed(1)}</strong>,
    }),
    helper.display({
      id: 'passed',
      header: '结果',
      size: 100,
      cell: ({ row }) => row.original.passed == null ? '—' : <Badge variant={row.original.passed ? 'success' : 'error'}>{row.original.passed ? '通过' : '未通过'}</Badge>,
    }),
  ])

  const noScoredRules = Boolean(summary && summary.rules.every((rule) => rule.score == null))

  return (
    <FramePanel className="p-0 overflow-clip">
      <FrameHeader className="px-[18px] pt-[18px] pb-3 flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title font-semibold tracking-[-0.2px]">
            质量评分
          </h2>
          <FrameDescription>按最近一次有效运行评分；未完成运行的规则不计入总分</FrameDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">{          <>
            {summary ? <span className="text-meta text-muted-foreground">标准更新：{formatDateTime(summary.standard.updatedAt)}</span> : null}
            <Button variant="outline" size="sm" onClick={() => navigate('/governance/quality/scoring')}><Settings2 size={13} />评分标准</Button>
          </>}</div>
      </FrameHeader>

      {query.isPending ? <LoadingBlock className="min-h-[160px]">正在读取质量评分…</LoadingBlock> : null}
      {query.isError ? (
        <div role="status" className="px-5 py-8 text-center">
          <p className="text-body-sm font-medium text-ink-soft">暂时无法读取质量评分</p>
          <p className="mt-1 text-label text-muted-foreground">请恢复控制面连接后重试，评分标准与历史结果不会以演示数据补位。</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>重试</Button>
        </div>
      ) : null}

      {summary && noScoredRules ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
          <Gauge size={22} className="text-muted-foreground" aria-hidden="true" />
          <strong className="text-body-sm text-ink-soft">等待首轮质量评分</strong>
          <p className="max-w-[520px] text-label leading-relaxed text-muted-foreground">完成质量规则复检后，将显示六个维度的得分、加权总分与等级。可先核对「评分标准」中的通过线与权重。</p>
        </div>
      ) : null}

      {summary && !noScoredRules ? (
        <>
          <div className="flex flex-wrap items-center gap-5 border-y border-line px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Gauge size={22} className="text-blue" />
              <strong className="text-metric leading-none font-semibold tracking-[-0.6px] text-blue">{summary.totalScore == null ? '—' : summary.totalScore.toFixed(1)}</strong>
              {summary.grade ? <Badge variant="outline">{`等级 ${summary.grade}`}</Badge> : null}
              {summary.totalScore != null ? (
                <Badge variant={summary.totalScore >= summary.standard.passScore ? 'success' : 'warning'}>{summary.totalScore >= summary.standard.passScore ? '达标' : '未达标'}</Badge>
              ) : null}
            </div>
            <div className={`grid flex-1 gap-x-5 gap-y-2 ${compact ? 'grid-cols-3' : 'grid-cols-6'} max-[1100px]:grid-cols-3`}>
              {QUALITY_DIMENSIONS.map((dimension) => {
                const item = summary.dimensions.find((entry) => entry.dimension === dimension)
                return (
                  <div key={dimension}>
                    <div className="flex items-center justify-between text-meta text-muted-foreground">
                      <span>{dimension}</span>
                      <span>{item ? item.score.toFixed(1) : '无运行'}</span>
                    </div>
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-line">
                      <i className="block h-full origin-left rounded-full bg-blue" style={{ transform: `scaleX(${Math.max(0, Math.min(100, item?.score ?? 0)) / 100})` }} />
                    </div>
                    <div className="mt-0.5 text-[9px] text-muted-foreground">{item ? `${item.ruleCount} 条规则` : '—'}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={summary.rules}
            getRowId={(rule) => rule.ruleId}
            empty={<p className="px-5 py-4 text-label text-muted-foreground">尚无带评分的规则运行</p>}
          />
        </>
      ) : null}
    </FramePanel>
  )
}

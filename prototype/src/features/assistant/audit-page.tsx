import { Badge } from '@/components/ui/badge'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel, PanelHead } from '../../components/kit/panel'
import { EmptyState } from '@/components/app/empty-state'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  AUDIT_OUTCOME_OPTIONS,
  downloadAssistantAuditCsv,
  type AssistantAuditView,
} from '../../data/assistantApi'
import { formatDateTime } from '../../data/domain'
import { usePortalNavigate } from '../../app/navigate'
import { assistantAuditsQuery } from './queries'

const PAGE_SIZE = 10
const helper = listColumnHelper<AssistantAuditView>()

const OUTCOME_ITEMS = AUDIT_OUTCOME_OPTIONS.map((option) => ({ value: option.value, label: option.label }))

/**
 * 问数审计（独立审计页）：跨问题检索、结局过滤、服务端分页与同口径 CSV 导出。
 * 审计不存结果行——只记录问题、服务、结局、行数与耗时。
 */
export function AssistantAuditPage() {
  const navigate = usePortalNavigate()
  const notify = useNotice()
  const [outcome, setOutcome] = useState('')
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)

  const auditsRequest = useQuery(assistantAuditsQuery(outcome, page, PAGE_SIZE))
  const audits = auditsRequest.data?.audits ?? []
  const total = auditsRequest.data?.total ?? 0

  async function exportCsv() {
    setExporting(true)
    try {
      await downloadAssistantAuditCsv(outcome)
      notify('问数审计 CSV 已开始下载（同当前过滤口径）')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '审计导出失败')
    } finally {
      setExporting(false)
    }
  }

  const columns = helper.columns([
    helper.display({ id: 'at', header: '时间', size: 140, cell: ({ row }) => <span className="text-label text-ink-soft">{formatDateTime(row.original.createdAt)}</span> }),
    helper.display({
      id: 'question',
      header: '问题 / 代码',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm text-ink">{row.original.questionText}</div>
          <div className="font-mono text-meta text-muted-foreground">{row.original.questionCode || '（未命中）'}</div>
        </div>
      ),
    }),
    helper.display({ id: 'service', header: '数据服务', size: 170, cell: ({ row }) => <span className="font-mono text-label text-muted-foreground">{row.original.serviceCode || '—'}</span> }),
    helper.display({
      id: 'outcome',
      header: '结局',
      size: 130,
      cell: ({ row }) => <Badge variant={row.original.outcome === 'ANSWERED' ? 'success' : 'warning'}>{AUDIT_OUTCOME_OPTIONS.find((option) => option.value === row.original.outcome)?.label ?? row.original.outcome}</Badge>,
    }),
    helper.display({ id: 'rows', header: '行数', size: 80, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-label">{row.original.rowCount}</span> }),
    helper.display({ id: 'elapsed', header: '耗时', size: 90, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-label">{row.original.elapsedMs} ms</span> }),
    helper.display({
      id: 'feedback',
      header: '反馈',
      size: 110,
      cell: ({ row }) => row.original.feedbackRating
        ? <Badge variant={row.original.feedbackRating === 'HELPFUL' ? 'success' : 'warning'}>{row.original.feedbackRating === 'HELPFUL' ? '有帮助' : '需改进'}</Badge>
        : <span className="text-label text-faint">—</span>,
    }),
    helper.display({ id: 'detail', header: '说明', cell: ({ row }) => <span className="text-label text-muted-foreground">{row.original.detail || '—'}</span> }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '数据应用' }, { label: '智能问数' }, { label: '问数审计' }]} trailing={auditsRequest.data ? <span>共 {total} 条</span> : null} />
      <PageHeading
        title="问数审计"
        description="跨问题检索与结局过滤；审计只记录问题、服务、结局、行数与耗时，不保存结果行。"
        actions={<Button variant="outline" onClick={() => navigate('/assistant/workspace')}>返回工作区</Button>}
      />

      <Panel>
        <PanelHead
          title="审计记录"
          count={total}
          description="按结局过滤；导出与当前过滤口径一致"
          actions={
            <div className="flex items-center gap-2">
              <Select
                items={OUTCOME_ITEMS}
                value={outcome}
                onValueChange={(next) => { setOutcome(next ?? ''); setPage(0) }}
              >
                <SelectTrigger aria-label="按结局过滤" className="w-auto min-w-none" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {OUTCOME_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button variant="outline" size="sm" disabled={exporting} onClick={() => void exportCsv()}>
                <Download size={13} />{exporting ? '导出中…' : '导出 CSV'}
              </Button>
            </div>
          }
        />
        {auditsRequest.isError ? (
          <EmptyState minHeight={200} title="审计暂不可读" description="请确认当前角色有治理权限后重试。" action={<Button variant="outline" onClick={() => void auditsRequest.refetch()}>重新读取</Button>} />
        ) : (
          <DataTable
            columns={columns}
            data={audits}
            getRowId={(audit) => audit.id}
            loading={auditsRequest.isPending}
            empty={<EmptyState minHeight={200} title="当前过滤下没有审计记录" description="问数执行后会在这里留痕；结局过滤可切换为全部。" />}
            footer={<TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} label="审计分页" />}
          />
        )}
      </Panel>
    </div>
  )
}

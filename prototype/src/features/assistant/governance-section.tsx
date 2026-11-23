import { Badge } from '@/components/ui/badge'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FlaskConical, Pencil, Play, Plus, ShieldQuestion } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Confirm } from '../../components/kit/overlay'
import { Panel, PanelHead } from '../../components/kit/panel'
import { EmptyState } from '../../components/kit/states'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  assistantQuestionAction,
  deleteAssistantQuestion,
  QUESTION_STATUS_LABEL,
  type AssistantAdminQuestionView,
} from '../../data/assistantApi'
import { workLinks } from '../../data/routes'
import { usePortalNavigate } from '../../app/navigate'
import { assistantKeys, assistantAdminQuestionsQuery } from './queries'

const PAGE_SIZE = 6

const helper = listColumnHelper<AssistantAdminQuestionView>()

/**
 * 问题治理区块：生命周期动作全部走控制面治理接口并留事件痕。
 * 发布须「最近一次成功试运行晚于最后编辑」；停用后从问数面消失并可重新起草。
 * 编辑、试运行、事件与审计各自进独立工作页，不再叠多层抽屉。
 */
export function AssistantGovernanceSection({ onNotice }: { onNotice: (message: string) => void }) {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const [page, setPage] = useState(0)
  const [pendingAction, setPendingAction] = useState<{ action: 'deprecate' | 'delete'; question: AssistantAdminQuestionView } | null>(null)

  const questionsRequest = useQuery(assistantAdminQuestionsQuery())
  const questions = questionsRequest.data ?? []

  const actionMutation = useMutation({
    mutationFn: ({ code, action }: { code: string; action: 'publish' | 'deprecate' | 'reopen' | 'delete' }) =>
      action === 'delete' ? deleteAssistantQuestion(code).then(() => ({ code, status: 'DELETED' })) : assistantQuestionAction(code, action),
    onMutate: ({ code }) => onNotice(`正在提交 ${code} 的状态变更…`),
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.adminQuestions() })
      void queryClient.invalidateQueries({ queryKey: assistantKeys.questions() })
      setPendingAction(null)
      notify({
        publish: `${result.code} 已发布`,
        deprecate: `${result.code} 已停用`,
        reopen: `${result.code} 已重新起草（草稿）`,
        delete: `${result.code} 草稿已删除`,
      }[variables.action])
    },
    onError: (cause) => {
      setPendingAction(null)
      notify(cause instanceof Error && cause.message ? cause.message : '问题状态变更失败')
    },
  })

  const pageCount = Math.max(1, Math.ceil(questions.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)

  const columns = helper.columns([
    helper.display({
      id: 'question',
      header: '问题 / 代码',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm font-medium text-ink">{row.original.question}</div>
          <div className="font-mono text-meta text-muted-foreground">{row.original.code}</div>
        </div>
      ),
    }),
    helper.display({
      id: 'status',
      header: '状态',
      size: 90,
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'PUBLISHED' ? 'success' : row.original.status === 'DRAFT' ? 'outline' : 'warning'}>
          {QUESTION_STATUS_LABEL[row.original.status] ?? row.original.status}
        </Badge>
      ),
    }),
    helper.display({ id: 'service', header: '数据服务', size: 170, cell: ({ row }) => <span className="font-mono text-label text-muted-foreground">{row.original.serviceCode}</span> }),
    helper.display({
      id: 'verified',
      header: '试运行验证',
      size: 130,
      cell: ({ row }) => row.original.verified
        ? <span className="text-label text-green">已验证（试运行通过）</span>
        : <span className="text-label text-muted-foreground">未验证</span>,
    }),
    helper.display({
      id: 'actions',
      header: '操作',
      size: 330,
      cell: ({ row }) => {
        const question = row.original
        const busy = actionMutation.isPending
        return (
          <div className="flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
            {question.status === 'DRAFT' ? (
              <>
                <Button variant="outline" size="sm" onClick={() => navigate(workLinks.assistantQuestion(question.code, 'definition'))}><Pencil size={12} />编辑</Button>
                <Button variant="outline" size="sm" onClick={() => navigate(workLinks.assistantQuestion(question.code, 'try'))}><FlaskConical size={12} />试运行</Button>
                <Button
                  size="sm"
                  disabled={!question.verified || busy}
                  title={question.verified ? '发布到问数面' : '需最近一次成功试运行晚于最后编辑'}
                  onClick={() => actionMutation.mutate({ code: question.code, action: 'publish' })}
                >
                  发布
                </Button>
                <Button size="sm" variant="destructive-outline" disabled={busy} onClick={() => setPendingAction({ action: 'delete', question })}>删除</Button>
              </>
            ) : null}
            {question.status === 'PUBLISHED' ? (
              <>
                <Button variant="outline" size="sm" onClick={() => navigate(workLinks.assistantQuestion(question.code, 'try'))}><FlaskConical size={12} />试运行</Button>
                <Button size="sm" variant="destructive-outline" disabled={busy} onClick={() => setPendingAction({ action: 'deprecate', question })}>停用</Button>
              </>
            ) : null}
            {question.status === 'DEPRECATED' ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => actionMutation.mutate({ code: question.code, action: 'reopen' })}><Play size={12} />重新起草</Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => navigate(workLinks.assistantQuestion(question.code, 'events'))}><ShieldQuestion size={12} />事件</Button>
          </div>
        )
      },
    }),
  ])

  return (
    <Panel>
      <PanelHead
        title="问题治理"
        count={questions.length}
        description="发布须最近一次成功试运行晚于最后一次编辑；停用后从问数面消失并可重新起草"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void questionsRequest.refetch()}>刷新</Button>
            <Button variant="outline" size="sm" onClick={() => navigate(workLinks.assistantAudit())}><Download size={13} />问数审计</Button>
            <Button size="sm" onClick={() => navigate(workLinks.assistantQuestionNew())}><Plus size={13} />新建问题（草稿）</Button>
          </>
        }
      />
      {questions.length > 0 ? (
        <dl className="mx-[18px] mb-2 grid grid-cols-3 gap-3 rounded-control border border-line bg-wash px-3 py-2" aria-label="问题发布概览">
          <Summary label="已发布" value={questions.filter((question) => question.status === 'PUBLISHED').length} />
          <Summary label="草稿" value={questions.filter((question) => question.status === 'DRAFT').length} />
          <Summary label="已停用" value={questions.filter((question) => question.status === 'DEPRECATED').length} />
        </dl>
      ) : null}
      {questionsRequest.isError ? (
        <p role="status" className="px-[18px] pb-3 text-label text-amber">治理清单暂不可达，请确认当前角色有治理权限后重新读取。</p>
      ) : null}
      <DataTable
        columns={columns}
        data={questions.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)}
        getRowId={(question) => question.code}
        rowLabel={(question) => question.question}
        loading={questionsRequest.isPending}
        onRowClick={(question) => navigate(workLinks.assistantQuestion(question.code, 'definition'))}
        empty={<EmptyState minHeight={200} title={questionsRequest.isError ? '治理清单尚未读取成功' : '当前租户暂无问题'} description={questionsRequest.isError ? '确认治理权限后可重试。' : '先创建草稿，完成试运行后发布。'} />}
        footer={<TablePagination page={currentPage} pageSize={PAGE_SIZE} total={questions.length} onPageChange={setPage} label="治理问题分页" />}
      />

      <Confirm
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open) setPendingAction(null) }}
        title={pendingAction?.action === 'delete' ? `删除草稿 ${pendingAction.question.code}` : `停用 ${pendingAction?.question.code ?? ''}`}
        description={pendingAction?.action === 'delete'
          ? '草稿将被删除；已产生的试运行与审计记录保留。此操作不可撤销。'
          : '问题将从问数面消失，用户无法再命中；之后可以重新起草。已产生的审计记录保留。'}
        object={pendingAction ? { name: pendingAction.question.question, meta: `${pendingAction.question.code} · ${pendingAction.question.serviceCode}` } : undefined}
        confirmLabel={pendingAction?.action === 'delete' ? '删除草稿' : '停用问题'}
        tone="destructive"
        busy={actionMutation.isPending}
        onConfirm={() => {
          if (!pendingAction) return
          actionMutation.mutate({ code: pendingAction.question.code, action: pendingAction.action })
        }}
      />
    </Panel>
  )
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="m-0 text-body-sm font-medium text-ink">{value}</dd>
    </div>
  )
}

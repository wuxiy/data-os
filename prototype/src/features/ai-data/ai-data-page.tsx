import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { AlertTriangle, Boxes, FlaskConical, MessageSquareText, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '../../components/kit/badge'
import { Button } from '../../components/kit/button'
import { FormField, FormGrid, FormNotice } from '../../components/kit/form'
import { CodeTextarea, Input, NativeSelect, SearchField } from '../../components/kit/input'
import { Dialog, DialogFooter, Confirm } from '../../components/kit/overlay'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Count, Panel, PanelHead } from '../../components/kit/panel'
import { Tabs, TabPanel } from '../../components/kit/popover'
import { EmptyState, LoadingBlock, Skeleton } from '../../components/kit/states'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  aiBuildJobStatusLabel,
  aiBuildStatusLabel,
  aiCertificationLabel,
  aiFeedbackTypeLabel,
  aiMetricLabel,
  createAIDataProduct,
  decideCertification,
  evaluateAIDataProduct,
  isBuildJobActive,
  lifecycleLabel,
  lifecycleMainChain,
  productTypeLabel,
  resolveFeedback,
  submitAIBuild,
  submitCertification,
  submitFeedback,
  transitionAIDataProduct,
  type AIDataProduct,
  type AIDataProductDetail,
  type AIDataProductLifecycle,
  type AIDataProductType,
  type AICertificationRequest,
  type AIEvaluationFeedbackItem,
  type AIBuildJob,
} from '../../data/aiDataApi'
import { formatDateTime } from '../../data/domain'
import { usePortalNavigate } from '../../app/navigate'
import {
  aiBuildsQuery,
  aiCertificationsQuery,
  aiDataKeys,
  aiFeedbackQuery,
  aiOverviewQuery,
  aiProductDetailQuery,
  aiProductsQuery,
} from './queries'

const PRODUCT_TYPES: AIDataProductType[] = ['RAG_CORPUS', 'TRAINING_DATASET', 'INSTRUCTION_DATASET', 'PREFERENCE_DATASET', 'FEATURE_DATASET', 'AGENT_CONTEXT', 'EVALUATION_DATASET', 'MULTIMODAL_DATASET']
const PAGE_SIZE = 8
const BUILD_POLL_MS = 2000
const BUILD_POLL_MAX = 150

export function nextLifecycleTarget(lifecycle: AIDataProductLifecycle): AIDataProductLifecycle | null {
  const index = lifecycleMainChain.indexOf(lifecycle)
  if (index < 0 || index >= lifecycleMainChain.length - 1) return null
  return lifecycleMainChain[index + 1]
}

function lifecycleTone(lifecycle: AIDataProductLifecycle): 'success' | 'warn' | 'neutral' | 'blue' {
  if (lifecycle === 'CERTIFIED' || lifecycle === 'SERVING') return 'success'
  if (lifecycle === 'DEPRECATED') return 'neutral'
  if (lifecycle === 'ASSESSED') return 'blue'
  return 'warn'
}

/**
 * AI Data：产品清单 + 产品详情（概览/版本与构建/认证/反馈）。
 * 生命周期主链 DRAFT → CURATED → ASSESSED → CERTIFIED → SERVING 由人工推进；
 * CERTIFIED 只能经审批流转；构建任务 2 秒轮询、最多 150 次，超窗仍按「执行中」提示。
 */
export function AIDataPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const search = useSearch({ strict: false }) as { product?: string }

  const [keyword, setKeyword] = useState('')
  const [lifecycleFilter, setLifecycleFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState(search.product ?? '')
  const [tab, setTab] = useState<'overview' | 'versions' | 'certification' | 'feedback'>('overview')
  const [createOpen, setCreateOpen] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'saving'>('idle')
  const [form, setForm] = useState({ name: '', type: 'RAG_CORPUS' as AIDataProductType, owner: '', workflow: 'ai-ready', source: '' })
  const [createError, setCreateError] = useState<string | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackQuestion, setFeedbackQuestion] = useState('')
  const [deprecateTarget, setDeprecateTarget] = useState<AIDataProduct | null>(null)
  const [demoteTarget, setDemoteTarget] = useState<AIDataProduct | null>(null)

  const productsRequest = useQuery(aiProductsQuery())
  const overviewRequest = useQuery(aiOverviewQuery())
  const products = productsRequest.data ?? []

  const visible = products.filter((product) => {
    const text = keyword.trim().toLowerCase()
    return (!lifecycleFilter || product.lifecycle === lifecycleFilter)
      && (!text || `${product.name}${product.owner}${product.currentVersion}`.toLowerCase().includes(text))
  })
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const selected = products.find((product) => product.id === selectedId) ?? visible[currentPage * PAGE_SIZE] ?? products[0] ?? null

  useEffect(() => {
    if (!selected) return
    if (search.product === selected.id) return
    navigate(`/ai-data?product=${encodeURIComponent(selected.id)}`, { replace: true })
  }, [navigate, search.product, selected])

  const detailRequest = useQuery(aiProductDetailQuery(selected?.id ?? ''))
  const certificationsRequest = useQuery({ ...aiCertificationsQuery(selected?.id ?? ''), enabled: Boolean(selected) && tab === 'certification' })
  const feedbackRequest = useQuery({ ...aiFeedbackQuery(selected?.id ?? ''), enabled: Boolean(selected) && tab === 'feedback' })
  const buildsRequest = useQuery({ ...aiBuildsQuery(selected?.id ?? ''), enabled: Boolean(selected) && tab === 'versions' })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: aiDataKeys.all })
  }

  const createProduct = useMutation({
    mutationFn: () => createAIDataProduct({ name: form.name.trim(), type: form.type, owner: form.owner.trim(), workflow: form.workflow.trim(), source: form.source.trim() }),
    onSuccess: (product) => {
      invalidate()
      setCreateOpen(false)
      setSelectedId(product.id)
      setForm({ name: '', type: form.type, owner: '', workflow: 'ai-ready', source: '' })
      notify(`已创建 AI Data Product：${product.name}（${product.currentVersion}）`)
    },
    onError: (cause) => setCreateError(cause instanceof Error ? cause.message : 'AI Data 产品创建失败'),
  })

  const transition = useMutation({
    mutationFn: ({ product, target }: { product: AIDataProduct; target: AIDataProductLifecycle }) => transitionAIDataProduct(product.id, target),
    onSuccess: (_data, variables) => {
      invalidate()
      setDeprecateTarget(null)
      setDemoteTarget(null)
      notify(variables.target === 'DEPRECATED'
        ? `${variables.product.name} 已弃用`
        : variables.target === 'ASSESSED'
          ? `${variables.product.name} 已撤下重评估（原服务停止）`
          : `${variables.product.name} 已流转到「${lifecycleLabel[variables.target]}」`)
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '生命周期流转失败'),
  })

  const evaluate = useMutation({
    mutationFn: (product: AIDataProduct) => evaluateAIDataProduct(product.id),
    onSuccess: (report) => {
      invalidate()
      notify(`评测完成：MRR ${report.mrr?.toFixed?.(2) ?? '—'} · Recall@5 ${report.retrieval_recall_at_5?.toFixed?.(2) ?? '—'}（已并入版本报告）`)
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '评测失败'),
  })

  const build = useMutation({
    mutationFn: (product: AIDataProduct) => submitAIBuild(product.id),
    onSuccess: () => {
      invalidate()
      notify('构建任务已投递（QUEUED），进度自动刷新')
      setTab('versions')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '构建任务投递失败'),
  })

  const submitCert = useMutation({
    mutationFn: (product: AIDataProduct) => submitCertification(product.id),
    onSuccess: () => {
      invalidate()
      notify('认证审批已提交（等待审批）')
      setTab('certification')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '提交失败'),
  })

  const decide = useMutation({
    mutationFn: ({ request, approve }: { request: AICertificationRequest; approve: boolean }) =>
      decideCertification(request.id, approve, approve ? '同意认证' : '退回：证据不足'),
    onSuccess: (_data, variables) => {
      invalidate()
      notify(variables.approve ? '已批准，产品进入「已认证」' : '已退回，保持「已评估」')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '审批失败'),
  })

  const feedbackSubmit = useMutation({
    mutationFn: ({ product, question }: { product: AIDataProduct; question: string }) => submitFeedback(product.id, { question, metric: 'faithfulness', feedbackType: 'CHUNK_QUALITY' }),
    onSuccess: () => {
      invalidate()
      setFeedbackOpen(false)
      setFeedbackQuestion('')
      notify('反馈已提交（进入 Learning Plane 队列）')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '反馈提交失败'),
  })

  const feedbackResolve = useMutation({
    mutationFn: ({ id, consume }: { id: string; consume: boolean }) => resolveFeedback(id, consume, consume ? '已吸收进下一版本改进' : '证据不足驳回'),
    onSuccess: (_data, variables) => {
      invalidate()
      notify(variables.consume ? '反馈已标记吸收（由人工触发新版本与语料调整）' : '反馈已驳回')
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '反馈处置失败'),
  })

  const product = detailRequest.data?.product ?? selected
  const versions = detailRequest.data?.versions ?? []
  const latestVersion = versions[0]
  const activeBuild = (buildsRequest.data ?? []).find(isBuildJobActive) ?? null

  // 构建观察：2 秒轮询、同一任务最多 150 次；超窗不冒充失败，仍按「执行中」提示。
  const [buildTicks, setBuildTicks] = useState(0)
  const polledJobRef = useRef('')
  useEffect(() => {
    if (!activeBuild) {
      polledJobRef.current = ''
      return
    }
    if (polledJobRef.current !== activeBuild.id) {
      polledJobRef.current = activeBuild.id
      setBuildTicks(0)
      return
    }
    if (buildTicks >= BUILD_POLL_MAX) return
    const timer = window.setTimeout(() => {
      setBuildTicks((count) => count + 1)
      void buildsRequest.refetch()
    }, BUILD_POLL_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 轮询以任务键与计数为触发源
  }, [activeBuild?.id, activeBuild?.status, buildTicks])
  const buildPollState = { exhausted: Boolean(activeBuild) && buildTicks >= BUILD_POLL_MAX }

  const productHelper = listColumnHelper<AIDataProduct>()
  const productColumns = productHelper.columns([
    productHelper.display({
      id: 'name',
      header: '产品',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm font-medium text-ink">{row.original.name}</div>
          <div className="text-meta text-muted">{productTypeLabel[row.original.productType]} · {row.original.currentVersion}</div>
        </div>
      ),
    }),
    productHelper.display({ id: 'lifecycle', header: '生命周期', size: 110, cell: ({ row }) => <Badge tone={lifecycleTone(row.original.lifecycle)}>{lifecycleLabel[row.original.lifecycle]}</Badge> }),
    productHelper.display({ id: 'owner', header: '负责人', size: 110, cell: ({ row }) => row.original.owner }),
    productHelper.display({ id: 'updated', header: '更新', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.updatedAt)}</span> }),
  ])

  const versionHelper = listColumnHelper<AIDataProductDetail['versions'][number]>()
  const versionColumns = versionHelper.columns([
    versionHelper.display({ id: 'version', header: '版本', size: 110, cell: ({ row }) => <span className="font-mono text-label">{row.original.versionSn}</span> }),
    versionHelper.display({
      id: 'build',
      header: '构建状态',
      size: 120,
      cell: ({ row }) => <Badge tone={row.original.buildStatus === 'FAILED' ? 'danger' : row.original.buildStatus === 'RUNNING' ? 'warn' : row.original.buildStatus === 'REGISTERED' ? 'neutral' : 'success'}>{aiBuildStatusLabel[row.original.buildStatus] ?? row.original.buildStatus}</Badge>,
    }),
    versionHelper.display({ id: 'overall', header: '就绪度', size: 90, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-label">{row.original.readiness?.overall != null ? row.original.readiness.overall.toFixed(2) : '—'}</span> }),
    versionHelper.display({
      id: 'certification',
      header: '认证',
      size: 110,
      cell: ({ row }) => row.original.readiness?.certification
        ? <Badge tone={row.original.readiness.certification === 'BLOCKED' ? 'danger' : row.original.readiness.certification === 'CANDIDATE' ? 'blue' : 'warn'}>{aiCertificationLabel[row.original.readiness.certification] ?? row.original.readiness.certification}</Badge>
        : <span className="text-label text-faint">—</span>,
    }),
    versionHelper.display({ id: 'recipe', header: 'Recipe', size: 140, cell: ({ row }) => <span className="font-mono text-meta text-muted">{row.original.recipeRef ?? '—'}</span> }),
    versionHelper.display({ id: 'commit', header: 'Git Commit', size: 110, cell: ({ row }) => <span className="font-mono text-meta text-muted">{row.original.gitCommit ? row.original.gitCommit.slice(0, 8) : '—'}</span> }),
    versionHelper.display({ id: 'created', header: '创建时间', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.createdAt)}</span> }),
  ])

  const certHelper = listColumnHelper<AICertificationRequest>()
  const certColumns = certHelper.columns([
    certHelper.display({ id: 'status', header: '状态', size: 100, cell: ({ row }) => <Badge tone={row.original.decision === 'APPROVED' ? 'success' : row.original.decision === 'REJECTED' ? 'danger' : 'warn'}>{row.original.decision === 'APPROVED' ? '已批准' : row.original.decision === 'REJECTED' ? '已退回' : '待审批'}</Badge> }),
    certHelper.display({ id: 'version', header: '版本', size: 110, cell: ({ row }) => <span className="font-mono text-label">{row.original.versionSn}</span> }),
    certHelper.display({ id: 'note', header: '说明', cell: ({ row }) => <span className="text-label text-muted">{row.original.decisionNote || `就绪度 ${row.original.readinessOverall.toFixed(2)} · ${aiCertificationLabel[row.original.certification] ?? row.original.certification}`}</span> }),
    certHelper.display({ id: 'at', header: '提交时间', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.createdAt)}</span> }),
    certHelper.display({
      id: 'actions',
      header: '审批',
      size: 170,
      cell: ({ row }) => row.original.decision === 'PENDING'
        ? (
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ request: row.original, approve: true })}>批准</Button>
            <Button size="sm" variant="danger-outline" disabled={decide.isPending} onClick={() => decide.mutate({ request: row.original, approve: false })}>退回</Button>
          </div>
        )
        : <span className="text-label text-faint">—</span>,
    }),
  ])

  const feedbackHelper = listColumnHelper<AIEvaluationFeedbackItem>()
  const feedbackColumns = feedbackHelper.columns([
    feedbackHelper.display({ id: 'question', header: '失败样本', cell: ({ row }) => <span className="text-label text-ink-soft">{row.original.question}</span> }),
    feedbackHelper.display({ id: 'metric', header: '指标', size: 110, cell: ({ row }) => <span className="text-label">{row.original.metric ? (aiMetricLabel[row.original.metric] ?? row.original.metric) : '—'}</span> }),
    feedbackHelper.display({ id: 'type', header: '类型', size: 130, cell: ({ row }) => <Badge>{aiFeedbackTypeLabel[row.original.feedbackType] ?? row.original.feedbackType}</Badge> }),
    feedbackHelper.display({ id: 'status', header: '状态', size: 100, cell: ({ row }) => <Badge tone={row.original.status === 'CONSUMED' ? 'success' : row.original.status === 'DISMISSED' ? 'neutral' : 'warn'}>{row.original.status === 'CONSUMED' ? '已吸收' : row.original.status === 'DISMISSED' ? '已驳回' : '待处置'}</Badge> }),
    feedbackHelper.display({
      id: 'actions',
      header: '处置',
      size: 170,
      cell: ({ row }) => row.original.status === 'CREATED'
        ? (
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" disabled={feedbackResolve.isPending} onClick={() => feedbackResolve.mutate({ id: row.original.id, consume: true })}>吸收</Button>
            <Button size="sm" variant="quiet" disabled={feedbackResolve.isPending} onClick={() => feedbackResolve.mutate({ id: row.original.id, consume: false })}>驳回</Button>
          </div>
        )
        : <span className="text-label text-faint">—</span>,
    }),
  ])

  const buildHelper = listColumnHelper<AIBuildJob>()
  const buildColumns = buildHelper.columns([
    buildHelper.display({ id: 'status', header: '任务状态', size: 110, cell: ({ row }) => <Badge tone={row.original.status === 'FAILED' ? 'danger' : row.original.status === 'SUCCEEDED' ? 'success' : 'warn'}>{aiBuildJobStatusLabel[row.original.status] ?? row.original.status}</Badge> }),
    buildHelper.display({ id: 'version', header: '版本', size: 110, cell: ({ row }) => <span className="font-mono text-label">{row.original.versionSn}</span> }),
    buildHelper.display({ id: 'recipe', header: 'Recipe', size: 150, cell: ({ row }) => <span className="font-mono text-meta text-muted">{row.original.recipeRef ?? '—'}</span> }),
    buildHelper.display({ id: 'at', header: '投递', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.createdAt)}</span> }),
    buildHelper.display({ id: 'error', header: '错误', cell: ({ row }) => <span className="text-label text-red">{row.original.error || '—'}</span> }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '数据应用' }, { label: 'AI Data' }]} trailing={overviewRequest.data ? <span>{overviewRequest.data.products} 产品 · {overviewRequest.data.certified} 已认证 · 平均就绪度 {overviewRequest.data.averageOverall?.toFixed?.(2) ?? '—'}</span> : null} />
      <PageHeading
        title="AI Data"
        description="面向 AI 使用的数据产品：构建、评测、人工认证与发布。"
        actions={
          <>
            <Button onClick={() => void productsRequest.refetch()} disabled={productsRequest.isFetching}><RefreshCw size={14} className={productsRequest.isFetching ? 'animate-spin' : undefined} />刷新</Button>
            <Button variant="primary" onClick={() => { setCreateError(null); setCreateOpen(true) }}><Plus size={14} />新建 AI 数据产品</Button>
          </>
        }
      />

      {productsRequest.isPending ? <LoadingBlock>正在读取 AI 数据产品…</LoadingBlock> : null}
      {productsRequest.isError ? (
        <Panel>
          <EmptyState minHeight={220} icon={<Boxes />} title="AI Data 服务暂不可用" description="暂时无法读取产品清单与就绪度。请恢复 ai-ready-service 后重试。" action={<Button onClick={() => void productsRequest.refetch()}>重新读取</Button>} />
        </Panel>
      ) : null}

      {productsRequest.isSuccess ? (
        <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
          <Panel className="flex flex-col">
            <div className="flex items-center justify-between px-[18px] pt-3 pb-2">
              <h2 className="text-title font-semibold">产品目录<Count>{visible.length}</Count></h2>
            </div>
            <div className="px-[18px] pb-2"><SearchField value={keyword} onValueChange={(value) => { setKeyword(value); setPage(0) }} placeholder="搜索产品名称/负责人" className="w-full" /></div>
            <div className="px-[18px] pb-2">
              <NativeSelect aria-label="生命周期筛选" className="w-auto" value={lifecycleFilter} onChange={(event) => { setLifecycleFilter(event.target.value); setPage(0) }}>
                <option value="">全部生命周期</option>
                {Object.entries(lifecycleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </div>
            <ul className="m-0 min-h-0 flex-1 list-none px-2 pb-2">
              {visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((item) => {
                const active = item.id === product?.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setSelectedId(item.id); setTab('overview') }}
                      className={`mb-1 w-full rounded-control px-2.5 py-2 text-left ${active ? 'bg-blue-soft' : 'hover:bg-wash'}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-body-sm text-ink-soft">{item.name}</span>
                        <Badge tone={lifecycleTone(item.lifecycle)}>{lifecycleLabel[item.lifecycle]}</Badge>
                      </span>
                      <span className="mt-0.5 block text-meta text-muted">{productTypeLabel[item.productType]} · {item.currentVersion}</span>
                    </button>
                  </li>
                )
              })}
              {visible.length === 0 ? <li className="px-3 py-6 text-center text-label text-muted">当前过滤下没有产品。</li> : null}
            </ul>
            <div className="border-t border-line px-2">
              <TablePagination compact page={currentPage} pageSize={PAGE_SIZE} total={visible.length} onPageChange={setPage} label="AI 产品分页" className="border-t-0 px-1" />
            </div>
          </Panel>

          <Panel>
            {!product ? (
              <EmptyState minHeight={320} icon={<Boxes />} title="还没有 AI 数据产品" description="创建产品后开始登记版本、构建与评测。" action={<Button onClick={() => setCreateOpen(true)}>新建 AI 数据产品</Button>} />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-chip bg-wash px-1.5 py-0.5 text-meta text-muted">{productTypeLabel[product.productType]}</span>
                      <Badge tone={lifecycleTone(product.lifecycle)}>{lifecycleLabel[product.lifecycle]}</Badge>
                    </div>
                    <h2 className="mt-1.5 text-subject font-semibold text-ink">{product.name}</h2>
                    <p className="mt-1 text-label text-muted">当前版本 {product.currentVersion} · 负责人 {product.owner} · 工作流 {product.workflowType}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {nextLifecycleTarget(product.lifecycle) ? (
                      <Button size="sm" onClick={() => transition.mutate({ product, target: nextLifecycleTarget(product.lifecycle) as AIDataProductLifecycle })}>
                        推进到「{lifecycleLabel[nextLifecycleTarget(product.lifecycle) as AIDataProductLifecycle]}」
                      </Button>
                    ) : null}
                    {product.lifecycle === 'ASSESSED' ? (
                      <Button size="sm" onClick={() => submitCert.mutate(product)} disabled={submitCert.isPending}>提交认证审批</Button>
                    ) : null}
                    <Button size="sm" onClick={() => build.mutate(product)} disabled={build.isPending || Boolean(activeBuild)}>{activeBuild ? '构建中…' : '构建'}</Button>
                    <Button size="sm" onClick={() => evaluate.mutate(product)} disabled={evaluate.isPending}><FlaskConical size={13} />评测</Button>
                    <Button size="sm" onClick={() => setFeedbackOpen(true)}><MessageSquareText size={13} />反馈失败样本</Button>
                    {product.lifecycle !== 'DEPRECATED' ? (
                      <>
                        {product.lifecycle === 'SERVING' ? <Button size="sm" variant="danger-outline" onClick={() => setDemoteTarget(product)}>撤下重评估</Button> : null}
                        <Button size="sm" variant="danger-outline" onClick={() => setDeprecateTarget(product)}>弃用</Button>
                      </>
                    ) : null}
                  </div>
                </div>

                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as typeof tab)}
                  items={[
                    { value: 'overview', label: '概览' },
                    { value: 'versions', label: '版本与构建', count: versions.length },
                    { value: 'certification', label: '认证审批', count: certificationsRequest.data?.length },
                    { value: 'feedback', label: '评测反馈', count: feedbackRequest.data?.length },
                  ]}
                >
                  <TabPanel value="overview" className="px-5 py-4">
                    {detailRequest.isPending ? <Skeleton rows={4} /> : null}
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      {lifecycleMainChain.map((step) => (
                        <span key={step} className={`rounded-chip border px-2 py-0.5 text-meta ${step === product.lifecycle ? 'border-blue-line bg-blue-soft text-blue' : 'border-line bg-paper text-muted'}`}>
                          {lifecycleLabel[step]}
                        </span>
                      ))}
                    </div>
                    <FormNotice icon={<ShieldCheck />}>
                      CERTIFIED 只能经人工审批流转；就绪度与评测结论来自 ai-ready-service，未通过不冒充通过。
                    </FormNotice>
                    <dl className="grid grid-cols-4 gap-4 rounded-control border border-line bg-wash px-3 py-2.5 max-[1100px]:grid-cols-2">
                      <Fact label="最新版本" value={latestVersion?.versionSn ?? '—'} />
                      <Fact label="构建状态" value={latestVersion ? (aiBuildStatusLabel[latestVersion.buildStatus] ?? latestVersion.buildStatus) : '—'} />
                      <Fact label="就绪度" value={latestVersion?.readiness?.overall != null ? latestVersion.readiness.overall.toFixed(2) : '—'} />
                      <Fact label="认证档位" value={latestVersion?.readiness?.certification ? (aiCertificationLabel[latestVersion.readiness.certification] ?? latestVersion.readiness.certification) : '—'} />
                    </dl>
                    {latestVersion?.readiness?.evaluation ? (
                      <dl className="mt-3 grid grid-cols-3 gap-4 text-label max-[1100px]:grid-cols-2">
                        <Fact label="Recall@5" value={latestVersion.readiness.evaluation.retrievalRecallAt5?.toFixed(2) ?? '—'} />
                        <Fact label="Precision@5" value={latestVersion.readiness.evaluation.precisionAt5?.toFixed(2) ?? '—'} />
                        <Fact label="MRR" value={latestVersion.readiness.evaluation.mrr?.toFixed(2) ?? '—'} />
                        <Fact label="引用正确性" value={latestVersion.readiness.evaluation.citationCorrectness?.toFixed(2) ?? '—'} />
                        <Fact label="忠实度" value={latestVersion.readiness.evaluation.faithfulness?.toFixed(2) ?? '—'} />
                        <Fact label="评测集规模" value={String(latestVersion.readiness.evaluation.evalSetSize ?? '—')} />
                      </dl>
                    ) : <p className="mt-3 text-label text-muted">还没有评测报告；执行「评测」后写入版本报告。</p>}
                  </TabPanel>

                  <TabPanel value="versions" className="px-0 py-2">
                    <DataTable
                      columns={versionColumns}
                      data={versions}
                      getRowId={(version) => version.id}
                      loading={detailRequest.isPending}
                      empty={<EmptyState minHeight={160} title="还没有版本" description="首次构建会登记版本与就绪度报告。" />}
                    />
                    <div className="border-t border-line px-5 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <h3 className="text-label font-medium text-ink-soft">构建任务</h3>
                        {activeBuild ? <Badge tone="warn">执行中 · 每 2 秒刷新</Badge> : null}
                        {buildPollState.exhausted ? <Badge tone="neutral">超过观察窗口，仍在执行</Badge> : null}
                      </div>
                      <DataTable columns={buildColumns} data={buildsRequest.data ?? []} getRowId={(job) => job.id} loading={buildsRequest.isPending} empty={<p className="py-2 text-label text-muted">还没有构建任务。</p>} />
                    </div>
                  </TabPanel>

                  <TabPanel value="certification" className="px-0 py-2">
                    <DataTable columns={certColumns} data={certificationsRequest.data ?? []} getRowId={(request) => request.id} loading={certificationsRequest.isPending} empty={<EmptyState minHeight={160} title="还没有认证审批" description="问题在「已评估」状态可提交认证审批。" />} />
                  </TabPanel>

                  <TabPanel value="feedback" className="px-0 py-2">
                    <DataTable columns={feedbackColumns} data={feedbackRequest.data ?? []} getRowId={(item) => item.id} loading={feedbackRequest.isPending} empty={<EmptyState minHeight={160} title="还没有评测反馈" description="失败样本进入 Learning Plane 队列，由人工决定吸收或驳回。" />} />
                  </TabPanel>
                </Tabs>
              </>
            )}
          </Panel>
        </div>
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建 AI 数据产品"
        description="产品创建后为草稿；构建、评测与认证按主链推进。"
        width={540}
        dirty={Boolean(form.name.trim() || form.owner.trim()) && submitState !== 'saving'}
        footer={
          <DialogFooter note="创建后为草稿，不对外提供服务">
            <Button onClick={() => setCreateOpen(false)} disabled={createProduct.isPending}>取消</Button>
            <Button
              variant="primary"
              disabled={createProduct.isPending || !form.name.trim() || !form.owner.trim()}
              onClick={() => { setCreateError(null); createProduct.mutate() }}
            >
              {createProduct.isPending ? '创建中…' : '创建产品'}
            </Button>
          </DialogFooter>
        }
      >
        <FormGrid>
          <FormField label="产品名称" required htmlFor="ai-name"><Input id="ai-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：门诊病历 RAG 语料" /></FormField>
          <FormField label="产品类型" htmlFor="ai-type">
            <NativeSelect id="ai-type" className="min-h-[35px]" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as AIDataProductType })}>
              {PRODUCT_TYPES.map((type) => <option key={type} value={type}>{productTypeLabel[type]}</option>)}
            </NativeSelect>
          </FormField>
          <FormField label="负责人" required htmlFor="ai-owner"><Input id="ai-owner" value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="data-team" /></FormField>
          <FormField label="工作流" htmlFor="ai-workflow"><Input id="ai-workflow" value={form.workflow} onChange={(event) => setForm({ ...form, workflow: event.target.value })} placeholder="ai-ready" /></FormField>
        </FormGrid>
        <FormField label="数据来源说明" htmlFor="ai-source"><Input id="ai-source" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="例如：ods_ep 处方表 + 标准值域" /></FormField>
        {createError ? <p role="alert" className="mt-2 text-body-sm text-red">{createError}</p> : null}
      </Dialog>

      <Dialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        title="反馈失败样本"
        description="失败样本进入 Learning Plane 队列；是否吸收由人工决定，不自动改版。"
        width={540}
        dirty={Boolean(feedbackQuestion.trim()) && !feedbackSubmit.isPending}
        footer={
          <DialogFooter note="提交后进入队列，不改变当前版本">
            <Button onClick={() => setFeedbackOpen(false)} disabled={feedbackSubmit.isPending}>取消</Button>
            <Button variant="primary" disabled={feedbackSubmit.isPending || !feedbackQuestion.trim() || !product} onClick={() => product && feedbackSubmit.mutate({ product, question: feedbackQuestion.trim() })}>
              {feedbackSubmit.isPending ? '提交中…' : '提交反馈'}
            </Button>
          </DialogFooter>
        }
      >
        <FormField label="问题描述" required htmlFor="ai-feedback">
          <CodeTextarea id="ai-feedback" className="min-h-[120px]" value={feedbackQuestion} onChange={(event) => setFeedbackQuestion(event.target.value)} placeholder="例如：检索命中错误分块，引用与答案不一致" />
        </FormField>
      </Dialog>

      <Confirm
        open={deprecateTarget !== null}
        onOpenChange={(open) => { if (!open) setDeprecateTarget(null) }}
        title={`弃用 ${deprecateTarget?.name ?? ''}`}
        description="产品将退出服务并标记弃用；已产生的版本、评测与认证记录保留。此操作不可撤销。"
        object={deprecateTarget ? { name: deprecateTarget.name, meta: `${productTypeLabel[deprecateTarget.productType]} · ${deprecateTarget.currentVersion}` } : undefined}
        confirmLabel="弃用产品"
        tone="destructive"
        busy={transition.isPending}
        onConfirm={() => deprecateTarget && transition.mutate({ product: deprecateTarget, target: 'DEPRECATED' })}
      />

      <Confirm
        open={demoteTarget !== null}
        onOpenChange={(open) => { if (!open) setDemoteTarget(null) }}
        title={`撤下 ${demoteTarget?.name ?? ''}`}
        description="产品将停止服务并回到「已评估」；重新提交认证审批通过后可再上架。"
        object={demoteTarget ? { name: demoteTarget.name, meta: `当前 ${demoteTarget.currentVersion}` } : undefined}
        hint="撤下会中断正在使用该产品的调用方。"
        confirmLabel="撤下重评估"
        tone="destructive"
        busy={transition.isPending}
        onConfirm={() => demoteTarget && transition.mutate({ product: demoteTarget, target: 'ASSESSED' })}
      />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta text-muted">{label}</dt>
      <dd className="m-0 text-body-sm text-ink-soft">{value}</dd>
    </div>
  )
}

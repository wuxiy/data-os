import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowRightLeft,
  CircleAlert,
  ClipboardCheck,
  GitCompareArrows,
  History,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { CodeTextarea } from '@/components/app/code-textarea'
import { EmptyState } from '@/components/app/empty-state'
import { FormGrid } from '@/components/app/form-grid'
import { LoadingBlock, LoadingInline } from '@/components/app/loading'
import { useNotice } from '@/components/app/notice'
import { SearchField } from '@/components/app/search-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { FrameDescription, FrameHeader, FramePanel } from '@/components/ui/frame'
import { Input } from '@/components/ui/input'
import { RadioGroupPrimitive, RadioPrimitive } from '@/components/ui/radio-group'
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

import { usePortalNavigate } from '../../app/navigate'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { DataTable, listColumnHelper, TablePagination } from '../../components/table/data-table'
import { actorLabel, formatDateTime, standardEventLabel, transformLabel } from '../../data/domain'
import {
  activateMappingVersion,
  createMappingSet,
  createMappingVersion,
  fetchMappingImpact,
  importMappingItems,
  type ImportReport,
  type MappingDetailView,
  type MappingItemView,
  type MappingSetListItem,
  retireMappingVersion,
  rollbackMapping,
  submitMappingVersion,
  updateMappingVersion,
  validateMappingVersion,
} from '../../data/mappingApi'
import { fetchStandards } from '../../data/standardsApi'
import { governanceKeys, mappingCoverageQuery, mappingDetailQuery, mappingSetsQuery } from './queries'

const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', IN_REVIEW: '评审中', ACTIVE: '已生效', RETIRED: '已停用' }

function statusTone(status: string): 'success' | 'warning' | 'outline' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'IN_REVIEW') return 'warning'
  return 'outline'
}

const setHelper = listColumnHelper<MappingSetListItem>()
const itemHelper = listColumnHelper<MappingItemView>()

/**
 * 标准映射：源字段对齐院级标准；草稿 → 验证 → 评审 → 生效，生效受同 checksum PASS 证据门控。
 * 生效版本只读，变更走新草稿；回退指向曾生效版本。
 */
export function MappingPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()

  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ code: '', name: '', sourceAsset: '', dataset: '', standardId: '' })
  const [importBody, setImportBody] = useState('')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [itemsDraft, setItemsDraft] = useState('')
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof fetchMappingImpact>> | null>(null)
  const [rollbackTo, setRollbackTo] = useState('')
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setsRequest = useQuery(mappingSetsQuery(keyword))
  const coverageRequest = useQuery(mappingCoverageQuery())
  const detailRequest = useQuery(mappingDetailQuery(selectedId, versionId))
  const publishedStandards = useQuery({
    queryKey: ['governance', 'standards', '', 'PUBLISHED'],
    queryFn: ({ signal }) => fetchStandards(signal, '', 'PUBLISHED'),
    staleTime: 60_000,
  })

  const sets = setsRequest.data ?? []
  const detail = detailRequest.data

  useEffect(() => {
    if (!selectedId && sets.length > 0) setSelectedId(sets[0].id)
  }, [sets, selectedId])

  useEffect(() => {
    if (detailRequest.data && !versionId) setVersionId(detailRequest.data.version.id)
  }, [detailRequest.data, versionId])

  useEffect(() => {
    setImportBody('')
    setImportReport(null)
    setItemsDraft('')
    setImpact(null)
    setRollbackTo('')
  }, [detailRequest.data?.version.id])

  const pageCount = Math.max(1, Math.ceil(sets.length / 8))
  const currentPage = Math.min(page, pageCount - 1)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...governanceKeys.all, 'mappings'] })
    void queryClient.invalidateQueries({ queryKey: [...governanceKeys.all, 'mapping', selectedId] })
    void queryClient.invalidateQueries({ queryKey: governanceKeys.mappingCoverage() })
  }

  const versionAction = useMutation({
    mutationFn: ({ action, id }: { action: 'submit' | 'validate' | 'activate' | 'retire'; id: string }) => {
      if (action === 'submit') return submitMappingVersion(id)
      if (action === 'validate') return validateMappingVersion(id)
      if (action === 'activate') return activateMappingVersion(id)
      return retireMappingVersion(id)
    },
    onSuccess: (_data, variables) => {
      invalidate()
      notify({ submit: '已提交评审', validate: '聚合验证已完成，结果写入证据', activate: '版本已生效', retire: '版本已停用' }[variables.action])
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '映射版本操作失败'),
  })

  const createSet = useMutation({
    mutationFn: () => createMappingSet({ ...createForm, items: [] }),
    onSuccess: (next) => {
      invalidate()
      setCreateOpen(false)
      setCreateForm({ code: '', name: '', sourceAsset: '', dataset: '', standardId: '' })
      setSelectedId(next.set.id)
      notify('映射集已创建（空草稿），请导入映射项')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '映射集创建失败'),
  })

  const createVersion = useMutation({
    mutationFn: () => createMappingVersion(selectedId),
    onSuccess: (next) => {
      invalidate()
      setVersionId(next.version.id)
      notify('已基于当前版本新建草稿')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '新建映射版本失败'),
  })

  const importItems = useMutation({
    mutationFn: (dryRun: boolean) => importMappingItems(detail?.version.id ?? '', importBody, dryRun),
    onSuccess: (report) => {
      setImportReport(report)
      if (report.applied) {
        invalidate()
        notify('映射项导入完成，checksum 已重算')
      }
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '映射项导入失败'),
  })

  const replaceItems = useMutation({
    mutationFn: async () => {
      const parsed: unknown = JSON.parse(itemsDraft)
      if (!Array.isArray(parsed)) throw new Error('映射项必须是 JSON 数组')
      return updateMappingVersion(detail?.version.id ?? '', { items: parsed })
    },
    onSuccess: () => {
      invalidate()
      setItemsDraft('')
      notify('映射项已整体替换并重算 checksum')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '映射项替换失败'),
  })

  const rollback = useMutation({
    mutationFn: () => rollbackMapping(selectedId, rollbackTo),
    onSuccess: () => {
      invalidate()
      notify('已回退到所选停用版本')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '回退失败'),
  })

  const setColumns = setHelper.columns([
    setHelper.display({ id: 'code', header: '映射集', size: 180, cell: ({ row }) => <div><div className="text-body-sm font-medium text-ink">{row.original.name}</div><code className="font-mono text-meta text-muted-foreground">{row.original.code}</code></div> }),
    setHelper.display({ id: 'source', header: '源资产 → 标准', cell: ({ row }) => <span className="text-label text-ink-soft">{row.original.sourceAsset} → {row.original.standard.code}</span> }),
    setHelper.display({ id: 'versions', header: '版本', size: 100, cell: ({ row }) => `${row.original.versionCount} 版` }),
    setHelper.display({
      id: 'active',
      header: '生效版本',
      size: 130,
      cell: ({ row }) => 'versionNo' in row.original.activeVersion
        ? <Badge variant="success">v{row.original.activeVersion.versionNo}</Badge>
        : <span className="text-label text-faint">未生效</span>,
    }),
    setHelper.display({ id: 'updated', header: '更新', size: 130, cell: ({ row }) => <span className="text-label text-faint">{formatDateTime(row.original.updatedAt)}</span> }),
  ])

  const itemColumns = itemHelper.columns([
    itemHelper.accessor('sourceColumn', { header: '源字段', cell: ({ row }) => <code className="font-mono text-label text-muted-foreground">{row.original.sourceColumn}</code> }),
    itemHelper.accessor('targetElementCode', { header: '目标数据元' }),
    itemHelper.display({ id: 'transform', header: '转换', size: 130, cell: ({ row }) => transformLabel(row.original.transform) }),
    itemHelper.display({ id: 'param', header: '参数', cell: ({ row }) => <span className="text-label text-muted-foreground">{row.original.transformParam || '—'}</span> }),
    itemHelper.display({
      id: 'conclusion',
      header: '人工结论',
      size: 100,
      cell: ({ row }) => <Badge variant={row.original.conclusion === 'CONFIRMED' ? 'success' : 'warning'}>{row.original.conclusion === 'CONFIRMED' ? '已确认' : '待复核'}</Badge>,
    }),
  ])

  const version = detail?.version
  const busy = versionAction.isPending || createVersion.isPending || importItems.isPending || replaceItems.isPending || rollback.isPending
  const activeVersion = detail?.versions.find((item) => item.status === 'ACTIVE')
  const retiredVersions = detail?.versions.filter((item) => item.status === 'RETIRED') ?? []
  const coverage = coverageRequest.data

  const rollbackTargetItems = [
    { value: '', label: '选择曾生效的停用版本…' },
    ...retiredVersions.map((item) => ({ value: item.id, label: <>v{item.versionNo}</> })),
  ]
  const standardItems = [
    { value: '', label: publishedStandards.isPending ? '读取中…' : '选择已发布标准…' },
    ...(publishedStandards.data ?? []).map((standard) => ({ value: standard.id, label: <>{standard.code} · {standard.name}</> })),
  ]
  return (
    <div>
      <Breadcrumb items={[{ label: '数据治理' }, { label: '标准映射' }]} trailing={detail ? <span>更新 {formatDateTime(detail.set.updatedAt)}</span> : null} />
      <PageHeading
        title="标准映射"
        description="将源字段对齐院级标准，验证通过后评审生效，全程保留版本依据。"
        actions={<Button variant="outline" onClick={() => navigate('/governance/standards')}>前往标准中心</Button>}
      />

      <section className="mb-3.5 flex items-center justify-between gap-4 rounded-panel border border-line bg-paper px-5 py-3.5">
        <div className="flex items-center gap-3">
          <ClipboardCheck size={21} className="text-blue" />
          <div>
            <h2 className="text-body-sm font-semibold text-ink">
              {coverage?.coverage === null ? '映射覆盖尚未形成统计口径' : '生效映射覆盖'}
            </h2>
            <p className="mt-1 text-label text-muted-foreground">
              {coverage ? `生效版本 ${coverage.activeMappingVersions} 个 · 已覆盖 ${coverage.coveredCodeElements} / ${coverage.publishedCodeElements} 个已发布值域数据元` : coverageRequest.isPending ? '正在读取覆盖统计…' : '覆盖统计暂不可用，映射集仍可独立查看与维护。'}
            </p>
            {coverage ? <span className="mt-0.5 block text-meta text-muted-foreground">统计于 {formatDateTime(coverage.asOf)} · AI 就绪评估引用同一口径</span> : null}
          </div>
        </div>
        <Badge variant={coverage?.coverage == null ? 'outline' : coverage.coverage >= 0.9 ? 'success' : 'warning'}>
          {coverage?.coverage == null ? '暂无可统计数据' : `${(coverage.coverage * 100).toFixed(1)}%`}
        </Badge>
      </section>

      <FramePanel className="mb-3.5 p-0 overflow-clip">
        <FrameHeader className="px-[18px] pt-[18px] pb-3 flex-row items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-title font-semibold tracking-[-0.2px]">
              映射集清单
              {sets.length !== undefined ? <Badge variant="outline">{sets.length}</Badge> : null}
            </h2>
            <FrameDescription>草稿 → 验证 → 评审 → 生效；选择后核对字段与版本证据</FrameDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">{<Button size="sm" onClick={() => setCreateOpen((open) => !open)}><GitCompareArrows size={13} />{createOpen ? '收起新建' : '新建映射集'}</Button>}</div>
        </FrameHeader>
        <div className="flex items-center gap-2 px-[18px] pb-3">
          <SearchField value={keyword} onValueChange={(value) => { setKeyword(value); setPage(0) }} placeholder="搜索映射集代码/名称/源资产" />
          {keyword ? <Button variant="link" size="sm" onClick={() => { setKeyword(''); setPage(0) }}>清除筛选</Button> : null}
        </div>
        <DataTable
          columns={setColumns}
          data={sets.slice(currentPage * 8, (currentPage + 1) * 8)}
          getRowId={(item) => item.id}
          rowLabel={(item) => `选择映射集 ${item.code}`}
          loading={setsRequest.isPending}
          onRowClick={(item) => { setSelectedId(item.id); setVersionId('') }}
          empty={<EmptyState minHeight={200} title={keyword ? '没有匹配的映射集' : '还没有映射集'} description={keyword ? '请调整关键词或清除筛选。' : '新建后导入字段，经验证与评审后生效。'} />}
          footer={<TablePagination page={currentPage} pageSize={8} total={sets.length} onPageChange={setPage} label="映射集分页" />}
        />
      </FramePanel>

      {createOpen ? (
        <FramePanel className="mb-3.5 p-0 overflow-clip">
          <FrameHeader className="px-[18px] pt-[18px] pb-3 gap-1">
            <div className="min-w-0">
              <h2 className="text-title font-semibold tracking-[-0.2px]">
                新建映射集
              </h2>
              <FrameDescription>目标标准须为已发布；映射项用导入补齐</FrameDescription>
            </div>
          </FrameHeader>
          <div className="px-5 pb-5">
            <FormGrid>
              <Field>
                <FieldLabel>
                  映射集代码 <span className="text-destructive-foreground">*</span>
                </FieldLabel>
                <Input id="mapping-code" value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} placeholder="MAP-EP-CFZB" />
              </Field>
              <Field>
                <FieldLabel>
                  名称 <span className="text-destructive-foreground">*</span>
                </FieldLabel>
                <Input id="mapping-name" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="门诊处方表映射" />
              </Field>
            </FormGrid>
            <FormGrid>
              <Field>
                <FieldLabel>
                  源资产（fqn） <span className="text-destructive-foreground">*</span>
                </FieldLabel>
                <Input id="mapping-source" value={createForm.sourceAsset} onChange={(event) => setCreateForm({ ...createForm, sourceAsset: event.target.value })} placeholder="doris.dataos.ods_ep.ep_order" />
              </Field>
              <Field>
                <FieldLabel>
                  验证数据集（须已登记） <span className="text-destructive-foreground">*</span>
                </FieldLabel>
                <Input id="mapping-dataset" value={createForm.dataset} onChange={(event) => setCreateForm({ ...createForm, dataset: event.target.value })} placeholder="ods_ep.ep_order" />
              </Field>
            </FormGrid>
            <Field className="mb-4">
              <FieldLabel htmlFor="mapping-standard">
                目标标准 <span className="text-destructive-foreground">*</span>
              </FieldLabel>
              <Select
                items={standardItems}
                value={createForm.standardId}
                onValueChange={(next) => setCreateForm({ ...createForm, standardId: next ?? '' })}
                disabled={publishedStandards.isPending || (publishedStandards.data?.length ?? 0) === 0}
              >
                <SelectTrigger id="mapping-standard">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {standardItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <FieldDescription>{publishedStandards.isError ? '已发布标准读取失败，请重试连接后创建映射集。' : publishedStandards.isSuccess && (publishedStandards.data?.length ?? 0) === 0 ? '尚无已发布标准。' : undefined}</FieldDescription>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button
                size="sm"
                disabled={createSet.isPending || !createForm.code.trim() || !createForm.name.trim() || !createForm.sourceAsset.trim() || !createForm.dataset.trim() || !createForm.standardId}
                onClick={() => { setError(null); createSet.mutate() }}
              >
                创建（空草稿，随后导入映射项）
              </Button>
            </div>
          </div>
        </FramePanel>
      ) : null}

      {selectedId && detailRequest.isPending ? <LoadingBlock>正在读取映射详情…</LoadingBlock> : null}
      {detailRequest.isError ? (
        <FramePanel className="mb-3.5 p-0 overflow-clip">
          <EmptyState minHeight={180} title="映射详情读取失败" description="映射集清单仍可使用。请重试读取所选映射的版本、字段与验证证据。" action={<Button variant="outline" size="sm" onClick={() => void detailRequest.refetch()}>重试详情</Button>} />
        </FramePanel>
      ) : null}

      {detail && version ? (
        <div className="mb-3.5 grid grid-cols-[minmax(0,1fr)_300px] gap-3.5 max-[1100px]:grid-cols-1">
          <FramePanel className="p-0 overflow-clip">
            <FrameHeader className="px-[18px] pt-[18px] pb-3 flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-title font-semibold tracking-[-0.2px]">
                  {detail.set.name}
                </h2>
                <FrameDescription>{`${detail.set.code} · ${detail.set.sourceAsset} → ${detail.set.standard.code}（验证数据集 ${detail.set.dataset}）`}</FrameDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">{<Button variant="outline" size="sm" disabled={busy} onClick={() => createVersion.mutate()}><GitCompareArrows size={13} />基于活动版新建草稿</Button>}</div>
            </FrameHeader>
            <div className="px-[18px] pb-3">
              <div className="flex flex-wrap items-center gap-2 text-label text-muted-foreground">
                <strong className="text-body-sm text-ink-soft">当前查看 v{version.versionNo}</strong>
                <Badge variant={statusTone(version.status)}>{STATUS_LABEL[version.status] ?? version.status}</Badge>
                <span>{version.items.length} 个字段映射 · {version.status === 'DRAFT' ? '维护映射后执行聚合验证，通过后提交评审' : version.status === 'IN_REVIEW' ? '管理员生效前需核对当前内容对应的通过证据' : version.status === 'ACTIVE' ? '当前生效版本只读，变更请新建草稿' : '该版本已停用，保留历史依据'}</span>
              </div>
              <SegmentedControl
                className="mt-2 flex-wrap"
                size="sm"
                render={<RadioGroupPrimitive aria-label="选择查看的版本" value={version.id} onValueChange={setVersionId} />}
              >
                {detail.versions.map((item) => (
                  <SegmentedControlItem key={item.id} className="min-h-[36px]" title={`checksum ${item.checksum} · 生效需同值 PASS 验证`} render={<RadioPrimitive.Root value={item.id} />}>
                    v{item.versionNo}
                    <Badge variant={statusTone(item.status)}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {version.status === 'DRAFT' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'submit', id: version.id })}>提交评审</Button> : null}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'validate', id: version.id })}><ShieldCheck size={13} />聚合验证</Button>
                {version.status === 'IN_REVIEW' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'activate', id: version.id })}><ShieldCheck size={13} />生效（管理员 · 需 PASS 证据）</Button> : null}
                {version.status === 'ACTIVE' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'retire', id: version.id })}><Archive size={13} />停用</Button> : null}
                <Button variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void fetchMappingImpact(undefined, version.id)
                      .then(setImpact)
                      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '影响范围读取失败'))
                  }}
                >
                  <ArrowRightLeft size={13} />影响范围
                </Button>
              </div>

              {impact ? (
                <div className="mt-3 rounded-control border border-line bg-wash px-3 py-2.5 text-label text-muted-foreground">
                  <strong className="block text-body-sm text-ink-soft">影响范围（v{impact.versionNo} · {impact.status}）</strong>
                  <p className="mt-1">映射项 {impact.itemCount} 条；源 {impact.sourceAsset}；目标标准 {impact.standard.code}。</p>
                  <p className="mt-1">已覆盖数据元：{Object.keys(impact.mappedElements).join('、') || '—'}；未覆盖值域数据元：{impact.unpublishedUncoveredElements.join('、') || '—'}。</p>
                </div>
              ) : null}

              <div className="mt-3">
                <DataTable
                  columns={itemColumns}
                  data={version.items}
                  getRowId={(item) => item.id}
                  empty={<p className="px-1 py-3 text-label text-muted-foreground">该版本暂无映射项；可用下方导入区补齐（先预检）。</p>}
                />
              </div>

              <div className="mt-3 rounded-control border border-line bg-wash px-3 py-2.5 text-label text-muted-foreground">
                <strong className="block text-body-sm text-ink-soft">验证证据（最新 {version.validations.length} 次）</strong>
                {version.validations.length > 0 ? version.validations.map((validation) => (
                  <p key={validation.id} className="mt-1">
                    <Badge variant={validation.status === 'PASS' ? 'success' : validation.status === 'FAIL' ? 'error' : 'warning'}>{validation.status === 'PASS' ? '通过' : validation.status === 'FAIL' ? '未通过' : '需复核'}</Badge>
                    <Tooltip>
                      <TooltipTrigger render={<span className="ml-1.5" />}>{validation.checksum === version.checksum ? '对应当前内容' : '对应历史内容'}</TooltipTrigger>
                      <TooltipPopup>{`内容校验值 ${validation.checksum}`}</TooltipPopup>
                    </Tooltip>
                    <small className="ml-1.5 text-meta text-muted-foreground">{formatDateTime(validation.dataTime || validation.createdAt)}</small>
                  </p>
                )) : <p className="mt-1">此版本尚无聚合验证证据，执行验证后可核对结果与数据时间。</p>}
              </div>

              {activeVersion && retiredVersions.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-label text-muted-foreground">回退到</span>
                  <Select
                    items={rollbackTargetItems}
                    value={rollbackTo}
                    onValueChange={(next) => setRollbackTo(next ?? '')}
                  >
                    <SelectTrigger aria-label="选择回退目标版本" className="w-[220px]" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {rollbackTargetItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Button variant="outline" size="sm" disabled={!rollbackTo || busy} onClick={() => rollback.mutate()}><History size={13} />回退（管理员）</Button>
                </div>
              ) : null}

              {error ? (
                <Alert variant="error" className="mt-2">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </FramePanel>

          <FramePanel className="p-0 overflow-clip">
            <FrameHeader className="px-[18px] pt-[18px] pb-3 flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-title font-semibold tracking-[-0.2px]">
                  审计事件
                </h2>
                <FrameDescription>当前映射集 · 最近 20 条</FrameDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">{detail.events.length > 6 ? <Button variant="link" size="sm" onClick={() => setShowAllEvents((value) => !value)}>{showAllEvents ? '收起事件' : `展开全部 ${detail.events.length} 条`}</Button> : undefined}</div>
            </FrameHeader>
            <ol className="m-0 list-none px-4 pb-4">
              {(showAllEvents ? detail.events : detail.events.slice(0, 6)).map((event) => (
                <li key={event.id} className="border-b border-line-soft py-2 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-label font-medium text-ink-soft">{standardEventLabel(event.eventType)}</strong>
                    <span className="text-meta text-muted-foreground">{actorLabel(event.actor)}</span>
                  </div>
                  <p className="mt-0.5 text-meta leading-relaxed text-muted-foreground">{event.detail}</p>
                  <small className="text-meta text-muted-foreground">{formatDateTime(event.createdAt)}</small>
                </li>
              ))}
              {detail.events.length === 0 ? <li className="py-4 text-center text-label text-muted-foreground">暂无事件。</li> : null}
            </ol>
          </FramePanel>
        </div>
      ) : null}

      {detail && version && version.status === 'DRAFT' ? (
        <FramePanel className="p-0 overflow-clip">
          <FrameHeader className="px-[18px] pt-[18px] pb-3 gap-1">
            <div className="min-w-0">
              <h2 className="text-title font-semibold tracking-[-0.2px]">
                草稿维护（仅 DRAFT）
              </h2>
              <FrameDescription>导入映射项（CSV/JSON，先预检）或整体替换（JSON）</FrameDescription>
            </div>
          </FrameHeader>
          <div className="px-5 pb-5">
            <Field className="mb-4">
              <FieldLabel>导入内容</FieldLabel>
              <CodeTextarea
                id="mapping-import"
                className="min-h-[110px]"
                value={importBody}
                onChange={(event) => { setImportBody(event.target.value); setImportReport(null) }}
                placeholder={'source_column,target_element_code,transform,transform_param,conclusion\nchannel_code,channel,VALUE_MAP,"{""OPD"":""OPD""}",CONFIRMED'}
              />
              <FieldDescription>{'支持 CSV（列：source_column, target_element_code, transform, transform_param, conclusion）或 JSON（{"items":[…]}）。'}</FieldDescription>
            </Field>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!importBody.trim() || importItems.isPending} onClick={() => { setError(null); importItems.mutate(true) }}>
                <UploadCloud size={13} />预检（dry-run）
              </Button>
              <Button
                size="sm"
                disabled={!importReport || !importReport.dryRun || importReport.problems.length > 0 || importItems.isPending}
                onClick={() => { setError(null); importItems.mutate(false) }}
              >
                确认导入
              </Button>
            </div>
            {importReport ? (
              <div className="mt-2 rounded-control border border-line bg-wash px-3 py-2.5 text-label text-muted-foreground">
                <strong className="block text-body-sm text-ink-soft">{importReport.applied ? '已应用' : '预检报告'}</strong>
                <p className="mt-1">映射项 {importReport.itemCount} 条 · checksum {importReport.checksum ? `${importReport.checksum.slice(0, 12)}…` : '—'}</p>
                {importReport.problems.length > 0
                  ? <ul className="mt-1 space-y-0.5 text-amber">{importReport.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                  : <p className="mt-1 text-green">校验通过。</p>}
              </div>
            ) : null}

            <Field className="mt-4 mb-4">
              <FieldLabel>元素整体替换</FieldLabel>
              <CodeTextarea
                id="mapping-items"
                className="min-h-[90px]"
                value={itemsDraft}
                onChange={(event) => setItemsDraft(event.target.value)}
                placeholder='[{"sourceColumn":"channel_code","targetElementCode":"channel","transform":"VALUE_MAP","transformParam":"{\"OPD\":\"OPD\"}","conclusion":"CONFIRMED"}]'
              />
              <FieldDescription>JSON 数组，整体替换该草稿的映射项并重算 checksum；留空不修改。</FieldDescription>
            </Field>
            <div className="flex justify-end">
              <Button size="sm" disabled={!itemsDraft.trim() || replaceItems.isPending} onClick={() => { setError(null); replaceItems.mutate() }}>
                整体替换并重算 checksum
              </Button>
            </div>
            {importReport === null && importItems.isPending ? <LoadingInline>正在提交…</LoadingInline> : null}
          </div>
        </FramePanel>
      ) : null}
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowRightLeft, Download, FileSearch, GitCompareArrows, RefreshCw, Send, ShieldCheck, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { FormField, FormGrid } from '../../components/ui/form'
import { CodeTextarea, Input, NativeSelect, SearchField } from '../../components/ui/input'
import { Breadcrumb, PageHeading } from '../../components/ui/page-heading'
import { Panel, PanelHead } from '../../components/ui/panel'
import { EmptyState, LoadingBlock, LoadingInline } from '../../components/ui/states'
import { DataTable, TablePagination, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/ui/toast'
import {
  compareStandardVersions,
  createStandardVersion,
  deprecateStandardVersion,
  fetchFhirBundle,
  importStandards,
  publishStandardVersion,
  retryStandardSync,
  submitStandardVersion,
  updateStandardVersion,
  type ImportReport,
  type StandardDetailView,
  type StandardElementView,
  type StandardListItem,
  type VersionCompare,
} from '../../data/standardsApi'
import { actorLabel, formatDateTime, sensitivityLabel, severityTone, standardEventLabel } from '../../data/domain'
import { governanceKeys, standardDetailQuery, standardImpactQuery, standardsQuery } from './queries'
import { usePortalNavigate } from '../../app/navigate'

const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', IN_REVIEW: '评审中', PUBLISHED: '已发布', DEPRECATED: '已停用' }

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'PUBLISHED') return 'success'
  if (status === 'IN_REVIEW') return 'warn'
  if (status === 'DEPRECATED') return 'neutral'
  return 'neutral'
}

/** 事件 detail 为后端原文；引擎缩写不进入业务视图（同 businessMessage 消毒器先例）。 */
export function standardEventDetail(detail: string) {
  return detail.replace(/OM 术语投影/g, '术语投影')
}

const listHelper = listColumnHelper<StandardListItem>()
const elementHelper = listColumnHelper<StandardElementView>()

/**
 * 数据标准中心：标准集合 → 不可变版本 → 评审/发布/停用生命周期。
 * 导入必须 dry-run 先行；发布版本只读，变更走新草稿；影响范围与 FHIR 导出按版本。
 */
export function StandardsPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [compareWith, setCompareWith] = useState('')
  const [compareResult, setCompareResult] = useState<VersionCompare | null>(null)
  const [impactOpen, setImpactOpen] = useState(false)
  const [metaDraft, setMetaDraft] = useState({ name: '', owner: '', description: '' })
  const [elementsDraft, setElementsDraft] = useState('')
  const [importBody, setImportBody] = useState('')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const listRequest = useQuery(standardsQuery(keyword, statusFilter))
  const detailRequest = useQuery(standardDetailQuery(selectedId, versionId))
  const impactRequest = useQuery({ ...standardImpactQuery(versionId), enabled: impactOpen && Boolean(versionId) })

  const items = listRequest.data ?? []
  const detail = detailRequest.data

  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0].id)
  }, [items, selectedId])

  useEffect(() => {
    // 详情落位后把版本指针固定到响应版本，避免每次刷新重置。
    if (detailRequest.data && !versionId) setVersionId(detailRequest.data.version.id)
  }, [detailRequest.data, versionId])

  useEffect(() => {
    setMetaDraft({ name: '', owner: '', description: '' })
    setElementsDraft('')
    setCompareWith('')
    setCompareResult(null)
    setImpactOpen(false)
  }, [detailRequest.data?.version.id])

  const pageCount = Math.max(1, Math.ceil(items.length / 8))
  const currentPage = Math.min(page, pageCount - 1)

  const invalidate = (id = selectedId) => {
    void queryClient.invalidateQueries({ queryKey: [...governanceKeys.all, 'standards'] })
    void queryClient.invalidateQueries({ queryKey: governanceKeys.standard(id, '') })
    void queryClient.invalidateQueries({ queryKey: [...governanceKeys.all, 'standard', id] })
  }

  const versionAction = useMutation({
    mutationFn: ({ action, versionId: id }: { action: 'submit' | 'publish' | 'deprecate' | 'sync'; versionId: string }) => {
      if (action === 'submit') return submitStandardVersion(id)
      if (action === 'publish') return publishStandardVersion(id)
      if (action === 'deprecate') return deprecateStandardVersion(id)
      return retryStandardSync(id)
    },
    onSuccess: (_data, variables) => {
      invalidate()
      notify({ submit: '已提交评审', publish: '版本已发布', deprecate: '版本已停用', sync: '术语投影重试已提交' }[variables.action])
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '标准版本操作失败'),
  })

  const createDraft = useMutation({
    mutationFn: () => createStandardVersion(selectedId),
    onSuccess: (next) => {
      invalidate()
      setVersionId(next.version.id)
      notify('已基于当前版本新建草稿')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '新建草稿失败'),
  })

  const saveDraft = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {}
      if (metaDraft.name.trim()) payload.standardName = metaDraft.name.trim()
      if (metaDraft.owner.trim()) payload.owner = metaDraft.owner.trim()
      if (metaDraft.description.trim()) payload.description = metaDraft.description.trim()
      if (elementsDraft.trim()) {
        const parsed: unknown = JSON.parse(elementsDraft)
        if (!Array.isArray(parsed)) throw new Error('元素集必须是 JSON 数组')
        payload.elements = parsed
      }
      return updateStandardVersion(detail?.version.id ?? '', payload)
    },
    onSuccess: () => {
      invalidate()
      setMetaDraft({ name: '', owner: '', description: '' })
      setElementsDraft('')
      notify('草稿修改已保存')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '草稿修改保存失败'),
  })

  const importMutation = useMutation({
    mutationFn: (dryRun: boolean) => importStandards(importBody, dryRun),
    onSuccess: (report) => {
      setImportReport(report)
      if (report.created) {
        invalidate()
        notify('标准导入完成，已创建草稿版本')
      }
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '标准导入失败'),
  })

  async function downloadFhir() {
    if (!detail) return
    try {
      const bundle = await fetchFhirBundle(detail.version.id)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `standard-fhir-${detail.standard.code}-v${detail.version.versionNo}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      notify('FHIR Bundle 已导出（不含内部数据库标识）')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'FHIR 导出失败')
    }
  }

  const listColumns = listHelper.columns([
    listHelper.display({ id: 'code', header: '代码', size: 160, cell: ({ row }) => <code className="font-mono text-label text-[#6b778a]">{row.original.code}</code> }),
    listHelper.accessor('name', { header: '名称' }),
    listHelper.display({ id: 'owner', header: '负责人', size: 110, cell: ({ row }) => row.original.owner || '—' }),
    listHelper.display({ id: 'version', header: '最新版本', size: 130, cell: ({ row }) => `v${row.original.latestVersion.versionNo} / 共 ${row.original.versionCount} 版` }),
    listHelper.display({ id: 'status', header: '状态', size: 100, cell: ({ row }) => <Badge tone={statusTone(row.original.latestVersion.status)}>{STATUS_LABEL[row.original.latestVersion.status] ?? row.original.latestVersion.status}</Badge> }),
    listHelper.display({
      id: 'sync',
      header: '术语投影',
      size: 100,
      cell: ({ row }) => row.original.latestVersion.status === 'PUBLISHED'
        ? <Badge tone={row.original.latestVersion.syncStatus === 'SYNCED' ? 'success' : 'warn'}>{row.original.latestVersion.syncStatus === 'SYNCED' ? '已同步' : '待同步'}</Badge>
        : '—',
    }),
  ])

  const elementColumns = elementHelper.columns([
    elementHelper.display({
      id: 'element',
      header: '数据元',
      cell: ({ row }) => <div><code className="font-mono text-label text-[#6b778a]">{row.original.code}</code><div className="text-meta text-[#707c8c]">{row.original.name}</div></div>,
    }),
    elementHelper.accessor('dataType', { header: '类型', size: 100 }),
    elementHelper.display({ id: 'required', header: '必填', size: 70, cell: ({ row }) => row.original.required ? '必填' : '可选' }),
    elementHelper.display({
      id: 'sensitivity',
      header: '敏感级别',
      size: 100,
      cell: ({ row }) => <Badge tone={severityTone(row.original.sensitivity) === 'danger' ? 'danger' : severityTone(row.original.sensitivity) === 'warning' ? 'warn' : 'neutral'}>{sensitivityLabel(row.original.sensitivity)}</Badge>,
    }),
    elementHelper.display({ id: 'definition', header: '定义', cell: ({ row }) => <span className="text-label text-[#6b7789]">{row.original.definition || '—'}</span> }),
    elementHelper.display({
      id: 'values',
      header: '值域',
      cell: ({ row }) => row.original.dataType === 'CODE'
        ? <span className="flex flex-wrap gap-1">{row.original.values.map((value) => <span key={value.code} className="rounded-chip bg-wash px-1.5 py-0.5 text-meta text-[#6b778a]">{value.code} {value.displayName}</span>)}</span>
        : '—',
    }),
  ])

  const version = detail?.version
  const otherVersions = useMemo(() => detail?.versions.filter((item) => item.id !== version?.id) ?? [], [detail, version?.id])
  const busy = versionAction.isPending || createDraft.isPending || saveDraft.isPending

  return (
    <div>
      <Breadcrumb items={[{ label: '数据治理' }, { label: '数据标准' }]} trailing={detail ? <span>更新 {formatDateTime(detail.standard.updatedAt)}</span> : null} />
      <PageHeading
        title="数据标准中心"
        description="维护院级业务定义与值域，通过评审发布可追溯的标准版本。"
        actions={<Button onClick={() => navigate('/governance/quality')}>返回治理</Button>}
      />

      <Panel className="mb-3.5">
        <PanelHead title="标准清单" count={items.length} description="草稿 → 评审 → 发布；选择标准后查看版本与数据元" />
        <div className="flex items-center gap-2 px-[18px] pb-3">
          <SearchField value={keyword} onValueChange={(value) => { setKeyword(value); setPage(0) }} placeholder="搜索标准代码或名称" />
          <NativeSelect aria-label="按最新版本状态筛选" className="w-auto" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0) }}>
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </NativeSelect>
          {keyword || statusFilter ? <Button variant="text" size="sm" onClick={() => { setKeyword(''); setStatusFilter(''); setPage(0) }}>清除筛选</Button> : null}
        </div>
        <DataTable
          columns={listColumns}
          data={items.slice(currentPage * 8, (currentPage + 1) * 8)}
          getRowId={(item) => item.id}
          rowLabel={(item) => `选择标准 ${item.code} ${item.name}`}
          loading={listRequest.isPending}
          onRowClick={(item) => { setSelectedId(item.id); setVersionId('') }}
          empty={<EmptyState minHeight={200} title={keyword || statusFilter ? '没有匹配的标准' : '还没有数据标准'} description={keyword || statusFilter ? '请调整关键词或清除筛选。' : '在下方导入内容，预检通过后创建草稿。'} />}
          footer={<TablePagination page={currentPage} pageSize={8} total={items.length} onPageChange={setPage} label="标准清单分页" />}
        />
      </Panel>

      {listRequest.isError ? (
        <Panel className="mb-3.5">
          <EmptyState minHeight={200} title="控制面暂不可用" description="暂时无法读取标准清单。恢复连接后，可继续查看版本、评审记录与影响范围。" action={<Button size="sm" onClick={() => void listRequest.refetch()}>重试</Button>} />
        </Panel>
      ) : null}

      {selectedId && detailRequest.isPending ? <LoadingBlock>正在读取标准详情…</LoadingBlock> : null}
      {detailRequest.isError ? (
        <Panel className="mb-3.5">
          <EmptyState minHeight={180} title="标准详情读取失败" description="标准清单仍可使用。请重试读取所选标准的版本与数据元。" action={<Button size="sm" onClick={() => void detailRequest.refetch()}>重试详情</Button>} />
        </Panel>
      ) : null}

      {detail && version ? (
        <div className="mb-3.5 grid grid-cols-[minmax(0,1fr)_300px] gap-3.5 max-[1100px]:grid-cols-1">
          <Panel>
            <PanelHead
              title={detail.standard.name}
              description={`${detail.standard.code} · ${detail.standard.owner || '未指定负责人'}`}
              actions={<Button size="sm" disabled={busy} onClick={() => createDraft.mutate()}><GitCompareArrows size={14} />基于当前版本新建草稿</Button>}
            />
            <div className="px-[18px] pb-3">
              <div className="flex flex-wrap items-center gap-2 text-label text-[#6b7889]">
                <strong className="text-body-sm text-[#43546e]">当前查看 v{version.versionNo}</strong>
                <Badge tone={statusTone(version.status)}>{STATUS_LABEL[version.status]}</Badge>
                <span>{version.elements.length} 个数据元 · {version.status === 'DRAFT' ? '修改后提交评审，发布后供资产与映射引用' : version.status === 'IN_REVIEW' ? '评审通过后由管理员发布' : version.status === 'PUBLISHED' ? '已发布版本只读，变更请新建草稿' : '该版本已停用，保留历史追溯'}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.versions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={item.id === version.id}
                    onClick={() => setVersionId(item.id)}
                    className={`inline-flex min-h-[36px] items-center gap-2 rounded-control border px-2.5 py-1.5 text-label ${item.id === version.id ? 'border-blue-line bg-blue-soft text-blue' : 'border-line bg-paper text-[#5b6b80] hover:bg-wash'}`}
                  >
                    <strong>v{item.versionNo}</strong>
                    <Badge tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge>
                    <span className="text-meta text-[#8b94a1]">{item.syncStatus === 'SYNCED' ? '术语已投影' : item.status === 'PUBLISHED' ? '投影待同步' : ''}</span>
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {version.status === 'DRAFT' ? <Button size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'submit', versionId: version.id })}><Send size={13} />提交评审</Button> : null}
                {version.status === 'IN_REVIEW' ? <Button size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'publish', versionId: version.id })}><ShieldCheck size={13} />发布（管理员）</Button> : null}
                {version.status === 'PUBLISHED' ? (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'deprecate', versionId: version.id })}><Archive size={13} />停用</Button>
                    {version.syncStatus !== 'SYNCED' ? <Button size="sm" disabled={busy} onClick={() => versionAction.mutate({ action: 'sync', versionId: version.id })}><RefreshCw size={13} />重试术语投影</Button> : null}
                  </>
                ) : null}
                <Button size="sm" onClick={() => setImpactOpen((open) => !open)}><FileSearch size={13} />影响范围</Button>
                <Button size="sm" onClick={downloadFhir}><Download size={13} />FHIR 导出</Button>
              </div>

              {impactOpen ? (
                <div className="mt-3 rounded-control border border-line bg-wash px-3 py-2.5 text-label text-[#6b7889]">
                  {impactRequest.isPending ? <LoadingInline>正在读取影响范围…</LoadingInline> : null}
                  {impactRequest.data ? (
                    <>
                      <strong className="block text-body-sm text-[#566173]">影响范围（v{impactRequest.data.versionNo}）</strong>
                      <p className="mt-1">数据元 {impactRequest.data.elementCount} 个；引用资产 {impactRequest.data.referencedAssets.length} 项{impactRequest.data.referencedAssets.length > 0 ? `：${impactRequest.data.referencedAssets.join('、')}` : ''}。{impactRequest.data.notes.join('；')}</p>
                    </>
                  ) : null}
                  {impactRequest.isError ? <p className="text-red">影响范围读取失败</p> : null}
                </div>
              ) : null}

              {version.status === 'DRAFT' ? (
                <div className="mt-4 rounded-control border border-line bg-[#fcfdff] px-3.5 py-3">
                  <h3 className="mb-2 text-label font-medium text-[#566173]">草稿修改（仅 DRAFT 可改）</h3>
                  <FormGrid>
                    <FormField label="标准名称" htmlFor="standard-name"><Input id="standard-name" value={metaDraft.name} onChange={(event) => setMetaDraft((current) => ({ ...current, name: event.target.value }))} placeholder={detail.standard.name} /></FormField>
                    <FormField label="负责人" htmlFor="standard-owner"><Input id="standard-owner" value={metaDraft.owner} onChange={(event) => setMetaDraft((current) => ({ ...current, owner: event.target.value }))} placeholder={detail.standard.owner || '未指定'} /></FormField>
                  </FormGrid>
                  <FormField label="描述" htmlFor="standard-description"><Input id="standard-description" value={metaDraft.description} onChange={(event) => setMetaDraft((current) => ({ ...current, description: event.target.value }))} placeholder={detail.standard.description || '补充标准描述'} /></FormField>
                  <FormField label="元素集整体替换" htmlFor="standard-elements" hint="JSON 数组，与创建接口的元素结构同构；留空则不修改元素集。">
                    <CodeTextarea
                      id="standard-elements"
                      className="min-h-[120px]"
                      value={elementsDraft}
                      onChange={(event) => setElementsDraft(event.target.value)}
                      placeholder='[{"code":"channel","name":"挂号渠道","dataType":"CODE","required":true,"definition":"渠道枚举","sensitivity":"NORMAL","assetRef":"","values":[{"code":"OPD","displayName":"门诊"}]}]'
                    />
                  </FormField>
                  <div className="flex justify-end">
                    <Button size="sm" disabled={busy} onClick={() => saveDraft.mutate()}>保存草稿修改</Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3">
                <DataTable
                  columns={elementColumns}
                  data={version.elements}
                  getRowId={(element) => element.id}
                  empty={<p className="px-1 py-3 text-label text-muted">该版本暂无数据元。</p>}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="text-label text-[#6b7889]">版本对比：与</span>
                <NativeSelect
                  aria-label="选择对比版本"
                  className="w-[200px]"
                  value={compareWith}
                  disabled={otherVersions.length === 0}
                  onChange={(event) => setCompareWith(event.target.value)}
                >
                  <option value="">{otherVersions.length === 0 ? '没有可比版本' : '选择另一版本…'}</option>
                  {otherVersions.map((item) => <option key={item.id} value={item.id}>v{item.versionNo}（{STATUS_LABEL[item.status]}）</option>)}
                </NativeSelect>
                <Button
                  size="sm"
                  disabled={!compareWith}
                  onClick={() => {
                    void compareStandardVersions(version.id, compareWith)
                      .then(setCompareResult)
                      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '版本对比失败'))
                  }}
                >
                  <ArrowRightLeft size={13} />对比
                </Button>
              </div>

              {compareResult ? (
                <ul className="mt-2 space-y-1 rounded-control border border-line bg-wash px-3 py-2 text-label">
                  {compareResult.added.map((item) => <li key={`a-${item.code}`} className="text-green">+ {item.code}（{item.name}）仅存在于对比版本</li>)}
                  {compareResult.removed.map((item) => <li key={`r-${item.code}`} className="text-amber">− {item.code}（{item.name}）仅存在于当前版本</li>)}
                  {compareResult.changed.map((item) => <li key={`c-${item.code}`}>{item.code}（{item.name}）：{item.differences.join('；')}</li>)}
                  {compareResult.added.length + compareResult.removed.length + compareResult.changed.length === 0 ? <li>两版本内容一致。</li> : null}
                </ul>
              ) : null}

              {error ? <p role="alert" className="mt-2 text-body-sm text-[#b04747]">{error}</p> : null}
            </div>
          </Panel>

          <Panel>
            <PanelHead title="审计事件" description="当前标准 · 最近 20 条" />
            <ol className="m-0 list-none px-4 pb-4">
              {detail.events.map((event) => (
                <li key={event.id} className="border-b border-line-soft py-2 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-label font-medium text-[#43546e]">{standardEventLabel(event.eventType)}</strong>
                    <span className="text-meta text-[#98a2ae]">{actorLabel(event.actor)}</span>
                  </div>
                  <p className="mt-0.5 text-meta leading-relaxed text-[#8b94a1]">{standardEventDetail(event.detail)}</p>
                  <small className="text-meta text-[#a3adb9]">{formatDateTime(event.createdAt)}</small>
                </li>
              ))}
              {detail.events.length === 0 ? <li className="py-4 text-center text-label text-muted">暂无事件。</li> : null}
            </ol>
          </Panel>
        </div>
      ) : null}

      <Panel>
        <PanelHead title="导入标准" description="粘贴 CSV 或 JSON → 预检内容 → 确认创建草稿" />
        <div className="px-5 pb-5">
          <FormField
            label="导入内容"
            htmlFor="standard-import"
            hint="支持平台 CSV 模板（standard_code, standard_name, element_code, element_name, data_type, required, definition, sensitivity, value_code, value_display）或与创建接口同构的 JSON。"
          >
            <CodeTextarea
              id="standard-import"
              className="min-h-[120px]"
              value={importBody}
              onChange={(event) => { setImportBody(event.target.value); setImportReport(null) }}
              placeholder={'standard_code,standard_name,element_code,element_name,data_type,required,definition,sensitivity,value_code,value_display\nreg-channel,挂号渠道,channel,挂号渠道,CODE,true,渠道枚举,NORMAL,OPD,门诊'}
            />
          </FormField>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!importBody.trim() || importMutation.isPending} onClick={() => { setError(null); importMutation.mutate(true) }}>
              <UploadCloud size={13} />预检（dry-run）
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!importReport || importReport.dryRun === false || importReport.problems.length > 0 || importMutation.isPending}
              onClick={() => { setError(null); importMutation.mutate(false) }}
            >
              确认导入
            </Button>
          </div>
          {importReport ? (
            <div className="mt-3 rounded-control border border-line bg-wash px-3 py-2.5 text-label text-[#6b7889]">
              <strong className="block text-body-sm text-[#566173]">{importReport.created ? '导入结果' : '预检报告'} · {importReport.standardCode || '（空代码）'}</strong>
              <p className="mt-1">数据元 {importReport.elementCount} 个 · 值域 {importReport.valueCount} 条 · 问题 {importReport.problems.length} 项</p>
              {importReport.problems.length > 0
                ? <ul className="mt-1 space-y-0.5 text-amber">{importReport.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                : <p className="mt-1 text-green">{importReport.created ? '导入已完成，可在标准清单中继续维护草稿。' : '校验通过，可确认导入。'}</p>}
              {importReport.created ? <p className="mt-1">已创建：{importReport.created.standard.code}（草稿 v{importReport.created.version.versionNo}）</p> : null}
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}

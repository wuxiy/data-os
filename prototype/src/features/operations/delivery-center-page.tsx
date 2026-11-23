import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/kit/badge'
import { Button } from '../../components/kit/button'
import { FormField, FormGrid, FormNotice } from '../../components/kit/form'
import { Input, NativeSelect, SearchField } from '../../components/kit/input'
import { Confirm, Dialog, DialogFooter } from '../../components/kit/overlay'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Count, Panel, PanelHead } from '../../components/kit/panel'
import { EmptyState, LoadingBlock, Skeleton } from '../../components/kit/states'
import { DataTable, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  acceptDelivery,
  addDeliveryItem,
  archiveDelivery,
  createDeliveryProject,
  DELIVERY_REF_TYPES,
  downloadEvidenceZip,
  REF_TYPE_LABEL,
  removeDeliveryItem,
  snapshotDelivery,
  STATUS_LABEL,
  statusTone,
  submitDelivery,
  type DeliveryBlocker,
  type DeliveryDetailView,
  type DeliveryEventView,
  type DeliveryItemView,
  type DeliveryProjectView,
  type DeliveryRefType,
} from '../../data/deliveryApi'
import { formatDateTime } from '../../data/domain'
import { operationsKeys, deliveriesQuery, deliveryDetailQuery } from './queries'

const projectHelper = listColumnHelper<DeliveryProjectView>()
const itemHelper = listColumnHelper<DeliveryItemView>()
const eventHelper = listColumnHelper<DeliveryEventView>()

function toneOf(status: string): 'success' | 'warn' | 'neutral' {
  const tone = statusTone(status)
  return tone === 'healthy' ? 'success' : tone === 'warning' ? 'warn' : 'neutral'
}

/**
 * 交付中心：项目目录 + 交付项/快照/事件 + 提交、验收、归档与证据包下载。
 * 提交被阻断时逐项列出不可交付原因（不吞掉阻断）；快照幂等；证据包不含行级数据与凭据。
 */
export function DeliveryCenterPage() {
  const queryClient = useQueryClient()
  const notify = useNotice()

  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [itemOpen, setItemOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ code: '', name: '', scope: '', owner: '', targetDate: '' })
  const [itemForm, setItemForm] = useState<{ refType: DeliveryRefType; refId: string; note: string }>({ refType: 'ASSET', refId: '', note: '' })
  const [createError, setCreateError] = useState<string | null>(null)
  const [itemError, setItemError] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<DeliveryBlocker[] | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<DeliveryProjectView | null>(null)

  const listRequest = useQuery(deliveriesQuery(query))
  const projects = listRequest.data ?? []
  const current = projects.find((project) => project.id === selectedId) ?? projects[0] ?? null
  const detailRequest = useQuery(deliveryDetailQuery(current?.id ?? ''))
  const detail = detailRequest.data

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: operationsKeys.all })
  }

  const createMutation = useMutation({
    mutationFn: () => createDeliveryProject({
      code: createForm.code.trim(), name: createForm.name.trim(), scope: createForm.scope.trim(),
      owner: createForm.owner.trim(), targetDate: createForm.targetDate,
    }),
    onSuccess: (next) => {
      invalidate()
      setCreateOpen(false)
      setSelectedId(next.project.id)
      setCreateForm({ code: '', name: '', scope: '', owner: '', targetDate: '' })
      notify(`已创建交付项目：${next.project.name}`)
    },
    onError: (cause) => setCreateError(cause instanceof Error ? cause.message : '交付项目创建失败'),
  })

  const addItem = useMutation({
    mutationFn: () => addDeliveryItem(current!.id, { refType: itemForm.refType, refId: itemForm.refId.trim(), note: itemForm.note.trim() }),
    onSuccess: () => {
      invalidate()
      setItemOpen(false)
      setItemForm({ refType: 'ASSET', refId: '', note: '' })
      notify('交付项已引用')
    },
    onError: (cause) => setItemError(cause instanceof Error ? cause.message : '交付项引用失败'),
  })

  const removeItem = useMutation({
    mutationFn: (itemId: string) => removeDeliveryItem(current!.id, itemId),
    onSuccess: () => { invalidate(); notify('交付项已移除') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '交付项移除失败'),
  })

  const snapshot = useMutation({
    mutationFn: () => snapshotDelivery(current!.id),
    onSuccess: (result) => { invalidate(); notify(`证据快照已生成（幂等）：${result.snapshotId?.slice(0, 8) ?? ''}`) },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '证据快照生成失败'),
  })

  const submit = useMutation({
    mutationFn: () => submitDelivery(current!.id),
    onSuccess: (result) => {
      setBlockers(result.ok ? null : (result.blockers ?? []))
      invalidate()
      notify(result.ok ? '提交验收成功：全部交付项通过可交付性检查' : (result.message ?? '提交被阻断：存在不可交付项'))
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '提交验收失败'),
  })

  const accept = useMutation({
    mutationFn: () => acceptDelivery(current!.id),
    onSuccess: () => { invalidate(); notify('验收通过：证据快照已钉住') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '验收失败'),
  })

  const archive = useMutation({
    mutationFn: (project: DeliveryProjectView) => archiveDelivery(project.id),
    onSuccess: () => { invalidate(); setArchiveTarget(null); notify('交付项目已归档') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '归档失败'),
  })

  const projectColumns = projectHelper.columns([
    projectHelper.display({
      id: 'name',
      header: '交付项目',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm font-medium text-ink">{row.original.name}</div>
          <div className="font-mono text-meta text-muted">{row.original.code}</div>
        </div>
      ),
    }),
    projectHelper.display({ id: 'status', header: '状态', size: 90, cell: ({ row }) => <Badge tone={toneOf(row.original.status)}>{STATUS_LABEL[row.original.status as keyof typeof STATUS_LABEL] ?? row.original.status}</Badge> }),
    projectHelper.display({ id: 'owner', header: '负责人', size: 100, cell: ({ row }) => row.original.owner }),
    projectHelper.display({ id: 'target', header: '目标日', size: 110, cell: ({ row }) => <span className="text-label text-faint">{row.original.targetDate || '—'}</span> }),
  ])

  const itemColumns = itemHelper.columns([
    itemHelper.display({ id: 'type', header: '类型', size: 120, cell: ({ row }) => <Badge>{REF_TYPE_LABEL[row.original.refType as DeliveryRefType] ?? row.original.refType}</Badge> }),
    itemHelper.display({ id: 'ref', header: '引用', cell: ({ row }) => <span className="font-mono text-label text-muted">{row.original.refId}</span> }),
    itemHelper.display({ id: 'note', header: '备注', size: 200, cell: ({ row }) => <span className="text-label text-muted">{row.original.note || '—'}</span> }),
    itemHelper.display({
      id: 'actions',
      header: '操作',
      size: 100,
      cell: ({ row }) => current && (current.status === 'DRAFT' || current.status === 'IN_PROGRESS')
        ? <Button size="sm" variant="text" disabled={removeItem.isPending} onClick={() => removeItem.mutate(row.original.id)}><Trash2 size={12} />移除</Button>
        : null,
    }),
  ])

  const eventColumns = eventHelper.columns([
    eventHelper.display({ id: 'type', header: '事件', size: 110, cell: ({ row }) => <Badge>{row.original.eventType}</Badge> }),
    eventHelper.display({
      id: 'detail',
      header: '说明',
      cell: ({ row }) => (
        <div>
          <div className="text-label text-muted">{row.original.detail}</div>
          <div className="text-meta text-muted">{row.original.actor} · {formatDateTime(row.original.createdAt)}</div>
        </div>
      ),
    }),
  ])

  return (
    <div>
      <Breadcrumb items={[{ label: '工作概览' }, { label: '交付中心' }]} trailing={<span>证据包不含行级数据与凭据</span>} />
      <PageHeading
        title="交付中心"
        description="交付项目、验收证据包与交付闭环。"
        actions={
          <>
            <Button onClick={() => void listRequest.refetch()} disabled={listRequest.isFetching}><RefreshCw size={14} className={listRequest.isFetching ? 'animate-spin' : undefined} />刷新</Button>
            <Button variant="primary" onClick={() => { setCreateError(null); setCreateOpen(true) }}><Plus size={14} />新建交付项目</Button>
          </>
        }
      />

      {listRequest.isPending ? <LoadingBlock>正在读取交付项目…</LoadingBlock> : null}
      {listRequest.isError ? (
        <Panel>
          <EmptyState minHeight={220} icon={<ShieldCheck />} title="交付服务暂不可用" description="控制面交付模块不可达；本页不显示静态回退。" action={<Button onClick={() => void listRequest.refetch()}>重试</Button>} />
        </Panel>
      ) : null}

      {listRequest.isSuccess ? (
        <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
          <Panel className="flex flex-col">
            <PanelHead title="项目目录" count={projects.length} />
            <div className="flex items-center gap-2 px-[18px] pb-2">
              <SearchField value={searchInput} onValueChange={setSearchInput} placeholder="搜索项目代码/名称/负责人" className="w-full" />
            </div>
            <div className="flex items-center gap-2 px-[18px] pb-2">
              <Button size="sm" onClick={() => setQuery(searchInput.trim())}>查询</Button>
              {query ? <Button size="sm" variant="quiet" onClick={() => { setQuery(''); setSearchInput('') }}>清除</Button> : null}
            </div>
            <ul className="m-0 min-h-0 flex-1 list-none px-2 pb-2">
              {projects.map((project) => {
                const active = project.id === current?.id
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(project.id)}
                      className={`mb-1 w-full rounded-control px-2.5 py-2 text-left ${active ? 'bg-blue-soft' : 'hover:bg-wash'}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-body-sm text-ink-soft">{project.name}</span>
                        <Badge tone={toneOf(project.status)}>{STATUS_LABEL[project.status as keyof typeof STATUS_LABEL] ?? project.status}</Badge>
                      </span>
                      <span className="mt-0.5 block font-mono text-meta text-muted">{project.code}</span>
                    </button>
                  </li>
                )
              })}
              {projects.length === 0 ? <li className="px-3 py-6 text-center text-label text-muted">{query ? '没有匹配的交付项目。' : '还没有交付项目。'}</li> : null}
            </ul>
          </Panel>

          <div className="space-y-3.5">
            {!current ? (
              <Panel>
                <EmptyState minHeight={280} icon={<ShieldCheck />} title="还没有交付项目" description="创建项目后引用资产、看板、数据服务或 AI 产品，再提交验收。" action={<Button onClick={() => setCreateOpen(true)}>新建交付项目</Button>} />
              </Panel>
            ) : (
              <>
                <Panel>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={toneOf(current.status)}>{STATUS_LABEL[current.status as keyof typeof STATUS_LABEL] ?? current.status}</Badge>
                        <span className="font-mono text-meta text-muted">{current.code}</span>
                      </div>
                      <h2 className="mt-1.5 text-subject font-semibold text-ink">{current.name}</h2>
                      <p className="mt-1 text-label text-muted">{current.scope || '未填写交付范围'} · 负责人 {current.owner} · 目标日 {current.targetDate || '未定'}</p>
                      {current.acceptedSnapshotId ? <p className="mt-1 text-meta text-muted">验收快照 {current.acceptedSnapshotId.slice(0, 12)}…</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => { setItemError(null); setItemOpen(true) }} disabled={current.status === 'ACCEPTED' || current.status === 'ARCHIVED'}>引用交付对象</Button>
                      <Button size="sm" onClick={() => snapshot.mutate()} disabled={snapshot.isPending || current.status === 'ARCHIVED'}>生成证据快照</Button>
                      <Button size="sm" variant="primary" onClick={() => submit.mutate()} disabled={submit.isPending || current.status === 'ACCEPTED' || current.status === 'ARCHIVED'}>提交验收</Button>
                      {current.status === 'READY_FOR_ACCEPTANCE' ? <Button size="sm" variant="primary" onClick={() => accept.mutate()} disabled={accept.isPending}>验收通过</Button> : null}
                      <Button size="sm" onClick={() => void downloadEvidenceZip(current.id).then(() => notify('证据包已开始下载')).catch((cause: unknown) => notify(cause instanceof Error ? cause.message : '证据包下载失败'))}><Download size={13} />证据包</Button>
                      {current.status !== 'ARCHIVED' ? <Button size="sm" variant="danger-outline" onClick={() => setArchiveTarget(current)}>归档</Button> : null}
                    </div>
                  </div>

                  {blockers && blockers.length > 0 ? (
                    <div role="alert" className="border-b border-line bg-[#fdf9ef] px-5 py-3 text-label text-amber">
                      <strong>提交被阻断：</strong>以下交付项尚不可交付
                      <ul className="mt-1 space-y-1">
                        {blockers.map((blocker) => (
                          <li key={`${blocker.refType}-${blocker.refId}`}>
                            {REF_TYPE_LABEL[blocker.refType as DeliveryRefType] ?? blocker.refType} · <span className="font-mono">{blocker.refId}</span>：{blocker.reasons.join('；')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="px-5 py-4">
                    {detailRequest.isPending ? <Skeleton rows={3} /> : null}
                    {detailRequest.isError ? <p className="text-label text-red">交付详情读取失败，请刷新后重试。</p> : null}
                    {detail ? (
                      <>
                        <h3 className="mb-1.5 text-label font-medium text-ink-soft">交付对象<Count>{detail.items.length}</Count></h3>
                        <DataTable
                          columns={itemColumns}
                          data={detail.items}
                          getRowId={(item) => item.id}
                          empty={<p className="py-2 text-label text-muted">还没有引用交付对象。</p>}
                        />
                      </>
                    ) : null}
                  </div>
                </Panel>

                {detail ? (
                  <div className="grid grid-cols-2 gap-3.5 max-[1100px]:grid-cols-1">
                    <Panel>
                      <PanelHead title="证据快照" count={detail.snapshots.length} description="幂等：同一内容重复生成不产生新快照" />
                      <ol className="m-0 list-none px-4 pb-4">
                        {detail.snapshots.map((snap) => (
                          <li key={snap.id} className="border-b border-line-soft py-1.5 text-label last:border-b-0">
                            <span className="font-mono text-meta text-muted">{snap.id.slice(0, 12)}…</span>
                            <span className="ml-2 text-muted">checksum {snap.checksum.slice(0, 10)}… · {formatDateTime(snap.createdAt)} · {snap.createdBy}</span>
                          </li>
                        ))}
                        {detail.snapshots.length === 0 ? <li className="py-2 text-label text-muted">还没有证据快照。</li> : null}
                      </ol>
                    </Panel>
                    <Panel>
                      <PanelHead title="交付事件" count={detail.events.length} description="创建、引用、快照、提交与验收留痕" />
                      <div className="px-4 pb-4">
                        <DataTable columns={eventColumns} data={detail.events} getRowId={(event, index) => `${event.eventType}-${event.createdAt}-${index}`} empty={<p className="py-2 text-label text-muted">还没有事件。</p>} />
                      </div>
                    </Panel>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建交付项目"
        description="项目创建后为草稿；引用交付对象后提交验收。"
        width={540}
        dirty={Boolean(createForm.name.trim() || createForm.owner.trim()) && !createMutation.isPending}
        footer={
          <DialogFooter note="证据包不含行级数据与凭据">
            <Button onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>取消</Button>
            <Button variant="primary" disabled={createMutation.isPending || !createForm.code.trim() || !createForm.name.trim() || !createForm.owner.trim()} onClick={() => { setCreateError(null); createMutation.mutate() }}>
              {createMutation.isPending ? '创建中…' : '创建项目'}
            </Button>
          </DialogFooter>
        }
      >
        <FormGrid>
          <FormField label="项目代码" required htmlFor="delivery-code"><Input id="delivery-code" value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} placeholder="例如：DEL-2026-EP" /></FormField>
          <FormField label="项目名称" required htmlFor="delivery-name"><Input id="delivery-name" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="例如：电子处方域交付" /></FormField>
          <FormField label="交付范围" htmlFor="delivery-scope"><Input id="delivery-scope" value={createForm.scope} onChange={(event) => setCreateForm({ ...createForm, scope: event.target.value })} placeholder="域/系统/数据集范围" /></FormField>
          <FormField label="负责人" required htmlFor="delivery-owner"><Input id="delivery-owner" value={createForm.owner} onChange={(event) => setCreateForm({ ...createForm, owner: event.target.value })} placeholder="责任人" /></FormField>
        </FormGrid>
        <FormField label="目标日期" htmlFor="delivery-target"><Input id="delivery-target" type="date" value={createForm.targetDate} onChange={(event) => setCreateForm({ ...createForm, targetDate: event.target.value })} className="w-[200px]" /></FormField>
        {createError ? <p role="alert" className="mt-2 text-body-sm text-red">{createError}</p> : null}
      </Dialog>

      <Dialog
        open={itemOpen}
        onOpenChange={setItemOpen}
        title="引用交付对象"
        description="把已发布的资产、看板、数据服务或 AI 产品引用进当前项目。"
        width={540}
        dirty={Boolean(itemForm.refId.trim()) && !addItem.isPending}
        footer={
          <DialogFooter note="仅引用已存在的对象，不复制定义">
            <Button onClick={() => setItemOpen(false)} disabled={addItem.isPending}>取消</Button>
            <Button variant="primary" disabled={addItem.isPending || !itemForm.refId.trim()} onClick={() => { setItemError(null); addItem.mutate() }}>
              {addItem.isPending ? '引用中…' : '引用对象'}
            </Button>
          </DialogFooter>
        }
      >
        <FormNotice icon={<ShieldCheck />}>被引用对象必须已发布或已认证；未满足可交付性的对象会在提交验收时被逐项阻断。</FormNotice>
        <FormGrid>
          <FormField label="对象类型" htmlFor="item-type">
            <NativeSelect id="item-type" className="min-h-[35px]" value={itemForm.refType} onChange={(event) => setItemForm({ ...itemForm, refType: event.target.value as DeliveryRefType })}>
              {DELIVERY_REF_TYPES.map((type) => <option key={type} value={type}>{REF_TYPE_LABEL[type]}</option>)}
            </NativeSelect>
          </FormField>
          <FormField label="对象标识" required htmlFor="item-ref"><Input id="item-ref" value={itemForm.refId} onChange={(event) => setItemForm({ ...itemForm, refId: event.target.value })} placeholder="资产 FQN / 看板 id / 服务代码 / 产品 id" /></FormField>
        </FormGrid>
        <FormField label="备注" htmlFor="item-note"><Input id="item-note" value={itemForm.note} onChange={(event) => setItemForm({ ...itemForm, note: event.target.value })} placeholder="引用口径或验收说明" /></FormField>
        {itemError ? <p role="alert" className="mt-2 text-body-sm text-red">{itemError}</p> : null}
      </Dialog>

      <Confirm
        open={archiveTarget !== null}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null) }}
        title={`归档 ${archiveTarget?.name ?? ''}`}
        description="项目将归档并从进行中列表退出；历史快照、事件与证据包保留。"
        object={archiveTarget ? { name: archiveTarget.name, meta: archiveTarget.code } : undefined}
        confirmLabel="归档项目"
        tone="destructive"
        busy={archive.isPending}
        onConfirm={() => archiveTarget && archive.mutate(archiveTarget)}
      />
    </div>
  )
}

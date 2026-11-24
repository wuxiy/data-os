import { LoadingBlock } from '@/components/app/loading'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CloudCog, History, LockKeyhole, RefreshCw, Server, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { FormGrid } from '@/components/app/form-grid'
import { NativeSelect } from '../../components/kit/input'
import { Confirm, Dialog, DialogFooter, Sheet, SheetBody, SheetFooterActions } from '../../components/kit/overlay'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel, PanelHead } from '../../components/kit/panel'
import { EmptyState } from '../../components/kit/states'
import { DataTable, listColumnHelper } from '../../components/table/data-table'
import { useNotice } from '../../components/kit/toast'
import {
  deleteEdgeNode,
  probeEdgeNode,
  recordEdgeDeployment,
  saveEdgeNode,
  type EdgeDeploymentApiItem,
  type EdgeNodeApiItem,
  type EdgeWatermarkTable,
} from '../../data/controlPlane'
import { formatDateTime } from '../../data/domain'
import { usePortalNavigate } from '../../app/navigate'
import { edgeDeploymentsQuery, edgeNodesQuery, edgeWatermarksQuery, platformOperationsQuery } from './queries'

const nodeHelper = listColumnHelper<EdgeNodeApiItem>()
const deploymentHelper = listColumnHelper<EdgeDeploymentApiItem>()
const watermarkHelper = listColumnHelper<EdgeWatermarkTable>()

function nodeTone(state: EdgeNodeApiItem['state']): 'success' | 'error' | 'outline' {
  return state === 'ONLINE' ? 'success' : state === 'OFFLINE' ? 'error' : 'outline'
}

/**
 * 平台运维（技术角色）：组件探针、前置机登记与版本历史、采集水位。
 * 403/无权限与网络失败分开提示；不暴露内部凭据；前置机登记是短表单 Dialog，
 * 版本历史是 Sheet（速览），登记新版本内联在 Sheet 中。
 */
export function PlatformOperationsPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EdgeNodeApiItem | null>(null)
  const [form, setForm] = useState({ name: '', groupName: '', site: '', host: '', port: '8443', version: '', relayPrefix: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [historyNode, setHistoryNode] = useState<EdgeNodeApiItem | null>(null)
  const [deployForm, setDeployForm] = useState({ version: '', artifactRef: '', note: '' })
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EdgeNodeApiItem | null>(null)

  const platformRequest = useQuery(platformOperationsQuery())
  const nodesRequest = useQuery(edgeNodesQuery())
  const watermarksRequest = useQuery(edgeWatermarksQuery())
  const deploymentsRequest = useQuery({ ...edgeDeploymentsQuery(historyNode?.id ?? ''), enabled: historyNode !== null })

  const forbidden = platformRequest.error && typeof platformRequest.error === 'object' && 'status' in platformRequest.error && (platformRequest.error as { status: number }).status === 403
  const nodes = nodesRequest.data?.items ?? []

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['operations', 'edge-nodes'] })
    void queryClient.invalidateQueries({ queryKey: ['operations', 'platform'] })
  }

  const save = useMutation({
    mutationFn: () => saveEdgeNode({
      name: form.name.trim(), groupName: form.groupName.trim() || undefined, site: form.site.trim() || undefined,
      host: form.host.trim(), port: Number(form.port) || 8443, version: form.version.trim() || undefined,
      config: form.relayPrefix.trim() ? { relayPrefix: form.relayPrefix.trim() } : undefined,
    }, editing?.id),
    onSuccess: (node) => {
      invalidate()
      setFormOpen(false)
      setEditing(null)
      notify(`前置机已保存：${node.name}`)
    },
    onError: (cause) => setFormError(cause instanceof Error ? cause.message : '前置机节点保存失败'),
  })

  const probe = useMutation({
    mutationFn: (node: EdgeNodeApiItem) => probeEdgeNode(node.id),
    onSuccess: (node) => {
      invalidate()
      notify(node.lastProbeOk ? `探活成功：${node.name}` : `探活失败：${node.lastProbeMessage ?? node.name}`)
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '探活请求失败'),
  })

  const recordDeployment = useMutation({
    mutationFn: () => recordEdgeDeployment(historyNode!.id, { version: deployForm.version.trim(), artifactRef: deployForm.artifactRef.trim() || undefined, note: deployForm.note.trim() || undefined }),
    onSuccess: () => {
      invalidate()
      setDeployForm({ version: '', artifactRef: '', note: '' })
      notify('版本记录已追加')
    },
    onError: (cause) => setDeployError(cause instanceof Error ? cause.message : '版本记录失败'),
  })

  const removeNode = useMutation({
    mutationFn: (node: EdgeNodeApiItem) => deleteEdgeNode(node.id),
    onSuccess: () => { invalidate(); setDeleteTarget(null); notify('前置机节点已删除') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : '删除失败'),
  })

  function openCreate() {
    setEditing(null)
    setForm({ name: '', groupName: '', site: '', host: '', port: '8443', version: '', relayPrefix: '' })
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(node: EdgeNodeApiItem) {
    setEditing(node)
    setForm({
      name: node.name, groupName: node.groupName, site: node.site, host: node.host, port: String(node.port),
      version: node.version, relayPrefix: typeof node.config?.relayPrefix === 'string' ? node.config.relayPrefix : '',
    })
    setFormError(null)
    setFormOpen(true)
  }

  const platform = platformRequest.data
  const operationalLabel = platform?.operational.state === 'READY'
    ? '核心链路就绪'
    : platform?.operational.state === 'DEGRADED' ? '核心链路降级' : '核心链路未知'

  const nodeColumns = nodeHelper.columns([
    nodeHelper.display({
      id: 'name',
      header: '前置机',
      cell: ({ row }) => (
        <div>
          <div className="text-body-sm font-medium text-ink">{row.original.name}</div>
          <div className="text-meta text-muted-foreground">{row.original.groupName || '未分组'} · {row.original.site || '未标注站点'}</div>
        </div>
      ),
    }),
    nodeHelper.display({ id: 'addr', header: '地址', size: 200, cell: ({ row }) => <span className="font-mono text-label text-muted-foreground">{row.original.host}:{row.original.port}</span> }),
    nodeHelper.display({ id: 'version', header: '版本', size: 100, cell: ({ row }) => <span className="font-mono text-label">{row.original.version || '—'}</span> }),
    nodeHelper.display({ id: 'state', header: '状态', size: 100, cell: ({ row }) => <Badge variant={nodeTone(row.original.state)}>{row.original.state === 'ONLINE' ? '在线' : row.original.state === 'OFFLINE' ? '离线' : '未知'}</Badge> }),
    nodeHelper.display({ id: 'probe', header: '最近探活', size: 170, cell: ({ row }) => row.original.lastProbeAt
      ? <span className="text-label text-muted-foreground">{formatDateTime(row.original.lastProbeAt)}{row.original.lastProbeOk === false ? ' · 失败' : ''}</span>
      : <span className="text-label text-faint">未探活</span> }),
    nodeHelper.display({
      id: 'actions',
      header: '操作',
      size: 280,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <Button variant="outline" size="sm" disabled={probe.isPending} onClick={() => probe.mutate(row.original)}>探活</Button>
          <Button variant="outline" size="sm" onClick={() => openEdit(row.original)}>编辑</Button>
          <Button variant="outline" size="sm" onClick={() => setHistoryNode(row.original)}><History size={12} />版本</Button>
          <Button size="sm" variant="destructive-outline" onClick={() => setDeleteTarget(row.original)}>删除</Button>
        </div>
      ),
    }),
  ])

  const deploymentColumns = deploymentHelper.columns([
    deploymentHelper.accessor('version', { header: '版本', size: 100, cell: ({ row }) => <span className="font-mono text-label">{row.original.version}</span> }),
    deploymentHelper.display({ id: 'artifact', header: '制品引用', cell: ({ row }) => <span className="font-mono text-meta text-muted-foreground">{row.original.artifactRef || '—'}</span> }),
    deploymentHelper.display({ id: 'note', header: '说明', cell: ({ row }) => <span className="text-label text-muted-foreground">{row.original.note || '—'}</span> }),
    deploymentHelper.display({ id: 'at', header: '登记时间', size: 140, cell: ({ row }) => <span className="text-meta text-muted-foreground">{formatDateTime(row.original.deployedAt)} · {row.original.deployedBy}</span> }),
  ])

  const watermarkColumns = watermarkHelper.columns([
    watermarkHelper.display({ id: 'dataset', header: '数据集', cell: ({ row }) => <span className="font-mono text-label text-ink">{row.original.dataset}</span> }),
    watermarkHelper.display({ id: 'rows', header: '总行数', size: 120, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-label">{row.original.totalRows.toLocaleString()}</span> }),
    watermarkHelper.display({ id: 'latest', header: '最近写入', size: 150, cell: ({ row }) => <span className="text-label text-muted-foreground">{formatDateTime(row.original.latestWriteAt)}</span> }),
    watermarkHelper.display({ id: 'daily', header: '近 7 日', size: 220, cell: ({ row }) => <span className="text-meta text-muted-foreground">{row.original.dailyCounts.map((item) => `${item.date.slice(5)}:${item.count}`).join(' · ') || '—'}</span> }),
  ])

  if (forbidden || (platformRequest.isError && !platform)) {
    return (
      <div>
        <Breadcrumb items={[{ label: '平台管理' }, { label: '平台运维' }]} />
        <PageHeading title="平台运维" description="面向技术角色的组件状态与前置机登记。" />
        <Panel>
          <EmptyState
            minHeight={240}
            icon={<LockKeyhole />}
            title="无技术域访问权限"
            description="当前身份未被授予技术域访问权限；如需排查，请联系平台管理员。"
            action={<Button variant="outline" onClick={() => navigate('/')}>返回总览</Button>}
          />
        </Panel>
      </div>
    )
  }

  return (
    <div>
      <Breadcrumb items={[{ label: '平台管理' }, { label: '平台运维' }]} trailing={platform ? <span>检查于 {formatDateTime(platform.checkedAt)}</span> : null} />
      <PageHeading
        title="平台运维"
        description="组件探针、前置机登记与版本历史、采集水位；技术角色可见。"
        actions={<Button variant="outline" onClick={() => void platformRequest.refetch()} disabled={platformRequest.isFetching}><RefreshCw size={14} className={platformRequest.isFetching ? 'animate-spin' : undefined} />刷新</Button>}
      />

      {platformRequest.isPending ? <LoadingBlock>正在读取平台组件状态…</LoadingBlock> : null}

      {platform ? (
        <Panel className="mb-3.5">
          <PanelHead
            title="核心链路"
            description={`覆盖 ${platform.operational.ready}/${platform.operational.total} 组件 · 降级 ${platform.operational.degraded} · 未知 ${platform.operational.unknown}`}
            actions={<Badge variant={platform.operational.state === 'READY' ? 'success' : platform.operational.state === 'DEGRADED' ? 'warning' : 'outline'}>{operationalLabel}</Badge>}
          />
          <ul className="m-0 grid list-none grid-cols-3 gap-3 px-5 pb-4 max-[1100px]:grid-cols-1">
            {platform.services.map((service) => (
              <li key={service.key} className="rounded-control border border-line px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-body-sm text-ink-soft">{service.name}</strong>
                  <Badge variant={service.status === 'UP' ? 'success' : service.status === 'DOWN' ? 'error' : 'outline'}>
                    {service.status === 'UP' ? '正常' : service.status === 'DOWN' ? '不可达' : '未配置'}
                  </Badge>
                </div>
                <p className="mt-1 text-meta text-muted-foreground">{service.role}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="mb-3.5">
        <PanelHead
          title="前置机节点"
          count={nodes.length}
          description="登记、探活与版本历史；凭据只以引用形式保存"
          actions={<Button size="sm" onClick={openCreate}><Server size={13} />登记前置机</Button>}
        />
        <Alert variant="info" role="note" className="mb-4">
          <ShieldCheck />
          <AlertDescription>
            前置机是院内采集代理的受控入口；门户只保存地址与版本，不含任何连接口令或令牌。
          </AlertDescription>
        </Alert>
        <div className="px-4 pb-4">
          {nodesRequest.isPending ? <LoadingBlock className="min-h-[160px]">正在读取前置机…</LoadingBlock> : null}
          {nodesRequest.isError ? (
            <Alert variant="error" className="mb-2">
              <CircleAlert />
              <AlertDescription>前置机清单读取失败，请稍后重试。</AlertDescription>
            </Alert>
          ) : null}
          {nodesRequest.isSuccess ? (
            <DataTable
              columns={nodeColumns}
              data={nodes}
              getRowId={(node) => node.id}
              rowLabel={(node) => node.name}
              empty={<EmptyState minHeight={180} icon={<Server />} title="还没有前置机节点" description="登记院内部署的采集代理后，可探活并记录版本。" action={<Button variant="outline" onClick={openCreate}>登记前置机</Button>} />}
            />
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHead title="采集水位" count={watermarksRequest.data?.tables.length} description="只读聚合：总行数、最近写入与近 7 日计数" actions={watermarksRequest.data ? <span className="text-meta text-muted-foreground">统计于 {formatDateTime(watermarksRequest.data.asOf)}</span> : null} />
        <div className="px-4 pb-4">
          {watermarksRequest.isPending ? <LoadingBlock className="min-h-[140px]">正在读取水位…</LoadingBlock> : null}
          {watermarksRequest.isError ? (
            <div className="py-4 text-center text-label text-amber">
              <CloudCog className="mx-auto mb-1 size-5" />
              采集水位暂不可用；不影响前置机与组件状态。
            </div>
          ) : null}
          {watermarksRequest.isSuccess ? (
            <DataTable
              columns={watermarkColumns}
              data={watermarksRequest.data?.tables ?? []}
              getRowId={(table) => table.key}
              empty={<EmptyState minHeight={160} title="暂无水位表" description="边缘表有写入后显示最近写入与日计数。" />}
            />
          ) : null}
        </div>
      </Panel>

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? `编辑前置机 · ${editing.name}` : '登记前置机'}
        description="保存地址、分组与版本；连接凭据走凭据引用，不在门户保存。"
        width={540}
        dirty={Boolean(form.name.trim() || form.host.trim()) && !save.isPending}
        footer={
          <DialogFooter note="不含口令与令牌">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={save.isPending}>取消</Button>
            <Button disabled={save.isPending || !form.name.trim() || !form.host.trim()} onClick={() => { setFormError(null); save.mutate() }}>
              {save.isPending ? '保存中…' : '保存前置机'}
            </Button>
          </DialogFooter>
        }
      >
        <FormGrid>
          <Field>
            <FieldLabel>
              名称 <span className="text-destructive-foreground">*</span>
            </FieldLabel>
            <Input id="edge-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：门诊前置机 01" />
          </Field>
          <Field>
            <FieldLabel>分组</FieldLabel>
            <Input id="edge-group" value={form.groupName} onChange={(event) => setForm({ ...form, groupName: event.target.value })} placeholder="例如：门诊楼" />
          </Field>
          <Field>
            <FieldLabel>站点</FieldLabel>
            <Input id="edge-site" value={form.site} onChange={(event) => setForm({ ...form, site: event.target.value })} placeholder="例如：主院区" />
          </Field>
          <Field>
            <FieldLabel>版本</FieldLabel>
            <Input id="edge-version" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="例如：1.4.2" />
          </Field>
          <Field>
            <FieldLabel>
              主机 <span className="text-destructive-foreground">*</span>
            </FieldLabel>
            <Input id="edge-host" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="10.0.0.12" />
          </Field>
          <Field>
            <FieldLabel>端口</FieldLabel>
            <Input id="edge-port" type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} />
          </Field>
        </FormGrid>
        <Field className="mb-4">
          <FieldLabel>转发前缀（可选）</FieldLabel>
          <Input id="edge-prefix" value={form.relayPrefix} onChange={(event) => setForm({ ...form, relayPrefix: event.target.value })} placeholder="例如：/edge/outpatient" />
          <FieldDescription>院内代理的受控转发路径前缀；不是地址或凭据。</FieldDescription>
        </Field>
        {formError ? (
          <Alert variant="error" className="mt-2">
            <CircleAlert />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
      </Dialog>

      <Sheet
        open={historyNode !== null}
        onOpenChange={(open) => { if (!open) setHistoryNode(null) }}
        title="版本登记与历史"
        subtitle={historyNode ? `${historyNode.name} · ${historyNode.host}:${historyNode.port}` : undefined}
        width={560}
        footer={<SheetFooterActions hint="版本记录只追加，不删除历史。"><Button variant="outline" onClick={() => setHistoryNode(null)}>关闭</Button></SheetFooterActions>}
      >
        <SheetBody>
          <div className="mb-3 rounded-control border border-line bg-wash px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-label text-muted-foreground">当前版本</span>
              <span className="font-mono text-body-sm text-ink-soft">{historyNode?.version || '未登记'}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-label text-muted-foreground">最近探活</span>
              <span className="text-label text-ink-soft">{historyNode?.lastProbeAt ? `${formatDateTime(historyNode.lastProbeAt)}${historyNode.lastProbeOk === false ? ' · 失败' : ' · 正常'}` : '未探活'}</span>
            </div>
            {historyNode?.lastProbeMessage ? <p className="mt-1 text-meta text-muted-foreground">{historyNode.lastProbeMessage}</p> : null}
          </div>

          <h3 className="mb-1.5 text-label font-medium text-ink-soft">追加版本记录</h3>
          <FormGrid>
            <Field>
              <FieldLabel>
                版本 <span className="text-destructive-foreground">*</span>
              </FieldLabel>
              <Input id="deploy-version" value={deployForm.version} onChange={(event) => setDeployForm({ ...deployForm, version: event.target.value })} placeholder="例如：1.4.3" />
            </Field>
            <Field>
              <FieldLabel>制品引用</FieldLabel>
              <Input id="deploy-artifact" value={deployForm.artifactRef} onChange={(event) => setDeployForm({ ...deployForm, artifactRef: event.target.value })} placeholder="构建号/镜像标签" />
            </Field>
          </FormGrid>
          <Field className="mb-4">
            <FieldLabel>说明</FieldLabel>
            <Input id="deploy-note" value={deployForm.note} onChange={(event) => setDeployForm({ ...deployForm, note: event.target.value })} placeholder="变更内容或回滚依据" />
          </Field>
          {deployError ? (
            <Alert variant="error" className="mb-2">
              <CircleAlert />
              <AlertDescription>{deployError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="mb-4 flex justify-end">
            <Button size="sm" disabled={!deployForm.version.trim() || recordDeployment.isPending} onClick={() => { setDeployError(null); recordDeployment.mutate() }}>
              {recordDeployment.isPending ? '登记中…' : '追加记录'}
            </Button>
          </div>

          <h3 className="mb-1.5 text-label font-medium text-ink-soft">发布历史</h3>
          {deploymentsRequest.isPending ? <LoadingBlock className="min-h-[120px]">正在读取历史…</LoadingBlock> : null}
          {deploymentsRequest.isError ? <p className="text-label text-red">版本历史读取失败。</p> : null}
          {deploymentsRequest.isSuccess ? (
            <DataTable
              columns={deploymentColumns}
              data={deploymentsRequest.data ?? []}
              getRowId={(deployment) => deployment.id}
              empty={<p className="py-2 text-label text-muted-foreground">还没有版本记录。</p>}
            />
          ) : null}
        </SheetBody>
      </Sheet>

      <Confirm
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`删除前置机 ${deleteTarget?.name ?? ''}`}
        description="节点登记将被删除；已产生的版本记录与水位数据保留。"
        object={deleteTarget ? { name: deleteTarget.name, meta: `${deleteTarget.host}:${deleteTarget.port}` } : undefined}
        hint="删除后需重新登记才能探活。"
        confirmLabel="删除节点"
        tone="destructive"
        busy={removeNode.isPending}
        onConfirm={() => deleteTarget && removeNode.mutate(deleteTarget)}
      />

      {platformRequest.isError && platform ? (
        <p className="mt-2 flex items-center gap-1.5 text-meta text-amber"><TriangleAlert size={13} />组件状态刷新失败，显示的是上次成功结果。</p>
      ) : null}
    </div>
  )
}

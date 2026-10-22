import { Archive, Ban, CheckCircle2, Download, FileArchive, PackageCheck, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Select, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { PageHeader } from '../components/ui/PageHeader'
import {
  acceptDelivery,
  addDeliveryItem,
  archiveDelivery,
  createDeliveryProject,
  DELIVERY_REF_TYPES,
  downloadEvidenceZip,
  fetchDeliveries,
  fetchDeliveryDetail,
  REF_TYPE_LABEL,
  removeDeliveryItem,
  snapshotDelivery,
  startDelivery,
  STATUS_LABEL,
  statusTone,
  submitDelivery,
  type DeliveryBlocker,
  type DeliveryDetailView,
  type DeliveryProjectView,
  type DeliveryRefType,
} from '../data/deliveryApi'
import { frontendDemoMode } from '../data/runtimeMode'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import { useKeyedResource } from '../hooks/useKeyedResource'
import { usePaged } from '../hooks/usePaged'
import styles from './Pages.module.css'
import local from './DeliveryCenterPage.module.css'

/**
 * 交付中心（G25）：交付项目全生命周期闭环——项目、交付项（四类引用）、
 * 阻断项（提交逐项检查的 409 阻断面）、证据快照（幂等）、验收与证据包下载。
 * 演示构建保留显式样例；真实构建不回静态数据。
 */

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR: Record<string, string> = {
  healthy: 'success',
  warning: 'warning',
  danger: 'error',
  neutral: 'default',
}

const DRAWER_WIDTH = 'min(540px, 44vw)'
const PROJECT_PAGE_SIZE = 8
const NEXT_STEP: Record<string, string> = {
  DRAFT: '核对交付范围并添加交付项，准备完成后启动项目。',
  IN_PROGRESS: '核查交付项并生成证据快照，通过检查后提交验收。',
  READY_FOR_ACCEPTANCE: '复核交付项与证据快照，确认后完成验收。',
  ACCEPTED: '已通过验收，可下载证据包并归档项目。',
  ARCHIVED: '项目已归档，可查询验收证据与操作留痕。',
}

interface Props {
  onNotice: (message: string) => void
}

export function DeliveryCenterPage({ onNotice }: Props) {
  if (frontendDemoMode) {
    return (
      <div className={styles.page}>
        <PageHeader title="交付中心" eyebrow="交付治理" subtitle="交付项目、验收证据包与交付闭环" />
        <div className={styles.content}>
          <DemoDataBoundary moduleName="交付中心">
            <section className={styles.panel}>
              <div className={styles.panelHeader}><h2>演示样例</h2><p>真实构建将展示交付项目、阻断项、证据快照与验收闭环</p></div>
              <p className={styles.emptyState}>接入控制面交付模块后，此处按项目展示四类交付项引用、逐项可交付性检查结果与不可变验收证据包。</p>
            </section>
          </DemoDataBoundary>
        </div>
      </div>
    )
  }
  return <DeliveryCenterLive onNotice={onNotice} />
}

function DeliveryCenterLive({ onNotice }: Props) {
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [blockers, setBlockers] = useState<DeliveryBlocker[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ code: '', name: '', scope: '', owner: '', targetDate: '' })
  const [itemForm, setItemForm] = useState<{ refType: DeliveryRefType; refId: string; note: string }>({
    refType: 'DATA_SERVICE', refId: '', note: '',
  })

  const [projects, setProjects] = useState<DeliveryProjectView[]>([])
  const listState = useApiResource({
    timeoutMs: 15000,
    reloadKey: `${query}|${reloadKey}`,
    load: (signal) => fetchDeliveries(signal, query),
    onData: setProjects,
    onUnavailable: () => setProjects([]),
  })
  const [detail, setDetail] = useState<DeliveryDetailView | null>(null)
  const detailState = useKeyedResource({
    key: selectedId ? `${selectedId}|${reloadKey}` : null,
    load: (signal) => fetchDeliveryDetail(signal, selectedId),
    onData: setDetail,
    onReset: () => setDetail(null),
    onError: () => setDetail(null),
  })

  const paged = usePaged(projects, PROJECT_PAGE_SIZE)
  const action = useAction()
  const current = detail?.project ?? null

  function refresh() {
    setReloadKey((key) => key + 1)
  }

  function selectProject(id: string) {
    setSelectedId(id)
    setBlockers(null)
  }

  function runAction(key: string, fallback: string, task: () => Promise<void>) {
    return action.run(key, fallback, task)
  }

  async function handleSubmit(id: string) {
    setBlockers(null)
    const result = await submitDelivery(id)
    if (result.ok) {
      onNotice('提交验收成功：全部交付项通过可交付性检查')
    } else {
      setBlockers(result.blockers ?? [])
      onNotice(result.message ?? '提交被阻断：存在不可交付项')
    }
    refresh()
  }

  const projectColumns: ColumnsType<DeliveryProjectView> = [
    { title: '交付项目', key: 'name', width: 190, render: (_, project) => <div className={local.projectIdentity}><Button type="link" size="small" className={local.projectSelect} aria-pressed={selectedId === project.id} onClick={(event) => { event.stopPropagation(); selectProject(project.id) }}>{project.name}</Button><small>{project.code}</small></div> },
    { title: '负责人', key: 'owner', render: (_, project) => project.owner || '—' },
    {
      title: '状态',
      key: 'status',
      render: (_, project) => <Tag color={TONE_COLOR[statusTone(project.status)]}>{STATUS_LABEL[project.status as keyof typeof STATUS_LABEL] ?? project.status}</Tag>,
    },
    {
      title: '目标日期',
      key: 'targetDate',
      align: 'right',
      render: (_, project) => <small>{project.targetDate || '—'}</small>,
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      align: 'right',
      render: (_, project) => <small>{project.updatedAt.slice(0, 10)}</small>,
    },
  ]

  const itemColumns: ColumnsType<DeliveryDetailView['items'][number]> = [
    {
      title: '类型',
      key: 'refType',
      render: (_, item) => REF_TYPE_LABEL[item.refType as DeliveryRefType] ?? item.refType,
    },
    {
      title: '引用',
      key: 'refId',
      render: (_, item) => <span className={styles.inlineCode}>{item.refId}</span>,
    },
    { title: '备注', key: 'note', render: (_, item) => <small>{item.note || '—'}</small> },
    {
      title: '',
      key: 'actions',
      render: (_, item) => (current && (current.status === 'DRAFT' || current.status === 'IN_PROGRESS')) ? (
        <Button size="small" type="link" disabled={action.pendingKey !== null}
          onClick={() => runAction(`remove-${item.id}`, '交付项移除失败', async () => { await removeDeliveryItem(current.id, item.id); onNotice('交付项已移除'); refresh() })}>
          <Trash2 size={13} />移除
        </Button>
      ) : null,
    },
  ]

  if (listState === 'unavailable' && projects.length === 0) {
    return (
      <div className={styles.page}>
        <PageHeader title="交付中心" eyebrow="交付治理" subtitle="交付项目、验收证据包与交付闭环" />
        <div className={styles.content}>
          <section className={styles.panel} role="status">
            <div className={styles.panelHeader}><h2>交付服务暂不可用</h2></div>
            <p className={styles.emptyState}>控制面交付模块不可达；本页不显示静态回退。</p>
            <Button onClick={refresh}><RefreshCw size={14} />重试</Button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="交付中心" eyebrow="交付治理" subtitle="交付项目、验收证据包与交付闭环（证据包不含行级数据与凭据）" />
      <div className={styles.content}>
        <div className={styles.listTools}>
          <div className={styles.search}>
            <Search size={15} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { setQuery(searchInput); paged.setPage(0) } }}
              placeholder="搜索项目代码 / 名称 / 负责人"
              aria-label="搜索交付项目"
            />
          </div>
          <span className={styles.pagerInfo}>共 {projects.length} 个项目</span>
          <Button size="small" onClick={() => { setQuery(searchInput); paged.setPage(0) }}>查询</Button>
          <Button size="small" type="primary" onClick={() => { setCreateForm({ code: '', name: '', scope: '', owner: '', targetDate: '' }); setCreateOpen(true) }}>
            <Plus size={13} />新建交付项目
          </Button>
          <Button size="small" onClick={refresh}><RefreshCw size={13} />刷新</Button>
        </div>

        <div className={`${styles.twoColumns} ${local.workspace}`}>
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}>
              <div><h2>交付项目</h2><p>选择项目，核查交付项与验收证据</p></div>
              <PackageCheck size={16} aria-hidden="true" />
            </div>
            <Table<DeliveryProjectView>
              rowKey="id"
              columns={projectColumns}
              loading={listState === 'loading'}
              scroll={{ x: 600 }}
              dataSource={paged.paged}
              rowClassName={(project) => selectedId === project.id ? 'ant-table-row-selected' : ''}
              onRow={(project) => ({ onClick: () => selectProject(project.id) })}
              pagination={{
                current: paged.page + 1,
                pageSize: PROJECT_PAGE_SIZE,
                total: projects.length,
                showSizeChanger: false,
                onChange: (page) => paged.setPage(page - 1),
              }}
              locale={{
                emptyText: listState === 'loading'
                  ? '正在加载交付项目…'
                  : listState === 'live'
                    ? '暂无交付项目。'
                    : '交付服务暂不可用。',
              }}
            />
          </section>

          <section className={`${styles.panel} ${local.detailPanel}`}>
            {!current ? (
              <>
                <div className={styles.panelHeader}><h2>项目详情</h2><p>选择左侧项目查看交付项与证据</p></div>
                {detailState === 'loading' ? <div className={local.detailLoading} aria-label="正在读取项目详情" role="status"><Skeleton active title={false} paragraph={{ rows: 5 }} /></div> : detailState === 'error' ? <div className={local.detailLoading}><Alert type="error" showIcon title="项目详情读取失败" description="暂时无法读取交付项与验收证据，请重新加载。" /><Button className={local.retryAction} size="small" onClick={refresh}>重新加载</Button></div> : <p className={styles.emptyState}>尚未选择交付项目。请从项目名称进入。</p>}
              </>
            ) : (
              <>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>{current.name} <span className={styles.inlineCode}>{current.code}</span></h2>
                    <p>{current.scope || '（未填写交付范围）'} · 负责人 {current.owner || '—'} · 目标 {current.targetDate || '—'}</p>
                  </div>
                  <Tag color={TONE_COLOR[statusTone(current.status)]}>{STATUS_LABEL[current.status as keyof typeof STATUS_LABEL] ?? current.status}</Tag>
                </div>

                <div className={local.nextStep}><span>下一步</span><p>{NEXT_STEP[current.status] ?? '核查交付项与验收证据。'}</p></div>
                {blockers && blockers.length > 0 ? <Alert className={local.blockerNotice} type="error" showIcon title={`验收提交被阻断 · ${blockers.length} 项未通过`} description="请查看下方阻断原因，修复后重新提交。" /> : null}
                <div className={`${styles.listTools} ${local.detailActions}`}>
                  {current.status === 'DRAFT' ? (
                    <Button size="small" type="primary" disabled={action.pendingKey !== null}
                      onClick={() => runAction('start', '启动交付失败', async () => { await startDelivery(current.id); onNotice('交付项目已启动'); refresh() })}>
                      <CheckCircle2 size={13} />启动
                    </Button>
                  ) : null}
                  {(current.status === 'DRAFT' || current.status === 'IN_PROGRESS') ? (
                    <Button size="small" disabled={action.pendingKey !== null} onClick={() => setItemFormOpen(true)}>
                      <Plus size={13} />交付项
                    </Button>
                  ) : null}
                  {current.status === 'IN_PROGRESS' || current.status === 'READY_FOR_ACCEPTANCE' ? (
                    <Button size="small" disabled={action.pendingKey !== null}
                      onClick={() => runAction('snapshot', '证据快照生成失败', async () => { await snapshotDelivery(current.id); onNotice('证据快照已生成（不可变，checksum 留痕）'); refresh() })}>
                      <FileArchive size={13} />证据快照
                    </Button>
                  ) : null}
                  {current.status === 'IN_PROGRESS' ? (
                    <Button size="small" type="primary" disabled={action.pendingKey !== null}
                      onClick={() => runAction('submit', '提交验收失败', async () => { await handleSubmit(current.id) })}>
                      <CheckCircle2 size={13} />提交验收
                    </Button>
                  ) : null}
                  {current.status === 'READY_FOR_ACCEPTANCE' ? (
                    <Button size="small" type="primary" disabled={action.pendingKey !== null}
                      onClick={() => runAction('accept', '验收失败', async () => { await acceptDelivery(current.id); onNotice('验收通过：证据快照已钉住'); refresh() })}>
                      <CheckCircle2 size={13} />验收
                    </Button>
                  ) : null}
                  {current.status === 'ACCEPTED' ? (
                    <Button size="small" disabled={action.pendingKey !== null}
                      onClick={() => runAction('archive', '归档失败', async () => { await archiveDelivery(current.id); onNotice('交付项目已归档'); refresh() })}>
                      <Archive size={13} />归档
                    </Button>
                  ) : null}
                  <Button size="small" disabled={action.pendingKey !== null}
                    onClick={() => runAction('evidence', '证据包下载失败', async () => { await downloadEvidenceZip(current.id); onNotice('证据包已开始下载') })}>
                    <Download size={13} />证据包
                  </Button>
                </div>
                {action.error ? <Alert className={local.blockerNotice} type="error" showIcon title="交付操作未完成" description={action.error} /> : null}

                <Table<DeliveryDetailView['items'][number]>
                  rowKey="id"
                  columns={itemColumns}
                  scroll={{ x: 460 }}
                  dataSource={detail?.items ?? []}
                  pagination={false}
                  locale={{
                    emptyText: detailState === 'loading'
                      ? '正在加载交付项…'
                      : detailState === 'ready'
                        ? '暂无交付项。'
                        : '交付项暂不可用。',
                  }}
                />

                {blockers && blockers.length > 0 ? (
                  <div className={styles.panelHeader}>
                    <div><h2><Ban size={14} /> 阻断项（{blockers.length}）</h2><p>逐项检查未通过，修复后可重新提交</p></div>
                  </div>
                ) : null}
                {blockers && blockers.length > 0 ? (
                  <ul className={styles.timelineBody}>
                    {blockers.map((blocker, index) => (
                      <li key={`${blocker.refType}-${blocker.refId}-${index}`}>
                        <div className={styles.timelineTitle}>
                          <strong>{REF_TYPE_LABEL[blocker.refType as DeliveryRefType] ?? blocker.refType} · {blocker.refId}</strong>
                        </div>
                        <p>{blocker.reasons.join('；')}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className={styles.panelHeader}><h3>证据快照</h3><p>不可变 · checksum 留痕</p></div>
                <ul className={styles.timelineBody}>
                  {(detail?.snapshots ?? []).length === 0 ? <li className={styles.emptyState}>尚无证据快照。</li> : null}
                  {(detail?.snapshots ?? []).map((snapshot) => (
                    <li key={snapshot.id}>
                      <div className={styles.timelineTitle}>
                        <strong>{snapshot.createdAt.slice(0, 19).replace('T', ' ')}</strong>
                        {current.acceptedSnapshotId === snapshot.id ? <Tag color="success">验收钉住</Tag> : null}
                      </div>
                      <p className={styles.inlineCode}>{snapshot.checksum.slice(0, 16)}…</p>
                    </li>
                  ))}
                </ul>

                <div className={styles.panelHeader}><h3>事件留痕</h3></div>
                <ul className={styles.timelineBody}>
                  {(detail?.events ?? []).length === 0 ? <li className={styles.emptyState}>暂无事件。</li> : null}
                  {(detail?.events ?? []).slice(0, 12).map((event, index) => (
                    <li key={index}>
                      <div className={styles.timelineTitle}>
                        <strong>{event.eventType}</strong><span>{event.createdAt.slice(0, 19).replace('T', ' ')}</span>
                      </div>
                      <p>{event.detail}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>

      <Drawer
        open={createOpen}
        destroyOnHidden
        width={DRAWER_WIDTH}
        title={<DrawerTitle eyebrow="交付项目" title="新建交付项目" />}
        onClose={() => setCreateOpen(false)}
        footer={<>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button type="primary" htmlType="submit" form="delivery-create-form" loading={action.pendingKey === 'create'} icon={<Plus size={14} />}>
            {action.pendingKey === 'create' ? '创建中…' : '创建（草稿）'}
          </Button>
        </>}
      >
        <Form id="delivery-create-form" layout="vertical" onFinish={() => {
          void runAction('create', '交付项目创建失败', async () => {
            const created = await createDeliveryProject({
              code: createForm.code.trim(),
              name: createForm.name.trim(),
              scope: createForm.scope.trim(),
              owner: createForm.owner.trim(),
              targetDate: createForm.targetDate || undefined,
            })
            setCreateOpen(false)
            selectProject(created.project.id)
            onNotice('交付项目已创建（草稿）')
            refresh()
          })
        }}>
          <div className={styles.drawerFormGrid}>
            <Form.Item label="项目代码" required>
              <Input required value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} placeholder="如 DL-OUTPATIENT-01" />
            </Form.Item>
            <Form.Item label="项目名称" required>
              <Input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="如：门诊处方数据九月交付" />
            </Form.Item>
          </div>
          <div className={styles.drawerFormGrid}>
            <Form.Item label="负责人">
              <Input value={createForm.owner} onChange={(event) => setCreateForm({ ...createForm, owner: event.target.value })} placeholder="如：data-team" />
            </Form.Item>
            <Form.Item label="目标日期">
              <Input type="date" value={createForm.targetDate} onChange={(event) => setCreateForm({ ...createForm, targetDate: event.target.value })} />
            </Form.Item>
          </div>
          <Form.Item label="交付范围">
            <Input.TextArea rows={3} value={createForm.scope} onChange={(event) => setCreateForm({ ...createForm, scope: event.target.value })} placeholder="本次交付的内容与验收口径（证据包白名单会拒绝连接串/证件号形态文案）" />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        open={itemFormOpen && current !== null}
        destroyOnHidden
        width={DRAWER_WIDTH}
        title={<DrawerTitle eyebrow={current ? `${current.code} · 追加交付项` : ''} title="引用交付对象" />}
        onClose={() => setItemFormOpen(false)}
        footer={<>
          <Button onClick={() => setItemFormOpen(false)}>取消</Button>
          <Button type="primary" htmlType="submit" form="delivery-item-form" loading={action.pendingKey === 'add-item'} icon={<Plus size={14} />}>
            {action.pendingKey === 'add-item' ? '追加中…' : '追加交付项'}
          </Button>
        </>}
      >
        <Form id="delivery-item-form" layout="vertical" onFinish={() => {
          if (!current) return
          void runAction('add-item', '交付项追加失败', async () => {
            await addDeliveryItem(current.id, {
              refType: itemForm.refType,
              refId: itemForm.refId.trim(),
              note: itemForm.note.trim(),
            })
            setItemFormOpen(false)
            onNotice('交付项已追加')
            refresh()
          })
        }}>
          <Form.Item label="引用类型">
            <Select value={itemForm.refType} onChange={(value) => setItemForm({ ...itemForm, refType: value as DeliveryRefType })}
              options={DELIVERY_REF_TYPES.map((type) => ({ value: type, label: REF_TYPE_LABEL[type] }))} />
          </Form.Item>
          <Form.Item label="引用标识" required>
            <Input required value={itemForm.refId} onChange={(event) => setItemForm({ ...itemForm, refId: event.target.value })}
              placeholder={itemForm.refType === 'ASSET' ? '元数据四段 fqn，如 doris-dataos.default.ods_ep.ep_mz_cfzb' : itemForm.refType === 'DASHBOARD' ? '分析仪表盘 id（嵌入白名单内）' : '控制面对象 UUID'} />
          </Form.Item>
          <Form.Item label="备注">
            <Input value={itemForm.note} onChange={(event) => setItemForm({ ...itemForm, note: event.target.value })} placeholder="如：月度口径交付物" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}

/** 抽屉标题：眉标 + 主标题，对齐原自研 Drawer 的标题结构。 */
function DrawerTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div><span className={local.drawerEyebrow}>{eyebrow}</span><h2 className={local.drawerTitle}>{title}</h2></div>
}

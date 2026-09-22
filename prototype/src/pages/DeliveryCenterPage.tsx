import { Archive, Ban, CheckCircle2, Download, FileArchive, PackageCheck, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { Drawer } from '../components/ui/Drawer'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
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
import { usePaged } from '../hooks/usePaged'
import styles from './Pages.module.css'

/**
 * 交付中心（G25）：交付项目全生命周期闭环——项目、交付项（四类引用）、
 * 阻断项（提交逐项检查的 409 阻断面）、证据快照（幂等）、验收与证据包下载。
 * 演示构建保留显式样例；真实构建不回静态数据。
 */

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
  const detailState = useApiResource({
    timeoutMs: 15000,
    reloadKey: `${selectedId}|${reloadKey}`,
    load: (signal) => (selectedId ? fetchDeliveryDetail(signal, selectedId) : Promise.resolve(null)),
    onData: setDetail,
    onUnavailable: () => setDetail(null),
  })

  const paged = usePaged(projects, 8)
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
          <Button variant="quiet" onClick={() => { setQuery(searchInput); paged.setPage(0) }}>查询</Button>
          <Button variant="primary" onClick={() => { setCreateForm({ code: '', name: '', scope: '', owner: '', targetDate: '' }); setCreateOpen(true) }}>
            <Plus size={14} />新建交付项目
          </Button>
          <Button variant="quiet" onClick={refresh}><RefreshCw size={14} />刷新</Button>
        </div>

        <div className={styles.twoColumns}>
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}>
              <div><h2>交付项目</h2><p>生命周期：草稿 → 进行中 → 待验收 → 已验收 → 已归档</p></div>
              <PackageCheck size={16} aria-hidden="true" />
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead><tr><th>代码</th><th>名称</th><th>负责人</th><th>状态</th><th>目标日期</th><th>更新时间</th></tr></thead>
                <tbody>
                  {listState === 'loading' ? <tr className={styles.emptyRow}><td colSpan={6}>正在加载交付项目…</td></tr> : null}
                  {listState !== 'loading' && paged.paged.length === 0 ? <tr className={styles.emptyRow}><td colSpan={6}>暂无交付项目。</td></tr> : null}
                  {paged.paged.map((project) => (
                    <tr
                      key={project.id}
                      className={selectedId === project.id ? styles.selected : ''}
                      onClick={() => selectProject(project.id)}
                    >
                      <td className={styles.inlineCode}>{project.code}</td>
                      <td>{project.name}</td>
                      <td>{project.owner || '—'}</td>
                      <td><StatusTag tone={statusTone(project.status)}>{STATUS_LABEL[project.status as keyof typeof STATUS_LABEL] ?? project.status}</StatusTag></td>
                      <td><small>{project.targetDate || '—'}</small></td>
                      <td><small>{project.updatedAt.slice(0, 10)}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paged.pageCount > 1 ? (
              <div className={styles.pagerControls}>
                <Button variant="quiet" disabled={paged.page === 0} onClick={() => paged.setPage(paged.page - 1)}>上一页</Button>
                <span className={styles.pagerInfo}>{paged.page + 1} / {paged.pageCount}</span>
                <Button variant="quiet" disabled={paged.page >= paged.pageCount - 1} onClick={() => paged.setPage(paged.page + 1)}>下一页</Button>
              </div>
            ) : null}
          </section>

          <section className={styles.panel}>
            {!current ? (
              <>
                <div className={styles.panelHeader}><h2>项目详情</h2><p>选择左侧项目查看交付项与证据</p></div>
                <p className={styles.emptyState}>尚未选择交付项目。</p>
              </>
            ) : (
              <>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>{current.name} <span className={styles.inlineCode}>{current.code}</span></h2>
                    <p>{current.scope || '（未填写交付范围）'} · 负责人 {current.owner || '—'} · 目标 {current.targetDate || '—'}</p>
                  </div>
                  <StatusTag tone={statusTone(current.status)}>{STATUS_LABEL[current.status as keyof typeof STATUS_LABEL] ?? current.status}</StatusTag>
                </div>

                <div className={styles.listTools}>
                  {current.status === 'DRAFT' ? (
                    <Button variant="primary" disabled={action.pendingKey !== null}
                      onClick={() => runAction('start', '启动交付失败', async () => { await startDelivery(current.id); onNotice('交付项目已启动'); refresh() })}>
                      <CheckCircle2 size={14} />启动
                    </Button>
                  ) : null}
                  {(current.status === 'DRAFT' || current.status === 'IN_PROGRESS') ? (
                    <Button disabled={action.pendingKey !== null} onClick={() => setItemFormOpen(true)}>
                      <Plus size={14} />交付项
                    </Button>
                  ) : null}
                  {current.status === 'IN_PROGRESS' || current.status === 'READY_FOR_ACCEPTANCE' ? (
                    <Button variant="quiet" disabled={action.pendingKey !== null}
                      onClick={() => runAction('snapshot', '证据快照生成失败', async () => { await snapshotDelivery(current.id); onNotice('证据快照已生成（不可变，checksum 留痕）'); refresh() })}>
                      <FileArchive size={14} />证据快照
                    </Button>
                  ) : null}
                  {current.status === 'IN_PROGRESS' ? (
                    <Button variant="primary" disabled={action.pendingKey !== null}
                      onClick={() => runAction('submit', '提交验收失败', async () => { await handleSubmit(current.id) })}>
                      <CheckCircle2 size={14} />提交验收
                    </Button>
                  ) : null}
                  {current.status === 'READY_FOR_ACCEPTANCE' ? (
                    <Button variant="primary" disabled={action.pendingKey !== null}
                      onClick={() => runAction('accept', '验收失败', async () => { await acceptDelivery(current.id); onNotice('验收通过：证据快照已钉住'); refresh() })}>
                      <CheckCircle2 size={14} />验收
                    </Button>
                  ) : null}
                  {current.status === 'ACCEPTED' ? (
                    <Button disabled={action.pendingKey !== null}
                      onClick={() => runAction('archive', '归档失败', async () => { await archiveDelivery(current.id); onNotice('交付项目已归档'); refresh() })}>
                      <Archive size={14} />归档
                    </Button>
                  ) : null}
                  <Button variant="quiet" disabled={action.pendingKey !== null}
                    onClick={() => runAction('evidence', '证据包下载失败', async () => { await downloadEvidenceZip(current.id); onNotice('证据包已开始下载') })}>
                    <Download size={14} />证据包
                  </Button>
                </div>
                {action.error ? <p className={styles.emptyState} role="alert">{action.error}</p> : null}

                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead><tr><th>类型</th><th>引用</th><th>备注</th><th aria-label="操作" /></tr></thead>
                    <tbody>
                      {detailState === 'loading' ? <tr className={styles.emptyRow}><td colSpan={4}>正在加载交付项…</td></tr> : null}
                      {detailState !== 'loading' && (detail?.items ?? []).length === 0 ? <tr className={styles.emptyRow}><td colSpan={4}>暂无交付项。</td></tr> : null}
                      {(detail?.items ?? []).map((item) => (
                        <tr key={item.id}>
                          <td>{REF_TYPE_LABEL[item.refType as DeliveryRefType] ?? item.refType}</td>
                          <td className={styles.inlineCode}>{item.refId}</td>
                          <td><small>{item.note || '—'}</small></td>
                          <td>
                            {(current.status === 'DRAFT' || current.status === 'IN_PROGRESS') ? (
                              <Button variant="quiet" disabled={action.pendingKey !== null}
                                onClick={() => runAction(`remove-${item.id}`, '交付项移除失败', async () => { await removeDeliveryItem(current.id, item.id); onNotice('交付项已移除'); refresh() })}>
                                <Trash2 size={13} />移除
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

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
                        {current.acceptedSnapshotId === snapshot.id ? <StatusTag tone="healthy">验收钉住</StatusTag> : null}
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

      {createOpen ? (
        <Drawer
          titleId="delivery-create-title"
          eyebrow="交付项目"
          title="新建交付项目"
          closeLabel="关闭新建交付项目"
          onClose={() => setCreateOpen(false)}
          footer={<>
            <button className={styles.secondaryButton} type="button" onClick={() => setCreateOpen(false)}>取消</button>
            <button className={styles.primaryButton} type="submit" form="delivery-create-form" disabled={action.pendingKey === 'create'}>
              {action.pendingKey === 'create' ? '创建中…' : '创建（草稿）'}
            </button>
          </>}
        >
          <form id="delivery-create-form" className={styles.drawerForm} onSubmit={(event) => {
            event.preventDefault()
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
              <div className={styles.formField}><label htmlFor="delivery-code">项目代码</label><input id="delivery-code" required value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} placeholder="如 DL-OUTPATIENT-01" /></div>
              <div className={styles.formField}><label htmlFor="delivery-name">项目名称</label><input id="delivery-name" required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="如：门诊处方数据九月交付" /></div>
            </div>
            <div className={styles.drawerFormGrid}>
              <div className={styles.formField}><label htmlFor="delivery-owner">负责人</label><input id="delivery-owner" value={createForm.owner} onChange={(event) => setCreateForm({ ...createForm, owner: event.target.value })} placeholder="如：data-team" /></div>
              <div className={styles.formField}><label htmlFor="delivery-target">目标日期</label><input id="delivery-target" type="date" value={createForm.targetDate} onChange={(event) => setCreateForm({ ...createForm, targetDate: event.target.value })} /></div>
            </div>
            <div className={styles.formField}><label htmlFor="delivery-scope">交付范围</label><textarea id="delivery-scope" rows={3} value={createForm.scope} onChange={(event) => setCreateForm({ ...createForm, scope: event.target.value })} placeholder="本次交付的内容与验收口径（证据包白名单会拒绝连接串/证件号形态文案）" /></div>
          </form>
        </Drawer>
      ) : null}

      {itemFormOpen && current ? (
        <Drawer
          titleId="delivery-item-title"
          eyebrow={`${current.code} · 追加交付项`}
          title="引用交付对象"
          closeLabel="关闭追加交付项"
          onClose={() => setItemFormOpen(false)}
          footer={<>
            <button className={styles.secondaryButton} type="button" onClick={() => setItemFormOpen(false)}>取消</button>
            <button className={styles.primaryButton} type="submit" form="delivery-item-form" disabled={action.pendingKey === 'add-item'}>
              {action.pendingKey === 'add-item' ? '追加中…' : '追加交付项'}
            </button>
          </>}
        >
          <form id="delivery-item-form" className={styles.drawerForm} onSubmit={(event) => {
            event.preventDefault()
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
            <div className={styles.formField}><label htmlFor="delivery-item-type">引用类型</label>
              <select id="delivery-item-type" value={itemForm.refType} onChange={(event) => setItemForm({ ...itemForm, refType: event.target.value as DeliveryRefType })}>
                {DELIVERY_REF_TYPES.map((type) => <option key={type} value={type}>{REF_TYPE_LABEL[type]}</option>)}
              </select>
            </div>
            <div className={styles.formField}><label htmlFor="delivery-item-ref">引用标识</label><input id="delivery-item-ref" required value={itemForm.refId} onChange={(event) => setItemForm({ ...itemForm, refId: event.target.value })} placeholder={itemForm.refType === 'ASSET' ? 'OM 四段 fqn，如 doris-dataos.default.ods_ep.ep_mz_cfzb' : itemForm.refType === 'DASHBOARD' ? 'Superset 仪表盘 id（嵌入白名单内）' : '控制面对象 UUID'} /></div>
            <div className={styles.formField}><label htmlFor="delivery-item-note">备注</label><input id="delivery-item-note" value={itemForm.note} onChange={(event) => setItemForm({ ...itemForm, note: event.target.value })} placeholder="如：月度口径交付物" /></div>
          </form>
        </Drawer>
      ) : null}
    </div>
  )
}

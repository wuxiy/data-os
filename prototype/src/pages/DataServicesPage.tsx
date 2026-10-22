import { Surface } from '../components/ui/Surface'
import { Boxes, KeyRound, Plus, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Drawer, Form, Input, Select, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useAction } from '../hooks/useAction'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import {
  createDataService,
  dataServiceStatusLabel,
  deprecateDataService,
  fetchDataServiceCalls,
  fetchDataServiceContractEvents,
  fetchDataServiceDetail,
  fetchDataServiceExports,
  fetchDataServiceOverview,
  fetchDataServiceSubscriptions,
  fetchDataServices,
  issueDataServiceKey,
  parseContracts,
  publishDataService,
  revokeDataServiceKey,
  type DataService,
  type DataServiceCallItem,
  type DataServiceContractEventItem,
  type DataServiceDetail,
  type DataServiceExportItem,
  type DataServiceKeySummary,
  type DataServiceOverview,
  type DataServiceSubscriptionItem,
} from '../data/dataServicesApi'
import { formatDateTime } from '../data/domain'
import { frontendDemoMode } from '../data/runtimeMode'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import { Pager } from '../components/ui/Pager'
import type { RouteKey, Tone } from '../types'
import styles from './IntegrationPages.module.css'
// 抽屉表单体系（字段/网格/代码域）与数据接入页同源，保持一处维护。
import formStyles from './Pages.module.css'
import local from './DataServicesPage.module.css'
import workspace from './ConsumptionWorkspace.module.css'

/** 导出任务状态中文口径（P7）。 */
const exportStatusLabel: Record<string, string> = {
  PENDING: '排队中',
  RUNNING: '执行中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  EXPIRED: '已过期',
}

/** 合同事件类型中文口径（P8 余项）。 */
const contractChangeTypeLabel: Record<string, string> = {
  PUBLISHED: '发布',
  UPDATED: '变更',
  DEPRECATED: '下线',
  TEST: '验证',
}

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR: Record<Tone, string> = {
  healthy: 'success',
  warning: 'warning',
  danger: 'error',
  neutral: 'default',
}

/** 服务状态展示色调：草稿中性、已发布健康、已下线警示。 */
function serviceStatusTone(status: string): Tone {
  if (status === 'PUBLISHED') return 'healthy'
  if (status === 'DEPRECATED') return 'warning'
  return 'neutral'
}

/** diff 摘要：变化字段名列出即可，明细经调用面 API 查看。 */
function summarizeDiff(diff: string): string {
  if (!diff) return '—'
  try {
    const parsed = JSON.parse(diff) as Record<string, { from: unknown; to: unknown }>
    const fields = Object.keys(parsed)
    return fields.length === 0 ? '—' : fields.join('、')
  } catch {
    return '—'
  }
}

/**
 * 数据服务工作台（G13）：ToB 数据 API 的定义、发布、Key 与调用审计管理面。
 * 演示构建不收录静态样例（与 AI Data 口径一致），仅真实模式接控制面。
 * 治理子导航（数据合同）在演示/不可用/在线三分支一致呈现，不再跳出 tab 栏。
 */
export function DataServicesPage({ onNotice, onNavigate, onUnavailable }: { onNotice: (message: string) => void; onNavigate: (route: RouteKey) => void; onUnavailable: (label: string) => void }) {
  if (!frontendDemoMode) {
    return <DataServicesLive onNotice={onNotice} onNavigate={onNavigate} onUnavailable={onUnavailable} />
  }
  return (
    <div className={styles.integrationPage}>
      <PageHeader title="数据服务" eyebrow="数据服务 · 接口与 Key 治理" subtitle="ToB 数据 API 的定义、Key 与调用审计工作台" compact />
      <GovernanceTabs route="dataServices" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <section className={workspace.statePanel} role="status">
        <h2>数据服务仅在真实模式开放</h2>
        <p>本工作台管理实际服务的定义、发布、授权与审计。演示环境未提供数据服务样例，请切换到真实模式后使用。</p>
      </section>
    </div>
  )
}

function DataServicesLive({ onNotice, onNavigate, onUnavailable }: { onNotice: (message: string) => void; onNavigate: (route: RouteKey) => void; onUnavailable: (label: string) => void }) {
  const [services, setServices] = useState<DataService[]>([])
  const [overview, setOverview] = useState<DataServiceOverview | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    sqlTemplate: '',
    parameters: '[{"name":"start_date","type":"date","required":true,"description":"开始日期"}]',
    columns: '[{"name":"stat_date","type":"date","description":"统计日期"}]',
    maxRows: '1000',
    timeoutSeconds: '30',
    owner: 'data-team',
  })

  const listState = useApiResource({
    reloadKey: refreshTick,
    load: async (signal) => {
      const [items, overviewResponse] = await Promise.all([
        fetchDataServices(signal),
        fetchDataServiceOverview(signal).catch(() => null),
      ])
      return { items, overviewResponse }
    },
    onData: ({ items, overviewResponse }) => {
      setOverview(overviewResponse)
      setServices(items)
      setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : items[0]?.id ?? ''))
    },
    onUnavailable: () => setServices([]),
    timeoutMs: 15000,
  })

  // 目录分页（hook 在 listState 早退分支之前调用）：服务清单增长后侧栏不失控。
  const RAIL_PAGE_SIZE = 8
  const visibleServices = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return services.filter((service) => (!statusFilter || service.status === statusFilter)
      && `${service.name}${service.code}${service.owner}`.toLowerCase().includes(keyword))
  }, [services, query, statusFilter])
  const { page: railPage, setPage: setRailPage, paged: pagedServices, pageCount: railPageCount } = usePaged(visibleServices, RAIL_PAGE_SIZE)

  function refresh() {
    setRefreshTick((tick) => tick + 1)
  }

  // 动作互斥与错误归置统一（创建/发布/下线/发放/吊销）。
  const { pendingKey, run: runAction } = useAction((message) => onNotice(message))

  function submitCreate() {
    if (!form.code.trim() || !form.name.trim() || !form.sqlTemplate.trim() || !form.owner.trim()) {
      onNotice('请完整填写代码、名称、负责人与 SQL 模板')
      return
    }
    let parameters: unknown
    let columns: unknown
    try {
      parameters = JSON.parse(form.parameters)
      columns = JSON.parse(form.columns)
    } catch {
      onNotice('参数契约与列契约必须是合法 JSON 数组')
      return
    }
    void runAction('create-service', '创建失败', async () => {
      const created = await createDataService({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        sqlTemplate: form.sqlTemplate.trim(),
        parameters: parameters as never,
        columns: columns as never,
        maxRows: Number(form.maxRows) || 1000,
        timeoutSeconds: Number(form.timeoutSeconds) || 30,
        owner: form.owner.trim(),
      })
      onNotice(`已创建数据服务（草稿）：${created.code}`)
      setCreateOpen(false)
      setSelectedId(created.id)
      refresh()
    })
  }

  function publish(service: DataService) {
    void runAction(`publish-${service.id}`, '发布失败', async () => {
      const updated = await publishDataService(service.id)
      onNotice(`${updated.code} 已发布（执行面 30s 内生效）`)
      refresh()
    })
  }

  function deprecate(service: DataService) {
    void runAction(`deprecate-${service.id}`, '下线失败', async () => {
      const updated = await deprecateDataService(service.id)
      onNotice(`${updated.code} 已下线`)
      refresh()
    })
  }

  if (listState !== 'live') {
    return (
      <div className={styles.integrationPage}>
        <PageHeader title="数据服务" eyebrow="数据服务 · 接口与 Key 治理" subtitle="ToB 数据 API 的定义、Key 与调用审计工作台" compact />
        <GovernanceTabs route="dataServices" onNavigate={onNavigate} onUnavailable={onUnavailable} />
        <section className={workspace.statePanel} role="status" aria-busy={listState === 'loading'}>
          <h2>{listState === 'loading' ? '正在读取数据服务' : '数据服务目录暂不可用'}</h2>
          <p>{listState === 'loading' ? '正在读取服务定义、发布状态与调用概览。' : '暂时无法读取服务目录。请重新读取，持续失败时联系平台运维核对服务连接。'}</p>
          {listState === 'loading' ? <Skeleton active paragraph={{ rows: 4 }} /> : <Button onClick={refresh}>重新读取</Button>}
        </section>
      </div>
    )
  }

  const selected = services.find((item) => item.id === selectedId) ?? null
  const creatingService = pendingKey === 'create-service'

  return (
    <div className={styles.integrationPage}>
      <PageHeader title="数据服务" eyebrow="数据服务 · 接口与 Key 治理" subtitle="ToB 数据 API 的定义、Key 与调用审计工作台" compact />
      <GovernanceTabs route="dataServices" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      {overview ? (
        <div className={styles.lineageImpact} role="status" aria-label="数据服务概览">
          <div className={styles.impactItem}><span>数据服务</span><strong>{overview.total}</strong></div>
          <div className={styles.impactItem}><span>已发布 / 草稿</span><strong>{overview.published} / {overview.draft}</strong></div>
          <div className={styles.impactItem}><span>活跃 API Key</span><strong>{overview.activeKeys}</strong></div>
          <div className={styles.impactItem}><span>今日调用</span><strong>{overview.callsToday}</strong></div>
        </div>
      ) : null}
      <div className={`${styles.integrationWorkspace} ${styles.integrationWorkspaceDuo}`}>
        <Surface><aside className={styles.catalogRail} aria-label="数据服务目录">
          <div className={styles.railHeader}>
            <h2>数据服务</h2>
            <span className={styles.railCount}>{visibleServices.length} / {services.length} 项</span>
          </div>
          <div className={styles.railAction}>
            <Button type="primary" size="small" onClick={() => setCreateOpen(true)}><Plus size={13} aria-hidden="true" />新建服务</Button>
          </div>
          <div className={local.directoryFilters}>
            <Input.Search value={query} onChange={(event) => { setQuery(event.target.value); setRailPage(0) }} allowClear placeholder="搜索名称、代码或负责人" aria-label="搜索数据服务" />
            <Select value={statusFilter} aria-label="按服务状态筛选" onChange={(value) => { setStatusFilter(value); setRailPage(0) }} options={[{ value: '', label: '全部状态' }, { value: 'DRAFT', label: '草稿' }, { value: 'PUBLISHED', label: '已发布' }, { value: 'DEPRECATED', label: '已下线' }]} />
          </div>
          <div className={styles.schemaTabs}>
            <button className={styles.schemaTab} onClick={refresh}>
              <RefreshCw size={12} aria-hidden="true" /> 刷新
            </button>
          </div>
          <ul className={styles.catalogList}>
            {pagedServices.map((service) => (
              <li key={service.id}>
                <button
                  className={`${styles.catalogItem} ${service.id === selectedId ? styles.catalogItemSelected : ''}`}
                  onClick={() => setSelectedId(service.id)}
                  aria-pressed={service.id === selectedId}
                >
                  <strong><Boxes size={13} aria-hidden="true" /> {service.name}</strong>
                  <span>{service.code}</span>
                  <div className={styles.catalogMeta}>
                    <em>{service.versionSn}</em>
                    <i className={service.status === 'PUBLISHED' ? styles.healthMark : service.status === 'DEPRECATED' ? styles.warningMark : local.draftStatus}>{dataServiceStatusLabel[service.status]}</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {services.length === 0 ? <div className={styles.emptyRail}>暂无数据服务，点击<span className={formStyles.textNowrap}>「新建服务」</span>创建第一个。</div> : null}
          {services.length > 0 && visibleServices.length === 0 ? <div className={workspace.emptyDirectory}><p>没有符合当前条件的服务。</p><Button size="small" onClick={() => { setQuery(''); setStatusFilter(''); setRailPage(0) }}>清空筛选</Button></div> : null}
          <Pager label="服务目录分页" page={railPage} pageCount={railPageCount} pageSize={RAIL_PAGE_SIZE} onPageChange={setRailPage} />
        </aside></Surface>

        <section className={styles.workspaceMain} aria-label="数据服务详情">
          {selected ? (
            <DataServiceDetailPanel
              key={selected.id + selected.status}
              service={selected}
              onNotice={onNotice}
              onChanged={refresh}
              onPublish={() => publish(selected)}
              onDeprecate={() => deprecate(selected)}
            />
          ) : (
            <section className={workspace.statePanel}><h2>创建第一个数据服务</h2><p>先登记业务口径、参数和返回列契约。草稿发布后，才能向调用方发放访问 Key。</p><Button type="primary" onClick={() => setCreateOpen(true)}>新建数据服务</Button></section>
          )}
        </section>
      </div>

      <Drawer
        open={createOpen}
        destroyOnHidden
        width="min(540px, 44vw)"
        title={<><span className={local.drawerEyebrow}>数据服务登记</span><h2 className={local.drawerTitle}>新建数据服务</h2></>}
        onClose={() => setCreateOpen(false)}
        footer={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button type="primary" htmlType="submit" form="service-create-form" loading={creatingService} icon={<Plus size={14} />}>{creatingService ? '创建中…' : '创建（草稿）'}</Button></>}
      >
        <Form id="service-create-form" layout="vertical" onFinish={() => submitCreate()}>
          <div className={formStyles.drawerNotice}><Boxes size={16} /><span>创建后进入「草稿」：SQL 模板与契约先登记到控制面，点「发布」后才在执行面生效（30s 内）。密码、密钥不得写入 SQL 模板或契约。</span></div>
          <div className={formStyles.drawerFormGrid}>
            <Form.Item label="代码（slug）" required>
              <Input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="如：prescription-daily-summary" />
            </Form.Item>
            <Form.Item label="名称" required>
              <Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：处方日汇总查询" />
            </Form.Item>
          </div>
          <Form.Item label="描述">
            <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="面向调用方的业务口径说明" />
          </Form.Item>
          <Form.Item label="SQL 模板（参数化 SELECT，:name 占位）">
            <Input.TextArea rows={6} value={form.sqlTemplate} onChange={(event) => setForm({ ...form, sqlTemplate: event.target.value })} spellCheck={false} />
          </Form.Item>
          <div className={formStyles.drawerFormGrid}>
            <Form.Item label="参数契约（JSON）">
              <Input.TextArea className={formStyles.codeInput} rows={4} value={form.parameters} onChange={(event) => setForm({ ...form, parameters: event.target.value })} spellCheck={false} />
            </Form.Item>
            <Form.Item label="列契约（JSON）">
              <Input.TextArea className={formStyles.codeInput} rows={4} value={form.columns} onChange={(event) => setForm({ ...form, columns: event.target.value })} spellCheck={false} />
            </Form.Item>
          </div>
          <div className={formStyles.drawerFormGrid}>
            <Form.Item label="行数上限">
              <Input type="number" min={1} value={form.maxRows} onChange={(event) => setForm({ ...form, maxRows: event.target.value })} />
            </Form.Item>
            <Form.Item label="超时秒">
              <Input type="number" min={1} value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })} />
            </Form.Item>
          </div>
          <Form.Item label="负责人" required>
            <Input required value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="如：data-team" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}

function DataServiceDetailPanel({ service, onNotice, onChanged, onPublish, onDeprecate }: {
  service: DataService
  onNotice: (message: string) => void
  onChanged: () => void
  onPublish: () => void
  onDeprecate: () => void
}) {
  const [detail, setDetail] = useState<DataServiceDetail | null>(null)
  const { pendingKey, run: runAction } = useAction((message) => onNotice(message))
  const [calls, setCalls] = useState<DataServiceCallItem[]>([])
  const [exports, setExports] = useState<DataServiceExportItem[]>([])
  const [contractEvents, setContractEvents] = useState<DataServiceContractEventItem[]>([])
  const [subscriptions, setSubscriptions] = useState<DataServiceSubscriptionItem[]>([])
  const [recordsAvailable, setRecordsAvailable] = useState({ calls: true, exports: true, events: true, subscriptions: true })
  const [issuedKey, setIssuedKey] = useState('')
  const [keyForm, setKeyForm] = useState({ callerName: '', quota: '100', hospitals: '*' })
  const [refreshTick, setRefreshTick] = useState(0)
  // 下线是不可逆动作：两步确认，避免与「发布」同级误触。
  const [confirmDeprecate, setConfirmDeprecate] = useState(false)

  const detailState = useApiResource({
    reloadKey: refreshTick,
    load: async (signal) => {
      const [detailResponse, callItems, exportItems, eventItems, subscriptionItems] = await Promise.all([
        fetchDataServiceDetail(service.id, signal),
        fetchDataServiceCalls(service.id, signal).catch(() => null),
        fetchDataServiceExports(service.id, signal).catch(() => null),
        fetchDataServiceContractEvents(service.id, signal).catch(() => null),
        fetchDataServiceSubscriptions(service.id, signal).catch(() => null),
      ])
      return { detailResponse, callItems, exportItems, eventItems, subscriptionItems }
    },
    onData: ({ detailResponse, callItems, exportItems, eventItems, subscriptionItems }) => {
      setDetail(detailResponse)
      setCalls(callItems ?? [])
      setExports(exportItems ?? [])
      setContractEvents(eventItems ?? [])
      setSubscriptions(subscriptionItems ?? [])
      setRecordsAvailable({ calls: callItems !== null, exports: exportItems !== null, events: eventItems !== null, subscriptions: subscriptionItems !== null })
    },
    onUnavailable: () => {
      setDetail(null)
      setCalls([])
      setExports([])
      setContractEvents([])
      setSubscriptions([])
      setRecordsAvailable({ calls: false, exports: false, events: false, subscriptions: false })
    },
    timeoutMs: 15000,
  })

  const parameters = parseContracts<{ name: string; type: string; required?: boolean; description?: string }>(service.parametersJson)
  const columns = parseContracts<{ name: string; type: string; description?: string }>(service.columnsJson)
  // 详情各表分页：面板按服务键控重建，切换服务自动回到第一页。
  const TABLE_PAGE_SIZE = 6
  const { page: callsPage, setPage: setCallsPage, paged: pagedCalls, pageCount: callsPageCount } = usePaged(calls, TABLE_PAGE_SIZE)
  const { page: exportsPage, setPage: setExportsPage, paged: pagedExports, pageCount: exportsPageCount } = usePaged(exports, TABLE_PAGE_SIZE)
  const { page: eventsPage, setPage: setEventsPage, paged: pagedEvents, pageCount: eventsPageCount } = usePaged(contractEvents, TABLE_PAGE_SIZE)
  const { page: subsPage, setPage: setSubsPage, paged: pagedSubscriptions, pageCount: subsPageCount } = usePaged(subscriptions, TABLE_PAGE_SIZE)

  async function issueKey() {
    if (!keyForm.callerName.trim()) {
      onNotice('请填写调用方名称')
      return
    }
    void runAction('issue-key', '发放失败', async () => {
      const issued = await issueDataServiceKey(
        service.id,
        keyForm.callerName.trim(),
        keyForm.hospitals.trim() === '*' ? ['*'] : keyForm.hospitals.split(/[,\s]+/).filter(Boolean),
        Number(keyForm.quota) || 100,
      )
      setIssuedKey(issued.apiKey)
      onNotice('API Key 已发放：明文仅本次展示，请立即交付调用方')
      setKeyForm({ callerName: '', quota: '100', hospitals: '*' })
      setRefreshTick((tick) => tick + 1)
      onChanged()
    })
  }

  function revoke(keyId: string) {
    void runAction(`revoke-${keyId}`, '吊销失败', async () => {
      await revokeDataServiceKey(service.id, keyId)
      onNotice('Key 已吊销（执行面 30s 缓存窗口后生效）')
      setRefreshTick((tick) => tick + 1)
      onChanged()
    })
  }

  // 参数契约列定义：本表不分页，空态文案保持原口径。
  const parameterColumns: ColumnsType<{ name: string; type: string; required?: boolean; description?: string }> = [
    { title: '参数', key: 'name', render: (_, parameter) => <code>{parameter.name}</code> },
    { title: '类型', key: 'type', render: (_, parameter) => parameter.type },
    { title: '必填', key: 'required', render: (_, parameter) => (parameter.required ? '是' : '否') },
    { title: '说明', key: 'description', render: (_, parameter) => parameter.description ?? '—' },
  ]

  // 返回列契约列定义：本表不分页，空态文案保持原口径。
  const columnColumns: ColumnsType<{ name: string; type: string; description?: string }> = [
    { title: '列', key: 'name', render: (_, column) => <code>{column.name}</code> },
    { title: '类型', key: 'type', render: (_, column) => column.type },
    { title: '说明', key: 'description', render: (_, column) => column.description ?? '—' },
  ]

  // Key 台账列定义：数字列右对齐；行内动作用 size="small"。
  const keyColumns: ColumnsType<DataServiceKeySummary> = [
    { title: '调用方', key: 'callerName', render: (_, key) => key.callerName },
    { title: 'Key 前缀', key: 'keyPrefix', render: (_, key) => <code>{key.keyPrefix}…</code> },
    { title: '日配额', key: 'dailyQuota', align: 'right', className: local.numCell, render: (_, key) => key.dailyQuota },
    { title: '医院授权', key: 'allowedHospitals', render: (_, key) => <code>{key.allowedHospitals}</code> },
    { title: '状态', key: 'status', render: (_, key) => (key.status === 'ACTIVE' ? '有效' : '已吊销') },
    { title: '最近使用', key: 'lastUsedAt', render: (_, key) => formatDateTime(key.lastUsedAt) },
    {
      title: '操作',
      key: 'actions',
      render: (_, key) => key.status === 'ACTIVE'
        ? <Button size="small" disabled={pendingKey === `revoke-${key.id}`} onClick={() => revoke(key.id)}>吊销</Button>
        : null,
    },
  ]

  // 最近调用列定义：数字列右对齐 + tabular-nums；分页走 Table 内建。
  const callColumns: ColumnsType<DataServiceCallItem> = [
    { title: '时间', key: 'calledAt', render: (_, call) => formatDateTime(call.calledAt) },
    { title: '行数', key: 'rowCount', align: 'right', className: local.numCell, render: (_, call) => call.rowCount },
    { title: '截断', key: 'truncated', render: (_, call) => (call.truncated ? '是' : '否') },
    { title: '耗时', key: 'elapsedMs', align: 'right', className: local.numCell, render: (_, call) => `${call.elapsedMs}ms` },
    { title: '状态码', key: 'statusCode', align: 'right', className: local.numCell, render: (_, call) => call.statusCode },
  ]

  // 导出任务列定义：数字列右对齐 + tabular-nums；分页走 Table 内建。
  const exportColumns: ColumnsType<DataServiceExportItem> = [
    { title: '创建时间', key: 'createdAt', render: (_, item) => formatDateTime(item.createdAt) },
    { title: '状态', key: 'status', render: (_, item) => exportStatusLabel[item.status] ?? item.status },
    { title: '行数', key: 'rowCount', align: 'right', className: local.numCell, render: (_, item) => item.rowCount },
    { title: '产物大小', key: 'fileBytes', align: 'right', className: local.numCell, render: (_, item) => (item.fileBytes > 0 ? `${(item.fileBytes / 1024).toFixed(1)} KB` : '—') },
    { title: '到期', key: 'expiresAt', render: (_, item) => formatDateTime(item.expiresAt) },
    { title: '失败原因', key: 'error', render: (_, item) => item.error || '—' },
  ]

  // 合同事件列定义：分页走 Table 内建。
  const eventColumns: ColumnsType<DataServiceContractEventItem> = [
    { title: '时间', key: 'occurredAt', render: (_, event) => formatDateTime(event.occurredAt) },
    { title: '类型', key: 'changeType', render: (_, event) => contractChangeTypeLabel[event.changeType] ?? event.changeType },
    { title: '版本', key: 'version', render: (_, event) => (event.fromVersion === event.toVersion ? event.toVersion : `${event.fromVersion} → ${event.toVersion}`) },
    { title: '变更内容', key: 'diff', render: (_, event) => <code>{summarizeDiff(event.diff)}</code> },
  ]

  // 订阅列定义：分页走 Table 内建。
  const subscriptionColumns: ColumnsType<DataServiceSubscriptionItem> = [
    { title: '订阅方', key: 'callerName', render: (_, subscription) => subscription.callerName },
    { title: 'Webhook', key: 'webhookUrl', render: (_, subscription) => <code>{subscription.webhookUrl}</code> },
    { title: '状态', key: 'status', render: (_, subscription) => (subscription.status === 'ACTIVE' ? '生效中' : '已退订') },
    { title: '创建', key: 'createdAt', render: (_, subscription) => formatDateTime(subscription.createdAt) },
  ]

  return (
    <div>
      <div className={styles.assetToolbar}>
        <div className={styles.assetIdentity}>
          <div className={styles.assetIdentityTop}>
            <span className={styles.assetCode}>{service.code}</span>
            <Tag color={TONE_COLOR[serviceStatusTone(service.status)]}>{dataServiceStatusLabel[service.status]}</Tag>
          </div>
          <h2>{service.name}</h2>
          <p>{service.description || '—'} · 版本 {service.versionSn} · 负责人 {service.owner}</p>
        </div>
        <div className={styles.toolbarActions}>
          {service.status === 'DRAFT' ? <Button type="primary" size="small" onClick={onPublish}>发布</Button> : null}
          {service.status === 'PUBLISHED' ? (
            confirmDeprecate ? (
              <>
                <Button danger size="small" onClick={() => { setConfirmDeprecate(false); onDeprecate() }}>确认下线</Button>
                <Button size="small" onClick={() => setConfirmDeprecate(false)}>取消</Button>
              </>
            ) : <Button size="small" onClick={() => setConfirmDeprecate(true)}>下线</Button>
          ) : null}
        </div>
      </div>

      <div className={styles.assetBody}>
        {detailState === 'loading' && !detail ? <section className={workspace.inlineState} role="status" aria-busy="true"><p>正在读取服务授权与运行记录…</p><Skeleton active paragraph={{ rows: 2 }} /></section> : null}
        {detailState === 'unavailable' ? <section className={workspace.inlineState} role="status"><strong>授权与运行记录暂不可读</strong><p>服务定义仍可查看，当前无法确认 Key 和调用统计。</p><Button size="small" onClick={() => setRefreshTick((tick) => tick + 1)}>重新读取详情</Button></section> : null}
        {/* 事实卡只保留 assetIdentity 未覆盖的执行面字段（代码/版本/状态/负责人见标题区） */}
        <div className={styles.serviceFacts}>
          <div><span>行数上限</span><code>{service.maxRows}</code></div>
          <div><span>超时</span><code>{service.timeoutSeconds}s</code></div>
        </div>

        <h4 className={styles.railLabel}>参数契约</h4>
        <Table<{ name: string; type: string; required?: boolean; description?: string }>
          scroll={{ x: 'max-content' }}
          rowKey={(parameter) => parameter.name}
          columns={parameterColumns}
          dataSource={parameters}
          pagination={false}
          locale={{ emptyText: '无参数' }}
        />

        <h4 className={styles.railLabel}>返回列契约</h4>
        <Table<{ name: string; type: string; description?: string }>
          scroll={{ x: 'max-content' }}
          rowKey={(column) => column.name}
          columns={columnColumns}
          dataSource={columns}
          pagination={false}
          locale={{ emptyText: '未声明' }}
        />

        {service.status === 'PUBLISHED' ? (
          <>
            <h4 className={styles.railLabel}>调用示例（ToB 执行面）</h4>
            <div className={`${styles.sqlPanel} ${styles.sqlPanelVisible}`}>
              <div className={styles.sqlInner}>
                <pre>{`curl -X POST ${location.origin}/dataapi/v1/services/${service.code}/query \\
  -H "X-API-Key: <调用方 Key>" \\
  -H "Content-Type: application/json" \\
  -d '{"parameters": {${parameters.slice(0, 2).map((p) => `"${p.name}": "<${p.type}>"`).join(', ')}}}'`}</pre>
              </div>
            </div>
          </>
        ) : null}

        <h4 className={styles.railLabel}>API Key{detail ? `（${detail.keys.length}）` : ''}</h4>
        {service.status === 'PUBLISHED' ? (
          <Form className={styles.createForm} onFinish={() => void issueKey()}>
            <Form.Item noStyle><Input value={keyForm.callerName} onChange={(event) => setKeyForm({ ...keyForm, callerName: event.target.value })} placeholder="调用方名称" /></Form.Item>
            <Form.Item noStyle><Input value={keyForm.quota} onChange={(event) => setKeyForm({ ...keyForm, quota: event.target.value })} placeholder="日配额" inputMode="numeric" /></Form.Item>
            <Form.Item noStyle><Input value={keyForm.hospitals} onChange={(event) => setKeyForm({ ...keyForm, hospitals: event.target.value })} placeholder="医院授权（* 或逗号分隔）" /></Form.Item>
            <Button type="primary" htmlType="submit" size="small" disabled={pendingKey === 'issue-key'}><KeyRound size={13} aria-hidden="true" />发放 Key</Button>
          </Form>
        ) : (
          <p className={styles.railLabel}>仅已发布状态可发放 API Key。</p>
        )}
        {issuedKey ? (
          <div className={styles.technicalNotice} role="alert">
            <Tag color="success">一次性明文</Tag>
            <code>{issuedKey}</code>
          </div>
        ) : null}
        <Table
          scroll={{ x: 'max-content' }}
          rowKey={(key) => key.id}
          columns={keyColumns}
          dataSource={detail?.keys ?? []}
          pagination={false}
          loading={detailState === 'loading' && !detail}
          locale={{ emptyText: detailState === 'unavailable' ? 'Key 清单暂不可读。' : '尚未发放 Key' }}
        />

        <h4 className={styles.railLabel}>最近调用{detail ? `（累计 ${detail.totalCalls} 次）` : ''}</h4>
        <Table<DataServiceCallItem>
          scroll={{ x: 'max-content' }}
          rowKey={(call) => call.id}
          columns={callColumns}
          dataSource={pagedCalls}
          pagination={{
            current: callsPage + 1,
            pageSize: TABLE_PAGE_SIZE,
            total: calls.length,
            showSizeChanger: false,
            onChange: (page) => setCallsPage(page - 1),
          }}
          loading={detailState === 'loading' && !detail}
          locale={{ emptyText: recordsAvailable.calls ? '暂无调用' : '调用记录暂不可读。' }}
        />

        <h4 className={styles.railLabel}>异步导出任务</h4>
        <Table<DataServiceExportItem>
          scroll={{ x: 'max-content' }}
          rowKey={(item) => item.id}
          columns={exportColumns}
          dataSource={pagedExports}
          pagination={{
            current: exportsPage + 1,
            pageSize: TABLE_PAGE_SIZE,
            total: exports.length,
            showSizeChanger: false,
            onChange: (page) => setExportsPage(page - 1),
          }}
          loading={detailState === 'loading' && !detail}
          locale={{ emptyText: recordsAvailable.exports ? '暂无导出任务' : '导出记录暂不可读。' }}
        />

        <h4 className={styles.railLabel}>合同事件与订阅（变更通知）</h4>
        <Table<DataServiceContractEventItem>
          scroll={{ x: 'max-content' }}
          rowKey={(event) => event.eventId}
          columns={eventColumns}
          dataSource={pagedEvents}
          pagination={{
            current: eventsPage + 1,
            pageSize: TABLE_PAGE_SIZE,
            total: contractEvents.length,
            showSizeChanger: false,
            onChange: (page) => setEventsPage(page - 1),
          }}
          loading={detailState === 'loading' && !detail}
          locale={{ emptyText: recordsAvailable.events ? '暂无合同事件' : '合同事件暂不可读。' }}
        />
        <Table<DataServiceSubscriptionItem>
          scroll={{ x: 'max-content' }}
          rowKey={(subscription) => subscription.id}
          columns={subscriptionColumns}
          dataSource={pagedSubscriptions}
          pagination={{
            current: subsPage + 1,
            pageSize: TABLE_PAGE_SIZE,
            total: subscriptions.length,
            showSizeChanger: false,
            onChange: (page) => setSubsPage(page - 1),
          }}
          loading={detailState === 'loading' && !detail}
          locale={{ emptyText: recordsAvailable.subscriptions ? '暂无调用方订阅（调用方经自助 API 订阅）' : '订阅记录暂不可读。' }}
        />
      </div>
    </div>
  )
}

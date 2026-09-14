import { Boxes, KeyRound, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useAction } from '../hooks/useAction'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { Drawer } from '../components/ui/Drawer'
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
  type DataServiceOverview,
  type DataServiceSubscriptionItem,
} from '../data/dataServicesApi'
import { frontendDemoMode } from '../data/runtimeMode'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import { Pager } from '../components/ui/Pager'
import styles from './IntegrationPages.module.css'
// 抽屉表单体系（字段/网格/代码域）与数据接入页同源，保持一处维护。
import formStyles from './Pages.module.css'

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

/** 服务状态展示色调：草稿中性、已发布健康、已下线警示。 */
function serviceStatusTone(status: string): 'neutral' | 'healthy' | 'warning' {
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
 */
export function DataServicesPage({ onNotice }: { onNotice: (message: string) => void }) {
  if (!frontendDemoMode) {
    return <DataServicesLive onNotice={onNotice} />
  }
  return (
    <div className={styles.integrationPage}>
      <PageHeader title="数据服务" eyebrow="Data Services" subtitle="ToB 数据 API 的定义、Key 与调用审计工作台" compact />
      <section className={styles.technicalNotice} role="status">
        <StatusTag tone="neutral">演示边界</StatusTag>
        <span>数据服务工作台仅接入真实控制面 API（G13 起交付）；演示构建未收录静态样例。请以真实模式访问。</span>
      </section>
    </div>
  )
}

function DataServicesLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [services, setServices] = useState<DataService[]>([])
  const [overview, setOverview] = useState<DataServiceOverview | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
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
  const { page: railPage, setPage: setRailPage, paged: pagedServices, pageCount: railPageCount } = usePaged(services, RAIL_PAGE_SIZE)

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
        <PageHeader title="数据服务" eyebrow="Data Services" subtitle="ToB 数据 API 的定义、Key 与调用审计工作台" compact />
        <section className={styles.technicalNotice} role="status">
          <StatusTag tone="warning">{listState === 'loading' ? '读取中' : '待接入'}</StatusTag>
          <span>{listState === 'loading' ? '正在从控制面读取数据服务…' : '控制面暂不可用：数据服务域需要控制面已配置并可访问。'}</span>
        </section>
      </div>
    )
  }

  const selected = services.find((item) => item.id === selectedId) ?? null
  const creatingService = pendingKey === 'create-service'

  return (
    <div className={styles.integrationPage}>
      <PageHeader title="数据服务" eyebrow="Data Services" subtitle="ToB 数据 API 的定义、Key 与调用审计工作台" compact />
      {overview ? (
        <div className={styles.lineageImpact} role="status" aria-label="数据服务概览">
          <div className={styles.impactItem}><span>数据服务</span><strong>{overview.total}</strong></div>
          <div className={styles.impactItem}><span>已发布 / 草稿</span><strong>{overview.published} / {overview.draft}</strong></div>
          <div className={styles.impactItem}><span>活跃 API Key</span><strong>{overview.activeKeys}</strong></div>
          <div className={styles.impactItem}><span>今日调用</span><strong>{overview.callsToday}</strong></div>
        </div>
      ) : null}
      <div className={`${styles.integrationWorkspace} ${styles.integrationWorkspaceDuo}`}>
        <aside className={styles.catalogRail} aria-label="数据服务目录">
          <div className={styles.railHeader}>
            <h2>数据服务</h2>
            <span className={styles.railCount}>{services.length} 项</span>
          </div>
          <div className={styles.railAction}>
            <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={13} aria-hidden="true" />新建服务</Button>
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
                    <i className={styles.healthMark}>{dataServiceStatusLabel[service.status]}</i>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {services.length === 0 ? <div className={styles.emptyRail}>暂无数据服务，点击「新建服务」创建第一个。</div> : null}
          <Pager label="服务目录分页" page={railPage} pageCount={railPageCount} pageSize={RAIL_PAGE_SIZE} onPageChange={setRailPage} />
        </aside>

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
            <div className={styles.emptyRail}>左侧选择或创建一个数据服务。</div>
          )}
        </section>
      </div>

      {createOpen ? <Drawer
        titleId="service-create-title"
        eyebrow="数据服务登记"
        title="新建数据服务"
        closeLabel="关闭新建数据服务"
        onClose={() => setCreateOpen(false)}
        footer={<><button className={formStyles.secondaryButton} type="button" onClick={() => setCreateOpen(false)}>取消</button><button className={formStyles.primaryButton} type="submit" form="service-create-form" disabled={creatingService}><Plus size={14} />{creatingService ? '创建中…' : '创建（草稿）'}</button></>}
      >
        <form id="service-create-form" className={formStyles.drawerForm} onSubmit={(event) => { event.preventDefault(); void submitCreate() }}>
          <div className={formStyles.drawerNotice}><Boxes size={16} /><span>创建后进入「草稿」：SQL 模板与契约先登记到控制面，点「发布」后才在执行面生效（30s 内）。密码、密钥不得写入 SQL 模板或契约。</span></div>
          <div className={formStyles.drawerFormGrid}>
            <div className={formStyles.formField}><label htmlFor="service-code">代码（slug）</label><input id="service-code" required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="如：prescription-daily-summary" /></div>
            <div className={formStyles.formField}><label htmlFor="service-name">名称</label><input id="service-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：处方日汇总查询" /></div>
          </div>
          <div className={formStyles.formField}><label htmlFor="service-desc">描述</label><input id="service-desc" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="面向调用方的业务口径说明" /></div>
          <div className={formStyles.formField}><label htmlFor="service-sql">SQL 模板（参数化 SELECT，:name 占位）</label><textarea id="service-sql" className={formStyles.codeInput} rows={6} value={form.sqlTemplate} onChange={(event) => setForm({ ...form, sqlTemplate: event.target.value })} spellCheck={false} /></div>
          <div className={formStyles.drawerFormGrid}>
            <div className={formStyles.formField}><label htmlFor="service-params">参数契约（JSON）</label><textarea id="service-params" className={formStyles.codeInput} rows={4} value={form.parameters} onChange={(event) => setForm({ ...form, parameters: event.target.value })} spellCheck={false} /></div>
            <div className={formStyles.formField}><label htmlFor="service-columns">列契约（JSON）</label><textarea id="service-columns" className={formStyles.codeInput} rows={4} value={form.columns} onChange={(event) => setForm({ ...form, columns: event.target.value })} spellCheck={false} /></div>
          </div>
          <div className={formStyles.drawerFormGrid}>
            <div className={formStyles.formField}><label htmlFor="service-max-rows">行数上限</label><input id="service-max-rows" type="number" min={1} value={form.maxRows} onChange={(event) => setForm({ ...form, maxRows: event.target.value })} /></div>
            <div className={formStyles.formField}><label htmlFor="service-timeout">超时秒</label><input id="service-timeout" type="number" min={1} value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })} /></div>
          </div>
          <div className={formStyles.formField}><label htmlFor="service-owner">负责人</label><input id="service-owner" required value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="如：data-team" /></div>
        </form>
      </Drawer> : null}
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
  const [issuedKey, setIssuedKey] = useState('')
  const [keyForm, setKeyForm] = useState({ callerName: '', quota: '100', hospitals: '*' })
  const [refreshTick, setRefreshTick] = useState(0)

  useApiResource({
    reloadKey: refreshTick,
    load: async (signal) => {
      const [detailResponse, callItems, exportItems, eventItems, subscriptionItems] = await Promise.all([
        fetchDataServiceDetail(service.id, signal),
        fetchDataServiceCalls(service.id, signal).catch(() => []),
        fetchDataServiceExports(service.id, signal).catch(() => []),
        fetchDataServiceContractEvents(service.id, signal).catch(() => []),
        fetchDataServiceSubscriptions(service.id, signal).catch(() => []),
      ])
      return { detailResponse, callItems, exportItems, eventItems, subscriptionItems }
    },
    onData: ({ detailResponse, callItems, exportItems, eventItems, subscriptionItems }) => {
      setDetail(detailResponse)
      setCalls(callItems)
      setExports(exportItems)
      setContractEvents(eventItems)
      setSubscriptions(subscriptionItems)
    },
    onUnavailable: () => setDetail(null),
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

  return (
    <div>
      <div className={styles.assetToolbar}>
        <div className={styles.assetIdentity}>
          <div className={styles.assetIdentityTop}>
            <span className={styles.assetCode}>{service.code}</span>
            <StatusTag tone={serviceStatusTone(service.status)}>{dataServiceStatusLabel[service.status]}</StatusTag>
          </div>
          <h2>{service.name}</h2>
          <p>{service.description || '—'} · 版本 {service.versionSn} · 负责人 {service.owner}</p>
        </div>
        <div className={styles.toolbarActions}>
          {service.status === 'DRAFT' ? <Button variant="primary" onClick={onPublish}>发布</Button> : null}
          {service.status === 'PUBLISHED' ? <Button onClick={onDeprecate}>下线</Button> : null}
        </div>
      </div>

      <div className={styles.assetBody}>
        <div className={styles.serviceFacts}>
          <div><span>代码</span><code>{service.code}</code></div>
          <div><span>版本</span><code>{service.versionSn}</code></div>
          <div><span>状态</span><code>{dataServiceStatusLabel[service.status]}</code></div>
          <div><span>负责人</span><code>{service.owner}</code></div>
          <div><span>行数上限</span><code>{service.maxRows}</code></div>
          <div><span>超时</span><code>{service.timeoutSeconds}s</code></div>
        </div>

        <h4 className={styles.railLabel}>参数契约</h4>
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr></thead>
            <tbody>
              {parameters.map((parameter) => (
                <tr key={parameter.name}>
                  <td><code>{parameter.name}</code></td>
                  <td>{parameter.type}</td>
                  <td>{parameter.required ? '是' : '否'}</td>
                  <td>{parameter.description ?? '—'}</td>
                </tr>
              ))}
              {parameters.length === 0 ? <tr><td colSpan={4}>无参数</td></tr> : null}
            </tbody>
          </table>
        </div>

        <h4 className={styles.railLabel}>返回列契约</h4>
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>列</th><th>类型</th><th>说明</th></tr></thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name}>
                  <td><code>{column.name}</code></td>
                  <td>{column.type}</td>
                  <td>{column.description ?? '—'}</td>
                </tr>
              ))}
              {columns.length === 0 ? <tr><td colSpan={3}>未声明</td></tr> : null}
            </tbody>
          </table>
        </div>

        {service.status === 'PUBLISHED' ? (
          <>
            <h4 className={styles.railLabel}>调用示例（ToB 执行面）</h4>
            <pre className={styles.sqlInner}>{`curl -X POST ${location.origin}/dataapi/v1/services/${service.code}/query \\
  -H "X-API-Key: <调用方 Key>" \\
  -H "Content-Type: application/json" \\
  -d '{"parameters": {${parameters.slice(0, 2).map((p) => `"${p.name}": "<${p.type}>"`).join(', ')}}}'`}</pre>
          </>
        ) : null}

        <h4 className={styles.railLabel}>API Key（{detail?.keys.length ?? 0}）</h4>
        {service.status === 'PUBLISHED' ? (
          <form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); void issueKey() }}>
            <input value={keyForm.callerName} onChange={(event) => setKeyForm({ ...keyForm, callerName: event.target.value })} placeholder="调用方名称" />
            <input value={keyForm.quota} onChange={(event) => setKeyForm({ ...keyForm, quota: event.target.value })} placeholder="日配额" inputMode="numeric" />
            <input value={keyForm.hospitals} onChange={(event) => setKeyForm({ ...keyForm, hospitals: event.target.value })} placeholder="医院授权（* 或逗号分隔）" />
            <Button type="submit" variant="primary" disabled={pendingKey === 'issue-key'}><KeyRound size={13} aria-hidden="true" />发放 Key</Button>
          </form>
        ) : (
          <p className={styles.railLabel}>仅已发布状态可发放 API Key。</p>
        )}
        {issuedKey ? (
          <div className={styles.technicalNotice} role="alert">
            <StatusTag tone="healthy">一次性明文</StatusTag>
            <code>{issuedKey}</code>
          </div>
        ) : null}
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>调用方</th><th>Key 前缀</th><th>日配额</th><th>医院授权</th><th>状态</th><th>最近使用</th><th></th></tr></thead>
            <tbody>
              {(detail?.keys ?? []).map((key) => (
                <tr key={key.id}>
                  <td>{key.callerName}</td>
                  <td><code>{key.keyPrefix}…</code></td>
                  <td>{key.dailyQuota}</td>
                  <td><code>{key.allowedHospitals}</code></td>
                  <td>{key.status === 'ACTIVE' ? '有效' : '已吊销'}</td>
                  <td>{key.lastUsedAt || '—'}</td>
                  <td>{key.status === 'ACTIVE' ? <button className={styles.schemaTab} disabled={pendingKey === `revoke-${key.id}`} onClick={() => revoke(key.id)}>吊销</button> : null}</td>
                </tr>
              ))}
              {(detail?.keys ?? []).length === 0 ? <tr><td colSpan={7}>尚未发放 Key</td></tr> : null}
            </tbody>
          </table>
        </div>

        <h4 className={styles.railLabel}>最近调用（累计 {detail?.totalCalls ?? 0} 次）</h4>
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>时间</th><th>行数</th><th>截断</th><th>耗时</th><th>状态码</th></tr></thead>
            <tbody>
              {pagedCalls.map((call) => (
                <tr key={call.id}>
                  <td>{new Date(call.calledAt).toLocaleString('zh-CN')}</td>
                  <td>{call.rowCount}</td>
                  <td>{call.truncated ? '是' : '否'}</td>
                  <td>{call.elapsedMs}ms</td>
                  <td>{call.statusCode}</td>
                </tr>
              ))}
              {calls.length === 0 ? <tr><td colSpan={5}>暂无调用</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pager label="最近调用分页" page={callsPage} pageCount={callsPageCount} pageSize={TABLE_PAGE_SIZE} onPageChange={setCallsPage} />

        <h4 className={styles.railLabel}>导出任务（P7 异步导出）</h4>
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>创建时间</th><th>状态</th><th>行数</th><th>产物大小</th><th>到期</th><th>失败原因</th></tr></thead>
            <tbody>
              {pagedExports.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td>
                  <td>{exportStatusLabel[item.status] ?? item.status}</td>
                  <td>{item.rowCount}</td>
                  <td>{item.fileBytes > 0 ? `${(item.fileBytes / 1024).toFixed(1)} KB` : '—'}</td>
                  <td>{item.expiresAt || '—'}</td>
                  <td>{item.error || '—'}</td>
                </tr>
              ))}
              {exports.length === 0 ? <tr><td colSpan={6}>暂无导出任务</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pager label="导出任务分页" page={exportsPage} pageCount={exportsPageCount} pageSize={TABLE_PAGE_SIZE} onPageChange={setExportsPage} />

        <h4 className={styles.railLabel}>合同事件与订阅（变更通知）</h4>
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>时间</th><th>类型</th><th>版本</th><th>变更内容</th></tr></thead>
            <tbody>
              {pagedEvents.map((event) => (
                <tr key={event.eventId}>
                  <td>{new Date(event.occurredAt).toLocaleString('zh-CN')}</td>
                  <td>{contractChangeTypeLabel[event.changeType] ?? event.changeType}</td>
                  <td>{event.fromVersion === event.toVersion ? event.toVersion : `${event.fromVersion} → ${event.toVersion}`}</td>
                  <td><code>{summarizeDiff(event.diff)}</code></td>
                </tr>
              ))}
              {contractEvents.length === 0 ? <tr><td colSpan={4}>暂无合同事件</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pager label="合同事件分页" page={eventsPage} pageCount={eventsPageCount} pageSize={TABLE_PAGE_SIZE} onPageChange={setEventsPage} />
        <div className={styles.horizontalScroll}>
          <table className={styles.fieldTable}>
            <thead><tr><th>订阅方</th><th>Webhook</th><th>状态</th><th>创建</th></tr></thead>
            <tbody>
              {pagedSubscriptions.map((subscription) => (
                <tr key={subscription.id}>
                  <td>{subscription.callerName}</td>
                  <td><code>{subscription.webhookUrl}</code></td>
                  <td>{subscription.status === 'ACTIVE' ? '生效中' : '已退订'}</td>
                  <td>{new Date(subscription.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
              {subscriptions.length === 0 ? <tr><td colSpan={4}>暂无调用方订阅（调用方经自助 API 订阅）</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pager label="订阅分页" page={subsPage} pageCount={subsPageCount} pageSize={TABLE_PAGE_SIZE} onPageChange={setSubsPage} />
      </div>
    </div>
  )
}

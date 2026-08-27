import { Boxes, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  createDataService,
  dataServiceStatusLabel,
  deprecateDataService,
  fetchDataServiceCalls,
  fetchDataServiceDetail,
  fetchDataServiceOverview,
  fetchDataServices,
  issueDataServiceKey,
  parseContracts,
  publishDataService,
  revokeDataServiceKey,
  type DataService,
  type DataServiceCallItem,
  type DataServiceDetail,
  type DataServiceOverview,
} from '../data/dataServicesApi'
import { frontendDemoMode } from '../data/runtimeMode'
import { useApiResource } from '../hooks/useApiResource'
import styles from './IntegrationPages.module.css'

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
  const [creating, setCreating] = useState(false)
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

  function refresh() {
    setRefreshTick((tick) => tick + 1)
  }

  async function submitCreate() {
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
    try {
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
      setCreating(false)
      setSelectedId(created.id)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '创建失败')
    }
  }

  async function publish(service: DataService) {
    try {
      const updated = await publishDataService(service.id)
      onNotice(`${updated.code} 已发布（执行面 30s 内生效）`)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '发布失败')
    }
  }

  async function deprecate(service: DataService) {
    try {
      const updated = await deprecateDataService(service.id)
      onNotice(`${updated.code} 已下线`)
      refresh()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '下线失败')
    }
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
      <div className={styles.integrationWorkspace}>
        <aside className={styles.catalogRail} aria-label="数据服务目录">
          <div className={styles.railHeader}>
            <h2>数据服务</h2>
            <span className={styles.railCount}>{services.length} 项</span>
          </div>
          <div className={styles.schemaTabs}>
            <button className={styles.schemaTab} onClick={() => setCreating((value) => !value)}>
              {creating ? '收起创建' : '新建服务'}
            </button>
            <button className={styles.schemaTab} onClick={refresh}>
              <RefreshCw size={12} aria-hidden="true" /> 刷新
            </button>
          </div>
          {creating ? (
            <form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); void submitCreate() }}>
              <label>
                代码（slug）
                <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="如：prescription-daily-summary" />
              </label>
              <label>
                名称
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label>
                描述
                <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </label>
              <label>
                SQL 模板（参数化 SELECT，:name 占位）
                <textarea rows={4} value={form.sqlTemplate} onChange={(event) => setForm({ ...form, sqlTemplate: event.target.value })} />
              </label>
              <label>
                参数契约（JSON）
                <textarea rows={3} value={form.parameters} onChange={(event) => setForm({ ...form, parameters: event.target.value })} />
              </label>
              <label>
                列契约（JSON）
                <textarea rows={3} value={form.columns} onChange={(event) => setForm({ ...form, columns: event.target.value })} />
              </label>
              <label>
                行数上限 / 超时秒
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={form.maxRows} onChange={(event) => setForm({ ...form, maxRows: event.target.value })} />
                  <input value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })} />
                </div>
              </label>
              <label>
                负责人
                <input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} />
              </label>
              <Button type="submit">创建（草稿）</Button>
            </form>
          ) : null}
          <ul className={styles.catalogList}>
            {services.map((service) => (
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
  const [calls, setCalls] = useState<DataServiceCallItem[]>([])
  const [issuedKey, setIssuedKey] = useState('')
  const [keyForm, setKeyForm] = useState({ callerName: '', quota: '100', hospitals: '*' })
  const [refreshTick, setRefreshTick] = useState(0)

  useApiResource({
    reloadKey: refreshTick,
    load: async (signal) => {
      const [detailResponse, callItems] = await Promise.all([
        fetchDataServiceDetail(service.id, signal),
        fetchDataServiceCalls(service.id, signal).catch(() => []),
      ])
      return { detailResponse, callItems }
    },
    onData: ({ detailResponse, callItems }) => {
      setDetail(detailResponse)
      setCalls(callItems)
    },
    onUnavailable: () => setDetail(null),
    timeoutMs: 15000,
  })

  const parameters = parseContracts<{ name: string; type: string; required?: boolean; description?: string }>(service.parametersJson)
  const columns = parseContracts<{ name: string; type: string; description?: string }>(service.columnsJson)

  async function issueKey() {
    if (!keyForm.callerName.trim()) {
      onNotice('请填写调用方名称')
      return
    }
    try {
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
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '发放失败')
    }
  }

  async function revoke(keyId: string) {
    try {
      await revokeDataServiceKey(service.id, keyId)
      onNotice('Key 已吊销（执行面 30s 缓存窗口后生效）')
      setRefreshTick((tick) => tick + 1)
      onChanged()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '吊销失败')
    }
  }

  return (
    <div>
      <div className={styles.assetIdentityTop}>
        <div>
          <h3>{service.name}</h3>
          <p>{service.description}</p>
        </div>
        <div className={styles.schemaTabs}>
          {service.status === 'DRAFT' ? <button className={styles.schemaTab} onClick={onPublish}>发布</button> : null}
          {service.status === 'PUBLISHED' ? <button className={styles.schemaTab} onClick={onDeprecate}>下线</button> : null}
        </div>
      </div>

      <div className={styles.technicalGrid}>
        <div><span>代码</span><code>{service.code}</code></div>
        <div><span>版本</span><code>{service.versionSn}</code></div>
        <div><span>状态</span><code>{dataServiceStatusLabel[service.status]}</code></div>
        <div><span>负责人</span><code>{service.owner}</code></div>
        <div><span>行数上限</span><code>{service.maxRows}</code></div>
        <div><span>超时</span><code>{service.timeoutSeconds}s</code></div>
      </div>

      <h4 className={styles.railLabel}>参数契约</h4>
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

      <h4 className={styles.railLabel}>返回列契约</h4>
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
          <input value={keyForm.quota} onChange={(event) => setKeyForm({ ...keyForm, quota: event.target.value })} placeholder="日配额" />
          <input value={keyForm.hospitals} onChange={(event) => setKeyForm({ ...keyForm, hospitals: event.target.value })} placeholder="医院授权（* 或逗号分隔）" />
          <Button type="submit">发放 Key</Button>
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
              <td>{key.status === 'ACTIVE' ? <button className={styles.schemaTab} onClick={() => revoke(key.id)}>吊销</button> : null}</td>
            </tr>
          ))}
          {(detail?.keys ?? []).length === 0 ? <tr><td colSpan={7}>尚未发放 Key</td></tr> : null}
        </tbody>
      </table>

      <h4 className={styles.railLabel}>最近调用（累计 {detail?.totalCalls ?? 0} 次）</h4>
      <table className={styles.fieldTable}>
        <thead><tr><th>时间</th><th>行数</th><th>截断</th><th>耗时</th><th>状态码</th></tr></thead>
        <tbody>
          {calls.map((call) => (
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
  )
}

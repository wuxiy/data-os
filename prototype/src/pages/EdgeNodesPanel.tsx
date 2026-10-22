import { Boxes, History, MoreHorizontal, Network, Pencil, Plus, Radar, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  deleteEdgeNode,
  fetchEdgeDeployments,
  fetchEdgeNodes,
  fetchEdgeWatermarks,
  probeEdgeNode,
  recordEdgeDeployment,
  saveEdgeNode,
  type EdgeDeploymentApiItem,
  type EdgeNodeApiItem,
  type EdgeWatermarkTable,
} from '../data/controlPlane'
import type { Tone } from '../types'
import { formatDateTime } from '../data/domain'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import { useKeyedResource } from '../hooks/useKeyedResource'
import { rowMoreToggle } from './rowMoreToggle'
import styles from './Pages.module.css'
import local from './EdgeNodesPanel.module.css'

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR: Record<Tone, string> = {
  healthy: 'success',
  warning: 'warning',
  danger: 'error',
  neutral: 'default',
}
const DRAWER_WIDTH = 'min(540px, 44vw)'

/**
 * 前置机节点面板（G2G 批次 4）：台账登记 + 中心侧 TCP 可达性探测。
 * 状态由最近一次探测衍生（在线/离线/未探测）——MiNiFi 路线无 agent 心跳
 * 通道，如实以中心探活为准；参数只存非敏感白名单键。
 */
export function EdgeNodesPanel() {
  const [nodes, setNodes] = useState<EdgeNodeApiItem[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EdgeNodeApiItem | null>(null)
  const [form, setForm] = useState({ name: '', groupName: '', site: '', host: '', port: '8443', version: '', relayPrefix: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [watermarks, setWatermarks] = useState<EdgeWatermarkTable[]>([])
  const [deployNode, setDeployNode] = useState<EdgeNodeApiItem | null>(null)
  const [deployments, setDeployments] = useState<EdgeDeploymentApiItem[]>([])
  const [deployForm, setDeployForm] = useState({ version: '', artifactRef: '', note: '' })
  const [deployError, setDeployError] = useState<string | null>(null)
  const { pendingKey, error, run } = useAction()
  const probing = pendingKey?.startsWith('probe-')
  const saving = pendingKey === 'save-node'

  const apiState = useApiResource({
    reloadKey,
    load: (signal) => fetchEdgeNodes(signal),
    onData: (response) => setNodes(response.items),
    onUnavailable: () => setNodes([]),
  })

  const deploymentState = useKeyedResource({
    key: deployNode?.id,
    load: (signal) => fetchEdgeDeployments(deployNode!.id, signal),
    onData: setDeployments,
    onReset: () => setDeployments([]),
  })

  // 采集水位为从属资源：台账 live 后加载，失败静默（水位缺失不塌节点面）
  useApiResource({
    load: (signal) => fetchEdgeWatermarks(signal),
    onData: (response) => setWatermarks(response.tables),
    onUnavailable: () => setWatermarks([]),
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
      name: node.name,
      groupName: node.groupName === '默认分组' ? '' : node.groupName,
      site: node.site,
      host: node.host,
      port: String(node.port),
      version: node.version,
      relayPrefix: typeof node.config.relayPrefix === 'string' ? node.config.relayPrefix : '',
    })
    setFormError(null)
    setFormOpen(true)
  }

  function submit() {
    if (!form.name.trim() || !form.host.trim()) {
      setFormError('请填写节点名称与主机地址')
      return
    }
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setFormError('端口必须在 1-65535')
      return
    }
    void run('save-node', '前置机节点保存失败，请稍后重试', async () => {
      const config: Record<string, unknown> = {}
      if (form.relayPrefix.trim()) config.relayPrefix = form.relayPrefix.trim()
      const saved = await saveEdgeNode({
        name: form.name.trim(),
        groupName: form.groupName.trim() || undefined,
        site: form.site.trim() || undefined,
        host: form.host.trim(),
        port,
        version: form.version.trim() || undefined,
        config,
      }, editing?.id)
      setNodes((current) => {
        const next = current.filter((item) => item.id !== saved.id)
        return [saved, ...next]
      })
      setFormOpen(false)
    }, (message) => setFormError(message))
  }

  function probe(node: EdgeNodeApiItem) {
    void run(`probe-${node.id}`, '前置机探测失败，请稍后重试', async () => {
      const probed = await probeEdgeNode(node.id)
      setNodes((current) => current.map((item) => item.id === probed.id ? probed : item))
    })
  }

  function openDeployments(node: EdgeNodeApiItem) {
    setDeployNode(node)
    setDeployForm({ version: '', artifactRef: '', note: '' })
    setDeployError(null)
    setDeployments([])
  }

  function submitDeployment() {
    if (!deployNode || !deployForm.version.trim()) {
      setDeployError('请填写发布版本号')
      return
    }
    void run('record-deployment', '发布登记失败，请稍后重试', async () => {
      const next = await recordEdgeDeployment(deployNode.id, {
        version: deployForm.version.trim(),
        artifactRef: deployForm.artifactRef.trim() || undefined,
        note: deployForm.note.trim() || undefined,
      })
      setDeployments(next)
      setDeployForm({ version: '', artifactRef: '', note: '' })
    }, (message) => setDeployError(message))
  }

  function remove(node: EdgeNodeApiItem) {
    void run(`delete-${node.id}`, '前置机节点删除失败，请稍后重试', async () => {
      await deleteEdgeNode(node.id)
      setNodes((current) => current.filter((item) => item.id !== node.id))
    })
  }

  const onlineCount = nodes.filter((node) => node.state === 'ONLINE').length

  const nodeColumns: ColumnsType<EdgeNodeApiItem> = [
    {
      title: '节点',
      key: 'name',
      render: (_, node) => (
        <div>
          <strong>{node.name}</strong>
          {node.config.relayPrefix ? <small className={styles.statusDetail}>中转前缀 {String(node.config.relayPrefix)}</small> : null}
        </div>
      ),
    },
    {
      title: '分组 / 站点',
      key: 'group',
      render: (_, node) => `${node.groupName}${node.site ? ` · ${node.site}` : ''}`,
    },
    {
      title: '地址',
      key: 'address',
      render: (_, node) => <code className={styles.inlineCode}>{node.host}:{node.port}</code>,
    },
    {
      title: '版本',
      key: 'version',
      render: (_, node) => node.version || '—',
    },
    {
      title: '最近探测',
      key: 'probe',
      render: (_, node) => (
        <div>
          <Tag color={node.state === 'ONLINE' ? 'success' : node.state === 'OFFLINE' ? 'error' : 'default'}>
            {node.state === 'ONLINE' ? '在线' : node.state === 'OFFLINE' ? '离线' : '未探测'}
          </Tag>
          {node.lastProbeAt ? <small className={styles.statusDetail}>{node.lastProbeMessage} · {formatDateTime(node.lastProbeAt)}</small> : null}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, node) => (
        <div className={styles.tableActions}>
          <Button size="small" disabled={pendingKey !== null} onClick={() => probe(node)}>
            <Radar size={13} className={pendingKey === `probe-${node.id}` ? styles.spin : undefined} />{pendingKey === `probe-${node.id}` ? '探测中…' : '探测'}
          </Button>
          <Button size="small" onClick={() => void openDeployments(node)}><History size={13} />发布</Button>
          <details className={styles.rowMore} onToggle={rowMoreToggle}>
            <summary><MoreHorizontal size={13} aria-hidden="true" />更多</summary>
            <div className={styles.rowMoreMenu}>
              <Button size="small" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); openEdit(node) }}><Pencil size={13} />编辑</Button>
              <Button size="small" disabled={pendingKey !== null} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); remove(node) }}><Trash2 size={13} />删除</Button>
            </div>
          </details>
        </div>
      ),
    },
  ]

  return (
    <section className={styles.tablePanel}>
      <div className={styles.panelHeader}>
        <div><h2>前置机节点</h2><p>按节点检查中心网络可达性，再核查采集水位与发布记录</p></div>
        <div className={styles.panelHeaderActions}>
          <span className={styles.dashboardScope}>{apiState === 'live' ? `${onlineCount}/${nodes.length} 在线` : apiState === 'loading' ? '台账读取中' : '台账暂不可用'}</span><Button size="small" onClick={() => setReloadKey((key) => key + 1)}>刷新台账</Button>
          {apiState === 'live' ? <Button type="primary" size="small" onClick={openCreate} icon={<Plus size={14} />}>登记节点</Button> : null}
        </div>
      </div>
      {error ? <Alert className={local.actionError} type="error" showIcon title="节点操作未完成" description={error} /> : null}
      {watermarks.length > 0 ? (
        <div className={styles.watermarkGrid} aria-label="边缘表采集水位">
          {watermarks.map((table) => {
            const max = Math.max(1, ...table.dailyCounts.map((item) => item.count))
            // 近 7 天全零/无数据时直说，避免一排 6% 地板高度的假柱状图
            const hasRecent = table.dailyCounts.some((item) => item.count > 0)
            return (
              <div key={table.key} className={styles.watermarkCard}>
                <div className={styles.watermarkHead}>
                  <Boxes size={14} />
                  <strong>{table.dataset}</strong>
                </div>
                <p>累计 {table.totalRows.toLocaleString()} 行 · 最近写入 {formatDateTime(table.latestWriteAt)}</p>
                {hasRecent ? (
                  <div className={styles.watermarkBars}>
                    {table.dailyCounts.map((item) => (
                      <span key={item.date} title={`${item.date}：${item.count} 行`}>
                        <i style={{ height: `${Math.max(6, (item.count / max) * 100)}%` }} />
                      </span>
                    ))}
                  </div>
                ) : null}
                <small>{hasRecent ? '近 7 天按日入仓行数' : '近 7 天无入仓记录'}</small>
              </div>
            )
          })}
        </div>
      ) : null}
      <Table<EdgeNodeApiItem>
        rowKey="id"
        columns={nodeColumns}
        dataSource={nodes}
        loading={apiState === 'loading'}
        scroll={{ x: 850 }}
        pagination={false}
        locale={{
          emptyText: apiState === 'loading'
            ? '正在读取前置机台账…'
            : apiState === 'live'
            ? '暂未登记前置机节点；登记后可从中心发起可达性探测。'
            : '前置机台账控制面暂不可用。',
        }}
      />

      <Drawer
        open={deployNode !== null}
        destroyOnHidden
        width={DRAWER_WIDTH}
        title={<div><span className={styles.drawerEyebrow}>{deployNode ? `发布记录 · ${deployNode.name}` : ''}</span><h2 className={styles.drawerTitleText}>版本登记与历史</h2></div>}
        onClose={() => setDeployNode(null)}
      >
        {deployNode ? <>
          <div className={styles.drawerNotice}><History size={16} /><span>登记面只记录版本与说明（部署经 deploy/minifi 脚本执行）；这里不承载制品本体，发布人取当前登录身份。</span></div>
          <Form layout="vertical" onFinish={submitDeployment}>
            <div className={styles.drawerFormGrid}>
              <Form.Item label="版本号" required>
                <Input id="deploy-version" required value={deployForm.version} onChange={(event) => setDeployForm((current) => ({ ...current, version: event.target.value }))} placeholder="例如：minifi-1.22-flow-v3" />
              </Form.Item>
              <Form.Item label="产物标识（可选）">
                <Input id="deploy-artifact" value={deployForm.artifactRef} onChange={(event) => setDeployForm((current) => ({ ...current, artifactRef: event.target.value }))} placeholder="例如：deploy/minifi@2026-10" />
              </Form.Item>
            </div>
            <Form.Item label="发布说明">
              <Input id="deploy-note" value={deployForm.note} onChange={(event) => setDeployForm((current) => ({ ...current, note: event.target.value }))} placeholder="例如：更换 EP 采集流并调大批次" />
            </Form.Item>
            {deployError ? <p className={styles.formError} role="alert">{deployError}</p> : null}
            <Button type="primary" htmlType="submit" loading={pendingKey === 'record-deployment'} icon={<Plus size={14} />}>{pendingKey === 'record-deployment' ? '登记中…' : '登记发布'}</Button>
          </Form>
          {deploymentState === 'loading' ? <div className={local.deploymentLoading} aria-label="正在读取发布记录" role="status"><Skeleton active title={false} paragraph={{ rows: 3 }} /></div> : null}
          {deploymentState === 'error' ? <Alert className={local.actionError} type="error" showIcon title="发布记录读取失败" description="关闭后重新打开发布记录以重试。" /> : null}
          <ol className={styles.runTimeline}>
            {deployments.map((deployment) => (
              <li key={deployment.id}>
                <div className={styles.timelineDot} />
                <div className={styles.timelineBody}>
                  <div className={styles.timelineTitle}><strong>{deployment.version}</strong><time>{formatDateTime(deployment.deployedAt)}</time></div>
                  {deployment.note ? <p>{deployment.note}</p> : null}
                  <dl><div><dt>发布人</dt><dd>{deployment.deployedBy}</dd></div>{deployment.artifactRef ? <div><dt>产物</dt><dd>{deployment.artifactRef}</dd></div> : null}</dl>
                </div>
              </li>
            ))}
            {deploymentState === 'ready' && deployments.length === 0 ? <li><div className={styles.timelineBody}><p>暂无发布记录。</p></div></li> : null}
          </ol>
        </> : null}
      </Drawer>

      <Drawer
        open={formOpen}
        destroyOnHidden
        width={DRAWER_WIDTH}
        title={<div><span className={styles.drawerEyebrow}>{editing ? '前置机编辑' : '前置机登记'}</span><h2 className={styles.drawerTitleText}>{editing ? editing.name : '登记前置机节点'}</h2></div>}
        onClose={() => setFormOpen(false)}
        footer={<><Button onClick={() => setFormOpen(false)}>取消</Button><Button type="primary" htmlType="submit" form="edge-node-form" loading={saving} icon={<Save size={14} />}>{saving ? '保存中…' : '保存节点'}</Button></>}
      >
        <Form id="edge-node-form" layout="vertical" onFinish={submit}>
          <div className={styles.drawerNotice}><Network size={16} /><span>登记医院边缘侧采集节点。状态由控制面从中心发起 TCP 探活判定；参数只保存中转前缀等非敏感描述，凭据一律走凭据服务。</span></div>
          <div className={styles.drawerFormGrid}>
            <Form.Item label="节点名称" required>
              <Input id="edge-name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：市一院本部前置机" />
            </Form.Item>
            <Form.Item label="分组">
              <Input id="edge-group" value={form.groupName} onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))} placeholder="默认分组" />
            </Form.Item>
            <Form.Item label="主机地址" required>
              <Input id="edge-host" required value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} placeholder="例如：10.0.8.12" />
            </Form.Item>
            <Form.Item label="探测端口" required>
              <Input id="edge-port" required type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))} placeholder="8443" />
            </Form.Item>
            <Form.Item label="站点">
              <Input id="edge-site" value={form.site} onChange={(event) => setForm((current) => ({ ...current, site: event.target.value }))} placeholder="例如：本部 / 东院区" />
            </Form.Item>
            <Form.Item label="版本">
              <Input id="edge-version" value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} placeholder="例如：minifi-1.x" />
            </Form.Item>
          </div>
          <Form.Item label="中转桶前缀（非敏感描述，可选）">
            <Input id="edge-relay" value={form.relayPrefix} onChange={(event) => setForm((current) => ({ ...current, relayPrefix: event.target.value }))} placeholder="例如：/ep-edge-hq/" />
          </Form.Item>
          {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
        </Form>
      </Drawer>
    </section>
  )
}

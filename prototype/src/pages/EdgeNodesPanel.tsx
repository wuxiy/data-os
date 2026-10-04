import { Boxes, History, MoreHorizontal, Network, Pencil, Plus, Radar, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Drawer } from '../components/ui/Drawer'
import { StatusTag } from '../components/ui/Primitives'
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
import { formatDateTime } from '../data/domain'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import pageStyles from './PlatformOperationsPage.module.css'
import { rowMoreToggle } from './rowMoreToggle'
import styles from './Pages.module.css'

/**
 * 前置机节点面板（G2G 批次 4）：台账登记 + 中心侧 TCP 可达性探测。
 * 状态由最近一次探测衍生（在线/离线/未探测）——MiNiFi 路线无 agent 心跳
 * 通道，如实以中心探活为准；参数只存非敏感白名单键。
 */
export function EdgeNodesPanel() {
  const [nodes, setNodes] = useState<EdgeNodeApiItem[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EdgeNodeApiItem | null>(null)
  const [form, setForm] = useState({ name: '', groupName: '', site: '', host: '', port: '8443', version: '', relayPrefix: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [watermarks, setWatermarks] = useState<EdgeWatermarkTable[]>([])
  const [deployNode, setDeployNode] = useState<EdgeNodeApiItem | null>(null)
  const [deployments, setDeployments] = useState<EdgeDeploymentApiItem[]>([])
  const [deployForm, setDeployForm] = useState({ version: '', artifactRef: '', note: '' })
  const [deployError, setDeployError] = useState<string | null>(null)
  const { pendingKey, run } = useAction()
  const probing = pendingKey?.startsWith('probe-')
  const saving = pendingKey === 'save-node'

  const apiState = useApiResource({
    load: (signal) => fetchEdgeNodes(signal),
    onData: (response) => setNodes(response.items),
    onUnavailable: () => setNodes([]),
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

  function submit(event: FormEvent) {
    event.preventDefault()
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

  async function openDeployments(node: EdgeNodeApiItem) {
    setDeployNode(node)
    setDeployForm({ version: '', artifactRef: '', note: '' })
    setDeployError(null)
    setDeployments([])
    try {
      setDeployments(await fetchEdgeDeployments(node.id))
    } catch {
      setDeployError('发布记录读取失败，请稍后重试')
    }
  }

  function submitDeployment(event: FormEvent) {
    event.preventDefault()
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

  return (
    <section className={styles.tablePanel}>
      <div className={styles.panelHeader}>
        <div><h2>前置机节点</h2><p>医院边缘侧 MiNiFi 节点台账；状态由中心 TCP 探活衍生（{onlineCount}/{nodes.length} 在线）</p></div>
        <div className={styles.panelHeaderActions}>
          {apiState === 'live' ? <button className={styles.primaryButton} onClick={openCreate}><Plus size={14} />登记节点</button> : null}
        </div>
      </div>
      {watermarks.length > 0 ? (
        <div className={styles.watermarkGrid} aria-label="边缘表采集水位">
          {watermarks.map((table) => {
            const max = Math.max(1, ...table.dailyCounts.map((item) => item.count))
            return (
              <div key={table.key} className={styles.watermarkCard}>
                <div className={styles.watermarkHead}>
                  <Boxes size={14} />
                  <strong>{table.dataset}</strong>
                </div>
                <p>累计 {table.totalRows.toLocaleString()} 行 · 最近写入 {table.latestWriteAt ?? '—'}</p>
                <div className={styles.watermarkBars}>
                  {table.dailyCounts.map((item) => (
                    <span key={item.date} title={`${item.date}：${item.count} 行`}>
                      <i style={{ height: `${Math.max(6, (item.count / max) * 100)}%` }} />
                    </span>
                  ))}
                </div>
                <small>近 7 天按日入仓行数</small>
              </div>
            )
          })}
        </div>
      ) : null}
      <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th>节点</th><th>分组 / 站点</th><th>地址</th><th>版本</th><th>最近探测</th><th>操作</th></tr></thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id}>
              <td><strong>{node.name}</strong>{node.config.relayPrefix ? <small className={styles.statusDetail}>中转前缀 {String(node.config.relayPrefix)}</small> : null}</td>
              <td>{node.groupName}{node.site ? ` · ${node.site}` : ''}</td>
              <td><code className={styles.inlineCode}>{node.host}:{node.port}</code></td>
              <td>{node.version || '—'}</td>
              <td>
                <StatusTag tone={node.state === 'ONLINE' ? 'healthy' : node.state === 'OFFLINE' ? 'danger' : 'neutral'}>
                  {node.state === 'ONLINE' ? '在线' : node.state === 'OFFLINE' ? '离线' : '未探测'}
                </StatusTag>
                {node.lastProbeAt ? <small className={styles.statusDetail}>{node.lastProbeMessage} · {formatDateTime(node.lastProbeAt)}</small> : null}
              </td>
              <td><div className={styles.tableActions}>
                <button className={styles.tableButton} disabled={pendingKey !== null} onClick={() => probe(node)}><Radar size={13} className={pendingKey === `probe-${node.id}` ? styles.spin : undefined} />{pendingKey === `probe-${node.id}` ? '探测中…' : '探测'}</button>
                <button className={styles.tableButton} onClick={() => void openDeployments(node)}><History size={13} />发布</button>
                <details className={styles.rowMore} onToggle={rowMoreToggle}>
                  <summary aria-label="更多操作"><MoreHorizontal size={13} aria-hidden="true" /></summary>
                  <div className={styles.rowMoreMenu}>
                    <button className={styles.tableButton} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); openEdit(node) }}><Pencil size={13} />编辑</button>
                    <button className={styles.tableButton} disabled={pendingKey !== null} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); remove(node) }}><Trash2 size={13} />删除</button>
                  </div>
                </details>
              </div></td>
            </tr>
          ))}
          {apiState === 'live' && nodes.length === 0 ? <tr><td colSpan={6} className={styles.emptyState}>暂未登记前置机节点；登记后可从中心发起可达性探测。</td></tr> : null}
          {apiState === 'unavailable' ? <tr><td colSpan={6} className={styles.emptyState}>前置机台账控制面暂不可用。</td></tr> : null}
        </tbody>
      </table></div>

      {deployNode ? <Drawer
        titleId="edge-deploy-title"
        eyebrow={`发布记录 · ${deployNode.name}`}
        title="版本登记与历史"
        closeLabel="关闭发布记录"
        onClose={() => setDeployNode(null)}
      >
        <div className={styles.drawerNotice}><History size={16} /><span>登记面只记录版本与说明（部署经 deploy/minifi 脚本执行）；这里不承载制品本体，发布人取当前登录身份。</span></div>
        <form className={styles.drawerForm} onSubmit={(event) => submitDeployment(event)}>
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="deploy-version">版本号</label><input id="deploy-version" required value={deployForm.version} onChange={(event) => setDeployForm((current) => ({ ...current, version: event.target.value }))} placeholder="例如：minifi-1.22-flow-v3" /></div>
            <div className={styles.formField}><label htmlFor="deploy-artifact">产物标识（可选）</label><input id="deploy-artifact" value={deployForm.artifactRef} onChange={(event) => setDeployForm((current) => ({ ...current, artifactRef: event.target.value }))} placeholder="例如：deploy/minifi@2026-10" /></div>
          </div>
          <div className={styles.formField}><label htmlFor="deploy-note">发布说明</label><input id="deploy-note" value={deployForm.note} onChange={(event) => setDeployForm((current) => ({ ...current, note: event.target.value }))} placeholder="例如：更换 EP 采集流并调大批次" /></div>
          {deployError ? <p className={styles.formError} role="alert">{deployError}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={pendingKey === 'record-deployment'}><Plus size={14} />{pendingKey === 'record-deployment' ? '登记中…' : '登记发布'}</button>
        </form>
        <ol className={styles.runTimeline}>
          {deployments.map((deployment) => (
            <li key={deployment.id}>
              <div className={styles.timelineDot} data-tone="healthy" />
              <div className={styles.timelineBody}>
                <div className={styles.timelineTitle}><strong>{deployment.version}</strong><time>{formatDateTime(deployment.deployedAt)}</time></div>
                {deployment.note ? <p>{deployment.note}</p> : null}
                <dl><div><dt>发布人</dt><dd>{deployment.deployedBy}</dd></div>{deployment.artifactRef ? <div><dt>产物</dt><dd>{deployment.artifactRef}</dd></div> : null}</dl>
              </div>
            </li>
          ))}
          {deployments.length === 0 ? <li><div className={styles.timelineBody}><p>暂无发布记录。</p></div></li> : null}
        </ol>
      </Drawer> : null}

      {formOpen ? <Drawer
        titleId="edge-node-form-title"
        eyebrow={editing ? '前置机编辑' : '前置机登记'}
        title={editing ? editing.name : '登记前置机节点'}
        closeLabel="关闭前置机表单"
        onClose={() => setFormOpen(false)}
        footer={<><button className={styles.secondaryButton} type="button" onClick={() => setFormOpen(false)}>取消</button><button className={styles.primaryButton} type="submit" form="edge-node-form" disabled={saving}><Save size={14} />{saving ? '保存中…' : '保存节点'}</button></>}
      >
        <form id="edge-node-form" className={styles.drawerForm} onSubmit={(event) => submit(event)}>
          <div className={styles.drawerNotice}><Network size={16} /><span>登记的是医院边缘侧采集节点（MiNiFi 路线）。状态由控制面从中心发起 TCP 探活判定；参数只保存中转前缀等非敏感描述，凭据一律走凭据服务。</span></div>
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="edge-name">节点名称</label><input id="edge-name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：市一院本部前置机" /></div>
            <div className={styles.formField}><label htmlFor="edge-group">分组</label><input id="edge-group" value={form.groupName} onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))} placeholder="默认分组" /></div>
            <div className={styles.formField}><label htmlFor="edge-host">主机地址</label><input id="edge-host" required value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} placeholder="例如：10.0.8.12" /></div>
            <div className={styles.formField}><label htmlFor="edge-port">探测端口</label><input id="edge-port" required type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))} placeholder="8443" /></div>
            <div className={styles.formField}><label htmlFor="edge-site">站点</label><input id="edge-site" value={form.site} onChange={(event) => setForm((current) => ({ ...current, site: event.target.value }))} placeholder="例如：本部 / 东院区" /></div>
            <div className={styles.formField}><label htmlFor="edge-version">版本</label><input id="edge-version" value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} placeholder="例如：minifi-1.x" /></div>
          </div>
          <div className={styles.formField}><label htmlFor="edge-relay">中转桶前缀（非敏感描述，可选）</label><input id="edge-relay" value={form.relayPrefix} onChange={(event) => setForm((current) => ({ ...current, relayPrefix: event.target.value }))} placeholder="例如：/ep-edge-hq/" /></div>
          {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
        </form>
      </Drawer> : null}
    </section>
  )
}

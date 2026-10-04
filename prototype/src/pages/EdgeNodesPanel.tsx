import { Network, Pencil, Plus, Radar, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Drawer } from '../components/ui/Drawer'
import { StatusTag } from '../components/ui/Primitives'
import {
  deleteEdgeNode,
  fetchEdgeNodes,
  probeEdgeNode,
  saveEdgeNode,
  type EdgeNodeApiItem,
} from '../data/controlPlane'
import { formatDateTime } from '../data/domain'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import pageStyles from './PlatformOperationsPage.module.css'
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
  const { pendingKey, run } = useAction()
  const probing = pendingKey?.startsWith('probe-')
  const saving = pendingKey === 'save-node'

  const apiState = useApiResource({
    load: (signal) => fetchEdgeNodes(signal),
    onData: (response) => setNodes(response.items),
    onUnavailable: () => setNodes([]),
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
                <button className={styles.tableButton} onClick={() => openEdit(node)}><Pencil size={13} />编辑</button>
                <button className={styles.tableButton} disabled={pendingKey !== null} onClick={() => remove(node)}><Trash2 size={13} />删除</button>
              </div></td>
            </tr>
          ))}
          {apiState === 'live' && nodes.length === 0 ? <tr><td colSpan={6} className={styles.emptyState}>暂未登记前置机节点；登记后可从中心发起可达性探测。</td></tr> : null}
          {apiState === 'unavailable' ? <tr><td colSpan={6} className={styles.emptyState}>前置机台账控制面暂不可用。</td></tr> : null}
        </tbody>
      </table></div>

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

import { ArrowRightLeft, Braces, Download, FileSearch, GitCompareArrows, Import, RefreshCw, Search, Send, ShieldCheck, Trash2, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  compareStandardVersions,
  createStandardVersion,
  deprecateStandardVersion,
  fetchFhirBundle,
  fetchStandardDetail,
  fetchStandards,
  fetchVersionImpact,
  importStandards,
  publishStandardVersion,
  retryStandardSync,
  submitStandardVersion,
  updateStandardVersion,
  type ImportReport,
  type StandardDetailView,
  type StandardListItem,
  type VersionCompare,
  type VersionImpact,
} from '../data/standardsApi'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import styles from './Pages.module.css'

/**
 * 数据标准中心（G22 真实链路）：标准集合 → 不可变版本 → 评审/发布/停用生命周期，
 * 导入 dry-run 先行，版本对比/影响范围/FHIR 导出；OM 术语投影状态如实展示
 * （SYNC_PENDING 可人工重试）。API 不可用时显示真实不可用态，不回静态样例。
 */

const STATUS_OPTIONS = ['', 'DRAFT', 'IN_REVIEW', 'PUBLISHED', 'DEPRECATED']
const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿', IN_REVIEW: '评审中', PUBLISHED: '已发布', DEPRECATED: '已停用',
}

function statusTone(status: string) {
  if (status === 'PUBLISHED') return 'healthy' as const
  if (status === 'DEPRECATED') return 'neutral' as const
  if (status === 'IN_REVIEW') return 'warning' as const
  return 'neutral' as const
}

function severityTone(severity: string) {
  if (severity === 'CRITICAL' || severity === 'SENSITIVE') return 'danger' as const
  if (severity === 'HIGH') return 'warning' as const
  return 'neutral' as const
}

export function DataStandardsLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [items, setItems] = useState<StandardListItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<StandardDetailView | null>(null)
  const [detailVersionId, setDetailVersionId] = useState('')
  const [compareWith, setCompareWith] = useState('')
  const [compareResult, setCompareResult] = useState<VersionCompare | null>(null)
  const [impact, setImpact] = useState<VersionImpact | null>(null)
  const [importBody, setImportBody] = useState('')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [metaDraft, setMetaDraft] = useState({ standardName: '', description: '', owner: '' })
  const [elementsDraft, setElementsDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const listState = useApiResource({
    timeoutMs: 15000,
    reloadKey: `${query}|${statusFilter}|${reloadKey}`,
    load: (signal) => fetchStandards(signal, query, statusFilter),
    onData: (list) => {
      setItems(list)
      setSelectedId((current) => (list.some((item) => item.id === current) ? current : (list[0]?.id ?? '')))
    },
    onUnavailable: () => setItems([]),
  })

  const detailState = useApiResource({
    timeoutMs: 15000,
    reloadKey: `${selectedId}|${detailVersionId}|${reloadKey}`,
    load: (signal) => (selectedId ? fetchStandardDetail(signal, selectedId, detailVersionId) : Promise.resolve(null as unknown as StandardDetailView)),
    onData: (data) => {
      setDetail(data)
      if (data) {
        setDetailVersionId(data.version.id)
        setMetaDraft({ standardName: '', description: '', owner: '' })
        setElementsDraft('')
        setCompareWith('')
        setCompareResult(null)
        setImpact(null)
      }
    },
    onUnavailable: () => setDetail(null),
  })

  const paged = usePaged(items, 8)
  const version = detail?.version
  const selectedVersionMeta = useMemo(
    () => detail?.versions.find((item) => item.id === version?.id) ?? null,
    [detail, version])

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      setReloadKey((key) => key + 1)
      onNotice(`${label}成功`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `${label}失败`)
    } finally {
      setBusy(false)
    }
  }

  async function downloadFhir() {
    if (!version) return
    try {
      const bundle = await fetchFhirBundle(version.id)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `standard-fhir-${detail?.standard.code}-v${version.versionNo}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      onNotice('FHIR Bundle 已导出（不含内部数据库标识）')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'FHIR 导出失败')
    }
  }

  if (listState === 'unavailable') {
    return (
      <div className={styles.page}>
        <PageHeader title="数据标准中心" eyebrow="数据标准" subtitle="标准集合、版本评审与发布" />
        <div className={styles.content}>
          <section className={styles.panel} role="status">
            <div className={styles.panelHeader}><h2>控制面暂不可用</h2></div>
            <p className={styles.emptyState}>数据标准服务不可达，暂无法加载标准清单。请稍后重试；本页不显示静态样例。</p>
            <Button onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />重试</Button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="数据标准中心" eyebrow="数据标准" subtitle="标准集合、不可变版本、评审发布与影响范围" asOf={detail?.standard.updatedAt} />
      <div className={styles.content}>
        <div className={styles.listTools}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); paged.setPage(0) }} placeholder="搜索标准代码或名称" aria-label="搜索数据标准" />
          </label>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); paged.setPage(0) }} aria-label="按最新版本状态筛选">
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option === '' ? '全部状态' : `${STATUS_LABEL[option]}（${option}）`}</option>
            ))}
          </select>
        </div>

        <div className={styles.tablePanel}>
          <div className={styles.panelHeader}>
            <div><h2>标准清单</h2><p>{items.length} 项 · 版本不可变，发布需经评审</p></div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>代码</th><th>名称</th><th>负责人</th><th>最新版本</th><th>状态</th><th>术语投影</th></tr></thead>
              <tbody>
                {listState === 'loading' ? <tr className={styles.emptyRow}><td colSpan={6}>正在加载标准清单…</td></tr> : null}
                {listState === 'live' && paged.paged.length === 0 ? <tr className={styles.emptyRow}><td colSpan={6}>暂无数据标准。可在下方导入区新建（先预检后落库）。</td></tr> : null}
                {paged.paged.map((item) => (
                  <tr key={item.id} className={`${styles.clickableRow} ${item.id === selectedId ? styles.activeRow : ''}`} onClick={() => { setSelectedId(item.id); setDetailVersionId('') }}>
                    <td className={styles.inlineCode}>{item.code}</td>
                    <td>{item.name}</td>
                    <td>{item.owner || '—'}</td>
                    <td>v{item.latestVersion.versionNo} / 共 {item.versionCount} 版</td>
                    <td><StatusTag tone={statusTone(item.latestVersion.status)}>{STATUS_LABEL[item.latestVersion.status] ?? item.latestVersion.status}</StatusTag></td>
                    <td>{item.latestVersion.status === 'PUBLISHED'
                      ? <StatusTag tone={item.latestVersion.syncStatus === 'SYNCED' ? 'healthy' : 'warning'}>{item.latestVersion.syncStatus === 'SYNCED' ? '已同步' : '待同步'}</StatusTag>
                      : '—'}</td>
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
        </div>

        {detail && version ? (
          <div className={styles.twoColumns}>
            <section className={styles.tablePanel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{detail.standard.name}</h2>
                  <p>{detail.standard.code} · {detail.standard.owner || '未指定负责人'}</p>
                </div>
                <div className={styles.panelHeaderActions}>
                  <Button disabled={busy} onClick={() => run('创建新版本', async () => { await createStandardVersion(detail.standard.id) })}><GitCompareArrows size={14} />基于当前发布版新建草稿</Button>
                </div>
              </div>
              <div className={styles.versionTrail}>
                {detail.versions.map((item) => (
                  <button
                    key={item.id}
                    className={`${styles.timelineDot} ${item.id === version.id ? styles.activeRow : ''}`}
                    onClick={() => setDetailVersionId(item.id)}
                    aria-pressed={item.id === version.id}
                  >
                    <strong>v{item.versionNo}</strong>
                    <StatusTag tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</StatusTag>
                    <span>{item.syncStatus === 'SYNCED' ? '术语已投影' : item.status === 'PUBLISHED' ? '投影待同步' : ''}</span>
                  </button>
                ))}
              </div>

              <div className={styles.tableActions}>
                {version.status === 'DRAFT' ? (
                  <>
                    <Button disabled={busy} onClick={() => run('提交评审', () => submitStandardVersion(version.id))}><Send size={14} />提交评审</Button>
                  </>
                ) : null}
                {version.status === 'IN_REVIEW' ? (
                  <Button disabled={busy} onClick={() => run('发布', () => publishStandardVersion(version.id))}><ShieldCheck size={14} />发布（管理员）</Button>
                ) : null}
                {version.status === 'PUBLISHED' ? (
                  <>
                    <Button variant="quiet" disabled={busy} onClick={() => run('停用', () => deprecateStandardVersion(version.id))}><Trash2 size={14} />停用</Button>
                    {version.syncStatus !== 'SYNCED' ? (
                      <Button variant="quiet" disabled={busy} onClick={() => run('术语投影重试', () => retryStandardSync(version.id))}><RefreshCw size={14} />重试术语投影</Button>
                    ) : null}
                  </>
                ) : null}
                <Button variant="quiet" disabled={busy} onClick={() => run('影响范围读取', async () => setImpact(await fetchVersionImpact(undefined, version.id)))}><FileSearch size={14} />影响范围</Button>
                <Button variant="quiet" onClick={downloadFhir}><Download size={14} />FHIR 导出</Button>
              </div>

              {version.status === 'DRAFT' ? (
                <div className={styles.drawerForm}>
                  <h3 className={styles.sectionTitle}>草稿修改（仅 DRAFT 可改）</h3>
                  <div className={styles.drawerFormGrid}>
                    <label>标准名称<input value={metaDraft.standardName} onChange={(event) => setMetaDraft({ ...metaDraft, standardName: event.target.value })} placeholder={detail.standard.name} /></label>
                    <label>负责人<input value={metaDraft.owner} onChange={(event) => setMetaDraft({ ...metaDraft, owner: event.target.value })} placeholder={detail.standard.owner || '未指定'} /></label>
                  </div>
                  <label>描述<input value={metaDraft.description} onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })} placeholder={detail.standard.description || '补充标准描述'} /></label>
                  <label>元素集整体替换（JSON 数组；留空则不修改）<Braces size={13} />
                    <textarea className={styles.codeInputLarge} rows={5} value={elementsDraft} onChange={(event) => setElementsDraft(event.target.value)}
                      placeholder='[{"code":"channel","name":"挂号渠道","dataType":"CODE","required":true,"definition":"渠道枚举","sensitivity":"NORMAL","assetRef":"","values":[{"code":"OPD","displayName":"门诊"}]}]' />
                  </label>
                  <Button disabled={busy} onClick={() => run('草稿修改', async () => {
                    const payload: Record<string, unknown> = {}
                    if (metaDraft.standardName.trim()) payload.standardName = metaDraft.standardName.trim()
                    if (metaDraft.description.trim()) payload.description = metaDraft.description.trim()
                    if (metaDraft.owner.trim()) payload.owner = metaDraft.owner.trim()
                    if (elementsDraft.trim()) payload.elements = JSON.parse(elementsDraft)
                    await updateStandardVersion(version.id, payload)
                  })}>保存草稿修改</Button>
                </div>
              ) : null}

              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr><th>数据元</th><th>类型</th><th>必填</th><th>敏感级别</th><th>定义</th><th>值域</th></tr></thead>
                  <tbody>
                    {version.elements.map((element) => (
                      <tr key={element.id}>
                        <td><span className={styles.inlineCode}>{element.code}</span><br /><small>{element.name}</small></td>
                        <td>{element.dataType}</td>
                        <td>{element.required ? '必填' : '可选'}</td>
                        <td><StatusTag tone={severityTone(element.sensitivity)}>{element.sensitivity}</StatusTag></td>
                        <td><small>{element.definition || '—'}</small></td>
                        <td>{element.dataType === 'CODE'
                          ? element.values.map((value) => <span key={value.code} className={styles.configPill}>{value.code} {value.displayName}</span>)
                          : '—'}</td>
                      </tr>
                    ))}
                    {version.elements.length === 0 ? <tr className={styles.emptyRow}><td colSpan={6}>该版本暂无数据元。</td></tr> : null}
                  </tbody>
                </table>
              </div>

              {impact ? (
                <div className={styles.evidenceBox}>
                  <h3>影响范围（v{impact.versionNo}）</h3>
                  <p>数据元 {impact.elementCount} 个；引用资产 {impact.referencedAssets.length} 项{impact.referencedAssets.length > 0 ? `：${impact.referencedAssets.join('、')}` : ''}。{impact.notes.join('；')}</p>
                </div>
              ) : null}

              <div className={styles.listTools}>
                <label>版本对比：与
                  <select value={compareWith} onChange={(event) => setCompareWith(event.target.value)} aria-label="选择对比版本">
                    <option value="">选择另一版本…</option>
                    {detail.versions.filter((item) => item.id !== version.id).map((item) => (
                      <option key={item.id} value={item.id}>v{item.versionNo}（{STATUS_LABEL[item.status]}）</option>
                    ))}
                  </select>
                </label>
                <Button variant="quiet" disabled={!compareWith || busy} onClick={() => run('版本对比', async () => setCompareResult(await compareStandardVersions(version.id, compareWith)))}><ArrowRightLeft size={14} />对比</Button>
              </div>
              {compareResult ? (
                <div className={styles.compareWrap}>
                  <h3>v{compareResult.left.versionNo} ↔ v{compareResult.right.versionNo}</h3>
                  <ul className={styles.checkList}>
                    {compareResult.added.map((item) => <li key={`a-${item.code}`} className={styles.textHealthy}>+ {item.code}（{item.name}）仅存在于对比版本</li>)}
                    {compareResult.removed.map((item) => <li key={`r-${item.code}`} className={styles.textWarning}>− {item.code}（{item.name}）仅存在于当前版本</li>)}
                    {compareResult.changed.map((item) => <li key={`c-${item.code}`}>{item.code}（{item.name}）：{item.differences.join('；')}</li>)}
                    {compareResult.added.length + compareResult.removed.length + compareResult.changed.length === 0 ? <li>两版本内容一致。</li> : null}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}><h2>审计事件</h2><p>最近 20 条</p></div>
              <ul className={styles.timelineBody}>
                {detail.events.map((event) => (
                  <li key={event.id}>
                    <div className={styles.timelineTitle}><strong>{event.eventType}</strong><span>{event.actor || 'system'}</span></div>
                    <p>{event.detail}</p>
                    <small>{event.createdAt}</small>
                  </li>
                ))}
                {detail.events.length === 0 ? <li className={styles.emptyState}>暂无事件。</li> : null}
              </ul>
              {detailState === 'loading' ? <p className={styles.emptyState}>正在加载详情…</p> : null}
              {selectedVersionMeta ? <p className={styles.emptyState}>当前查看 v{selectedVersionMeta.versionNo} · {STATUS_LABEL[selectedVersionMeta.status]}</p> : null}
            </section>
          </div>
        ) : null}

        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}>
            <div><h2>导入标准</h2><p>平台 CSV 模板或内部 JSON；先预检（dry-run）再落库</p></div>
          </div>
          <div className={styles.drawerForm}>
            <label>导入内容（CSV 列：standard_code,standard_name,element_code,element_name,data_type,required,definition,sensitivity,value_code,value_display；或与创建接口同构的 JSON）<Import size={13} />
              <textarea className={styles.codeInputLarge} rows={5} value={importBody} onChange={(event) => { setImportBody(event.target.value); setImportReport(null) }}
                placeholder={'standard_code,standard_name,element_code,element_name,data_type,required,definition,sensitivity,value_code,value_display\nreg-channel,挂号渠道,channel,挂号渠道,CODE,true,渠道枚举,NORMAL,OPD,门诊'} />
            </label>
            <div className={styles.tableActions}>
              <Button variant="quiet" disabled={!importBody.trim() || busy} onClick={() => run('导入预检', async () => setImportReport(await importStandards(importBody, true)))}><UploadCloud size={14} />预检（dry-run）</Button>
              <Button disabled={!importReport || importReport.dryRun === false || importReport.problems.length > 0 || busy}
                onClick={() => run('导入落库', async () => setImportReport(await importStandards(importBody, false)))}>确认导入</Button>
            </div>
            {importReport ? (
              <div className={styles.evidenceBox}>
                <h3>预检报告 · {importReport.standardCode || '（空代码）'}</h3>
                <p>数据元 {importReport.elementCount} 个 · 值域 {importReport.valueCount} 条 · 问题 {importReport.problems.length} 项</p>
                {importReport.problems.length > 0 ? (
                  <ul className={styles.checkList}>{importReport.problems.map((problem) => <li key={problem} className={styles.textWarning}>{problem}</li>)}</ul>
                ) : <p className={styles.textHealthy}>校验通过，可确认导入。</p>}
                {importReport.created ? <p>已创建：{importReport.created.standard.code}（草稿 v{importReport.created.version.versionNo}）</p> : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

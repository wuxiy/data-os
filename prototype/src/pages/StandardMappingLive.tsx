import { ArrowRightLeft, ClipboardCheck, GitCompareArrows, History, Import, RefreshCw, Search, ShieldCheck, Trash2, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import {
  activateMappingVersion,
  createMappingSet,
  createMappingVersion,
  fetchMappingCoverage,
  fetchMappingDetail,
  fetchMappingImpact,
  fetchMappingSets,
  importMappingItems,
  rollbackMapping,
  retireMappingVersion,
  submitMappingVersion,
  updateMappingVersion,
  validateMappingVersion,
  type ImportReport,
  type MappingDetailView,
  type MappingImpact,
  type MappingCoverage,
  type MappingSetListItem,
} from '../data/mappingApi'
import { fetchStandards, type StandardListItem } from '../data/standardsApi'
import { useApiResource } from '../hooks/useApiResource'
import { usePaged } from '../hooks/usePaged'
import styles from './Pages.module.css'

/**
 * 标准映射（G23 真实链路）：映射集 → 不可变版本 → 聚合验证（checksum 对齐）→
 * 评审 → 生效（管理员）→ 回退；治理事实在控制面，验证聚合在质量执行器，
 * 本页不复制任何状态机。API 不可用显示真实不可用态，不回静态样例。
 */

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿', IN_REVIEW: '评审中', ACTIVE: '生效中', RETIRED: '已停用',
}

function statusTone(status: string) {
  if (status === 'ACTIVE') return 'healthy' as const
  if (status === 'IN_REVIEW') return 'warning' as const
  if (status === 'RETIRED') return 'neutral' as const
  return 'neutral' as const
}

export function StandardMappingLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [sets, setSets] = useState<MappingSetListItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<MappingDetailView | null>(null)
  const [detailVersionId, setDetailVersionId] = useState('')
  const [rollbackTo, setRollbackTo] = useState('')
  const [impact, setImpact] = useState<MappingImpact | null>(null)
  const [importBody, setImportBody] = useState('')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [itemsDraft, setItemsDraft] = useState('')
  const [coverage, setCoverage] = useState<MappingCoverage | null>(null)
  const [standardOptions, setStandardOptions] = useState<StandardListItem[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ code: '', name: '', sourceAsset: 'doris-dataos.default.ods_ep.ep_mz_cfzb', dataset: 'ods_ep.ep_mz_cfzb', standardId: '' })
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const listState = useApiResource({
    timeoutMs: 15000,
    reloadKey: `${query}|${reloadKey}`,
    load: (signal) => fetchMappingSets(signal, query),
    onData: (list) => {
      setSets(list)
      setSelectedId((current) => (list.some((item) => item.id === current) ? current : (list[0]?.id ?? '')))
    },
    onUnavailable: () => setSets([]),
  })

  const standardsState = useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchStandards(signal, 'PUBLISHED', 'PUBLISHED'),
    onData: (list) => setStandardOptions(list),
    onUnavailable: () => setStandardOptions([]),
  })

  const coverageState = useApiResource({
    timeoutMs: 15000,
    reloadKey,
    load: (signal) => fetchMappingCoverage(signal),
    onData: setCoverage,
    onUnavailable: () => setCoverage(null),
  })

  const detailState = useApiResource({
    timeoutMs: 15000,
    reloadKey: `${selectedId}|${detailVersionId}|${reloadKey}`,
    load: (signal) => (selectedId ? fetchMappingDetail(signal, selectedId, detailVersionId) : Promise.resolve(null as unknown as MappingDetailView)),
    onData: (data) => {
      setDetail(data)
      if (data) {
        setDetailVersionId(data.version.id)
        setItemsDraft('')
        setRollbackTo('')
        setImpact(null)
        setImportReport(null)
      }
    },
    onUnavailable: () => setDetail(null),
  })

  const paged = usePaged(sets, 8)
  const version = detail?.version

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

  const activeVersionMeta = useMemo(() => {
    if (!detail) return null
    const active = detail.set.activeVersion as { versionNo?: number }
    if (!active || active.versionNo === undefined) return null
    return detail.versions.find((item) => item.versionNo === active.versionNo) ?? null
  }, [detail])

  if (listState === 'unavailable') {
    return (
      <div className={styles.page}>
        <PageHeader title="标准映射" eyebrow="标准映射" subtitle="源资产字段到标准数据元的受控映射" />
        <div className={styles.content}>
          <section className={styles.panel} role="status">
            <div className={styles.panelHeader}><h2>控制面暂不可用</h2></div>
            <p className={styles.emptyState}>标准映射服务不可达，暂无法加载映射集；本页不显示静态样例。</p>
            <Button onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />重试</Button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="标准映射" eyebrow="标准映射"
        subtitle="源资产字段 → 标准数据元（受控转换：COPY/TRIM/UPPER/DATE_FORMAT/VALUE_MAP）"
        asOf={detail?.set.updatedAt}
      />
      <div className={styles.content}>
        {coverageState === 'live' && coverage ? (
          <section className={styles.attention}>
            <div className={styles.attentionText}>
              <ClipboardCheck size={21} />
              <div>
                <h2>{coverage.coverage === null ? '映射覆盖率：未配置（AI Ready 该项 N/A）'
                  : `ACTIVE 映射覆盖率 ${(coverage.coverage * 100).toFixed(1)}%`}</h2>
                <p>ACTIVE 映射版本 {coverage.activeMappingVersions} 个 · 已发布标准值域数据元 {coverage.publishedCodeElements} 个 · 已覆盖 {coverage.coveredCodeElements} 个；AI Ready 的 FHIR 映射就绪检查消费同一投影。</p>
              </div>
            </div>
            <StatusTag tone={coverage.coverage === null ? 'neutral' : coverage.coverage >= 0.9 ? 'healthy' : 'warning'}>
              {coverage.coverage === null ? 'N/A' : `${(coverage.coverage * 100).toFixed(1)}%`}
            </StatusTag>
          </section>
        ) : null}

        <div className={styles.listTools}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); paged.setPage(0) }} placeholder="搜索映射集代码/名称/源资产" aria-label="搜索映射集" />
          </label>
          <Button variant="quiet" disabled={busy} onClick={() => setCreateOpen((open) => !open)}><GitCompareArrows size={14} />新建映射集</Button>
        </div>

        {createOpen ? (
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}><div><h2>新建映射集</h2><p>目标标准须为已发布；映射项可用 CSV/JSON 导入补齐</p></div></div>
            <div className={styles.drawerForm}>
              <div className={styles.drawerFormGrid}>
                <label>映射集代码<input value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} placeholder="MAP-EP-CFZB" /></label>
                <label>名称<input value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="门诊处方表映射" /></label>
              </div>
              <div className={styles.drawerFormGrid}>
                <label>源资产（fqn）<input value={createForm.sourceAsset} onChange={(event) => setCreateForm({ ...createForm, sourceAsset: event.target.value })} /></label>
                <label>验证数据集（须已登记）<input value={createForm.dataset} onChange={(event) => setCreateForm({ ...createForm, dataset: event.target.value })} /></label>
              </div>
              <label>目标标准
                <select value={createForm.standardId} onChange={(event) => setCreateForm({ ...createForm, standardId: event.target.value })} aria-label="选择目标标准">
                  <option value="">选择已发布标准…</option>
                  {standardOptions.map((standard) => (
                    <option key={standard.id} value={standard.id}>{standard.code} · {standard.name}</option>
                  ))}
                </select>
              </label>
              <Button
                disabled={busy || !createForm.code.trim() || !createForm.standardId}
                onClick={() => run('映射集创建', async () => {
                  await createMappingSet({ ...createForm, items: [] })
                  setCreateOpen(false)
                })}
              >创建（空草稿，随后导入映射项）</Button>
            </div>
          </section>
        ) : null}

        <div className={styles.tablePanel}>
          <div className={styles.panelHeader}>
            <div><h2>映射集清单</h2><p>{sets.length} 项 · 版本不可变，生效需同 checksum 的 PASS 验证</p></div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>代码</th><th>源资产</th><th>目标标准</th><th>活动版本</th><th>版本数</th></tr></thead>
              <tbody>
                {listState === 'loading' ? <tr className={styles.emptyRow}><td colSpan={5}>正在加载映射集…</td></tr> : null}
                {listState === 'live' && paged.paged.length === 0 ? <tr className={styles.emptyRow}><td colSpan={5}>暂无映射集。新建后经「导入 → 聚合验证 → 评审 → 生效」闭环。</td></tr> : null}
                {paged.paged.map((set) => (
                  <tr key={set.id} className={`${styles.clickableRow} ${set.id === selectedId ? styles.activeRow : ''}`} onClick={() => { setSelectedId(set.id); setDetailVersionId('') }}>
                    <td className={styles.inlineCode}>{set.code}</td>
                    <td><small>{set.sourceAsset}</small></td>
                    <td>{set.standard.code}</td>
                    <td>{'versionNo' in set.activeVersion && set.activeVersion.versionNo
                      ? <StatusTag tone="healthy">v{set.activeVersion.versionNo} 生效中</StatusTag>
                      : <StatusTag>未生效</StatusTag>}</td>
                    <td>{set.versionCount}</td>
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
                <div><h2>{detail.set.name}</h2><p>{detail.set.code} · {detail.set.sourceAsset} → {detail.set.standard.code}（验证数据集 {detail.set.dataset}）</p></div>
                <div className={styles.panelHeaderActions}>
                  <Button variant="quiet" disabled={busy} onClick={() => run('新建映射版本', () => createMappingVersion(detail.set.id))}><GitCompareArrows size={14} />基于活动版新建草稿</Button>
                </div>
              </div>

              <div className={styles.versionTrail}>
                {detail.versions.map((item) => (
                  <button key={item.id} className={`${styles.timelineDot} ${item.id === version.id ? styles.activeRow : ''}`}
                    onClick={() => setDetailVersionId(item.id)} aria-pressed={item.id === version.id}>
                    <strong>v{item.versionNo}</strong>
                    <StatusTag tone={statusTone(item.status)}>{STATUS_LABEL[item.status] ?? item.status}</StatusTag>
                    <span className={styles.inlineCode}>{item.checksum.slice(0, 10)}…</span>
                  </button>
                ))}
              </div>

              <div className={styles.tableActions}>
                {version.status === 'DRAFT' ? (
                  <Button disabled={busy} onClick={() => run('提交评审', () => submitMappingVersion(version.id))}>提交评审</Button>
                ) : null}
                <Button variant="quiet" disabled={busy} onClick={() => run('聚合验证', () => validateMappingVersion(version.id))}><ShieldCheck size={14} />聚合验证</Button>
                {version.status === 'IN_REVIEW' ? (
                  <Button disabled={busy} onClick={() => run('生效', () => activateMappingVersion(version.id))}><ShieldCheck size={14} />生效（管理员 · 需 PASS 证据）</Button>
                ) : null}
                {version.status === 'ACTIVE' ? (
                  <Button variant="quiet" disabled={busy} onClick={() => run('停用', () => retireMappingVersion(version.id))}><Trash2 size={14} />停用</Button>
                ) : null}
                <Button variant="quiet" disabled={busy} onClick={() => run('影响范围读取', async () => setImpact(await fetchMappingImpact(undefined, version.id)))}><ArrowRightLeft size={14} />影响范围</Button>
              </div>

              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr><th>源字段</th><th>目标数据元</th><th>转换</th><th>参数</th><th>人工结论</th></tr></thead>
                  <tbody>
                    {version.items.map((item) => (
                      <tr key={item.id}>
                        <td className={styles.inlineCode}>{item.sourceColumn}</td>
                        <td>{item.targetElementCode}</td>
                        <td>{item.transform}</td>
                        <td><small>{item.transformParam || '—'}</small></td>
                        <td><StatusTag tone={item.conclusion === 'CONFIRMED' ? 'healthy' : 'warning'}>{item.conclusion === 'CONFIRMED' ? '已确认' : '待复核'}</StatusTag></td>
                      </tr>
                    ))}
                    {version.items.length === 0 ? <tr className={styles.emptyRow}><td colSpan={5}>该版本暂无映射项；可用下方导入区补齐（先预检）。</td></tr> : null}
                  </tbody>
                </table>
              </div>

              {impact ? (
                <div className={styles.evidenceBox}>
                  <h3>影响范围（v{impact.versionNo} · {impact.status}）</h3>
                  <p>映射项 {impact.itemCount} 条；源 {impact.sourceAsset}；目标标准 {impact.standard.code}。</p>
                  <p>已覆盖数据元：{Object.keys(impact.mappedElements).join('、') || '—'}；未覆盖值域数据元：{impact.unpublishedUncoveredElements.join('、') || '—'}。</p>
                </div>
              ) : null}

              {version.validations.length > 0 ? (
                <div className={styles.evidenceBox}>
                  <h3>验证证据（最新 {version.validations.length} 次）</h3>
                  {version.validations.map((validation) => (
                    <p key={validation.id}>
                      <StatusTag tone={validation.status === 'PASS' ? 'healthy' : validation.status === 'FAIL' ? 'danger' : 'warning'}>{validation.status}</StatusTag>
                      <span className={styles.inlineCode}>{validation.checksum.slice(0, 10)}…</span>
                      <small> {validation.dataTime || validation.createdAt}</small>
                    </p>
                  ))}
                </div>
              ) : null}

              {activeVersionMeta && activeVersionMeta.status === 'ACTIVE' && detail.versions.some((item) => item.status === 'RETIRED') ? (
                <div className={styles.listTools}>
                  <label>回退到
                    <select value={rollbackTo} onChange={(event) => setRollbackTo(event.target.value)} aria-label="选择回退目标版本">
                      <option value="">选择曾生效的停用版本…</option>
                      {detail.versions.filter((item) => item.status === 'RETIRED').map((item) => (
                        <option key={item.id} value={item.id}>v{item.versionNo}</option>
                      ))}
                    </select>
                  </label>
                  <Button variant="quiet" disabled={!rollbackTo || busy} onClick={() => run('回退', () => rollbackMapping(detail.set.id, rollbackTo))}><History size={14} />回退（管理员）</Button>
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
            </section>
          </div>
        ) : null}

        {detail && version && version.status === 'DRAFT' ? (
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}>
              <div><h2>草稿维护（仅 DRAFT）</h2><p>导入映射项（CSV/JSON，先预检）或整体替换（JSON）</p></div>
            </div>
            <div className={styles.drawerForm}>
              <label>导入内容（CSV 列：source_column,target_element_code,transform,transform_param,conclusion；或 JSON {'{items:[…]}'}）<Import size={13} />
                <textarea className={styles.codeInputLarge} rows={5} value={importBody} onChange={(event) => { setImportBody(event.target.value); setImportReport(null) }}
                  placeholder={'source_column,target_element_code,transform,transform_param,conclusion\nchannel_code,channel,VALUE_MAP,"{""OPD"":""OPD""}",CONFIRMED'} />
              </label>
              <div className={styles.tableActions}>
                <Button variant="quiet" disabled={!importBody.trim() || busy} onClick={() => run('导入预检', async () => setImportReport(await importMappingItems(version.id, importBody, true)))}><UploadCloud size={14} />预检（dry-run）</Button>
                <Button disabled={!importReport || importReport.problems.length > 0 || busy}
                  onClick={() => run('导入落库', async () => setImportReport(await importMappingItems(version.id, importBody, false)))}>确认导入</Button>
              </div>
              {importReport ? (
                <div className={styles.evidenceBox}>
                  <h3>{importReport.applied ? '已应用' : '预检报告'}</h3>
                  <p>映射项 {importReport.itemCount} 条 · checksum {importReport.checksum ? `${importReport.checksum.slice(0, 12)}…` : '—'}</p>
                  {importReport.problems.length > 0
                    ? <ul className={styles.checkList}>{importReport.problems.map((problem) => <li key={problem} className={styles.textWarning}>{problem}</li>)}</ul>
                    : <p className={styles.textHealthy}>校验通过。</p>}
                </div>
              ) : null}
              <label>元素整体替换（JSON 数组；留空不修改）<Braces />
                <textarea className={styles.codeInputLarge} rows={4} value={itemsDraft} onChange={(event) => setItemsDraft(event.target.value)}
                  placeholder='[{"sourceColumn":"channel_code","targetElementCode":"channel","transform":"VALUE_MAP","transformParam":"{\"OPD\":\"OPD\"}","conclusion":"CONFIRMED"}]' />
              </label>
              <Button disabled={!itemsDraft.trim() || busy} onClick={() => run('草稿替换', async () => {
                await updateMappingVersion(version.id, { items: JSON.parse(itemsDraft) })
              })}>整体替换并重算 checksum</Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )

}

function Braces() {
  return <span aria-hidden="true">{'{}'}</span>
}

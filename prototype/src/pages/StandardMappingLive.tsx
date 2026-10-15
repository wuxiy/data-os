import { ArrowRightLeft, ClipboardCheck, GitCompareArrows, History, RefreshCw, Search, Archive, ShieldCheck, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Form, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
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
import { actorLabel, formatDateTime, standardEventLabel, transformLabel } from '../data/domain'
import type { RouteKey, Tone } from '../types'
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

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR: Record<Tone, string> = {
  healthy: 'success',
  warning: 'warning',
  danger: 'error',
  neutral: 'default',
}

function statusTone(status: string): Tone {
  if (status === 'ACTIVE') return 'healthy'
  if (status === 'IN_REVIEW') return 'warning'
  if (status === 'RETIRED') return 'neutral'
  return 'neutral'
}

export function StandardMappingLive({ onNotice, onNavigate, onUnavailable }: { onNotice: (message: string) => void; onNavigate: (route: RouteKey) => void; onUnavailable: (label: string) => void }) {
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
  const [showAllEvents, setShowAllEvents] = useState(false)

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
        setShowAllEvents(false)
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

  // 映射集清单列定义：行可点击选中（键盘可达经 onRow 承载）。
  const setColumns: ColumnsType<MappingSetListItem> = [
    { title: '代码', key: 'code', render: (_, set) => <span className={styles.inlineCode}>{set.code}</span> },
    { title: '源资产', key: 'sourceAsset', render: (_, set) => <small>{set.sourceAsset}</small> },
    { title: '目标标准', key: 'standard', render: (_, set) => set.standard.code },
    {
      title: '活动版本',
      key: 'activeVersion',
      render: (_, set) => 'versionNo' in set.activeVersion && set.activeVersion.versionNo
        ? <Tag color="success">v{set.activeVersion.versionNo} 生效中</Tag>
        : <Tag>未生效</Tag>,
    },
    { title: '版本数', key: 'versionCount', align: 'right', render: (_, set) => set.versionCount },
  ]

  if (listState === 'unavailable') {
    return (
      <div className={styles.page}>
        <PageHeader title="标准映射" eyebrow="标准映射" subtitle="源资产字段到标准数据元的受控映射" />
        <GovernanceTabs route="mapping" onNavigate={onNavigate} onUnavailable={onUnavailable} />
        <div className={styles.content}>
          <section className={styles.panel} role="status">
            <div className={styles.panelHeader}><h2>控制面暂不可用</h2></div>
            <p className={styles.emptyState}>标准映射服务不可达，暂无法加载映射集；本页不显示静态样例。</p>
            <Button size="small" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />重试</Button>
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
        asOf={detail ? formatDateTime(detail.set.updatedAt) : undefined}
      />
      <GovernanceTabs route="mapping" onNavigate={onNavigate} onUnavailable={onUnavailable} />
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
            <Tag color={TONE_COLOR[coverage.coverage === null ? 'neutral' : coverage.coverage >= 0.9 ? 'healthy' : 'warning']}>
              {coverage.coverage === null ? 'N/A' : `${(coverage.coverage * 100).toFixed(1)}%`}
            </Tag>
          </section>
        ) : null}

        <div className={styles.listTools}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); paged.setPage(0) }} placeholder="搜索映射集代码/名称/源资产" aria-label="搜索映射集" />
          </label>
          <Button size="small" disabled={busy} onClick={() => setCreateOpen((open) => !open)}><GitCompareArrows size={14} />新建映射集</Button>
        </div>

        {createOpen ? (
          <section className={styles.tablePanel}>
            <div className={styles.panelHeader}><div><h2>新建映射集</h2><p>目标标准须为已发布；映射项可用 CSV/JSON 导入补齐</p></div></div>
            <div className={styles.drawerForm}>
              <Form layout="vertical">
                <div className={styles.drawerFormGrid}>
                  <Form.Item label="映射集代码">
                    <Input value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} placeholder="MAP-EP-CFZB" />
                  </Form.Item>
                  <Form.Item label="名称">
                    <Input value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="门诊处方表映射" />
                  </Form.Item>
                </div>
                <div className={styles.drawerFormGrid}>
                  <Form.Item label="源资产（fqn）">
                    <Input value={createForm.sourceAsset} onChange={(event) => setCreateForm({ ...createForm, sourceAsset: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="验证数据集（须已登记）">
                    <Input value={createForm.dataset} onChange={(event) => setCreateForm({ ...createForm, dataset: event.target.value })} />
                  </Form.Item>
                </div>
                <Form.Item label="目标标准">
                  <Select
                    value={createForm.standardId}
                    onChange={(value) => setCreateForm({ ...createForm, standardId: value })}
                    aria-label="选择已发布标准"
                    options={[
                      { value: '', label: '选择已发布标准…' },
                      ...standardOptions.map((standard) => ({ value: standard.id, label: `${standard.code} · ${standard.name}` })),
                    ]}
                  />
                </Form.Item>
              </Form>
              <Button
                type="primary"
                size="small"
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
          <Table<MappingSetListItem>
            rowKey="id"
            columns={setColumns}
            dataSource={paged.paged}
            pagination={{
              current: paged.page + 1,
              pageSize: 8,
              total: sets.length,
              showSizeChanger: false,
              onChange: (page) => paged.setPage(page - 1),
            }}
            locale={{
              emptyText: listState === 'loading'
                ? '正在加载映射集…'
                : listState === 'live'
                  ? '暂无映射集。新建后经「导入 → 聚合验证 → 评审 → 生效」闭环。'
                  : '',
            }}
            onRow={(set) => ({
              className: `${styles.clickableRow} ${set.id === selectedId ? styles.activeRow : ''}`,
              tabIndex: 0,
              'aria-label': `选择映射集 ${set.code}`,
              onClick: () => { setSelectedId(set.id); setDetailVersionId('') },
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedId(set.id)
                  setDetailVersionId('')
                }
              },
            })}
          />
        </div>

        {detail && version ? (
          <div className={styles.twoColumns}>
            <section className={styles.tablePanel}>
              <div className={styles.panelHeader}>
                <div><h2>{detail.set.name}</h2><p>{detail.set.code} · {detail.set.sourceAsset} → {detail.set.standard.code}（验证数据集 {detail.set.dataset}）</p></div>
                <div className={styles.panelHeaderActions}>
                  <Button size="small" disabled={busy} onClick={() => run('新建映射版本', () => createMappingVersion(detail.set.id))}><GitCompareArrows size={14} />基于活动版新建草稿</Button>
                </div>
              </div>

              <div className={styles.versionChips}>
                {detail.versions.map((item) => (
                  /* checksum 收进 tooltip（2026-10-05 复评）：派生版本同 checksum，平铺前缀是噪音。 */
                  <button key={item.id} className={styles.versionChip}
                    onClick={() => setDetailVersionId(item.id)} aria-pressed={item.id === version.id}
                    title={`checksum ${item.checksum} · 生效需同值 PASS 验证`}>
                    <strong>v{item.versionNo}</strong>
                    <Tag color={TONE_COLOR[statusTone(item.status)]}>{STATUS_LABEL[item.status] ?? item.status}</Tag>
                  </button>
                ))}
              </div>

              <div className={styles.tableActions}>
                {version.status === 'DRAFT' ? (
                  <Button size="small" disabled={busy} onClick={() => run('提交评审', () => submitMappingVersion(version.id))}>提交评审</Button>
                ) : null}
                <Button size="small" disabled={busy} onClick={() => run('聚合验证', () => validateMappingVersion(version.id))}><ShieldCheck size={14} />聚合验证</Button>
                {version.status === 'IN_REVIEW' ? (
                  <Button size="small" disabled={busy} onClick={() => run('生效', () => activateMappingVersion(version.id))}><ShieldCheck size={14} />生效（管理员 · 需 PASS 证据）</Button>
                ) : null}
                {version.status === 'ACTIVE' ? (
                  <Button size="small" disabled={busy} onClick={() => run('停用', () => retireMappingVersion(version.id))}><Archive size={14} />停用</Button>
                ) : null}
                <Button size="small" disabled={busy} onClick={() => run('影响范围读取', async () => setImpact(await fetchMappingImpact(undefined, version.id)))}><ArrowRightLeft size={14} />影响范围</Button>
              </div>

              <Table
                rowKey="id"
                columns={[
                  { title: '源字段', key: 'sourceColumn', width: 180, render: (_, item: MappingDetailView['version']['items'][number]) => <span className={styles.inlineCode}>{item.sourceColumn}</span> },
                  { title: '目标数据元', key: 'targetElementCode', render: (_, item: MappingDetailView['version']['items'][number]) => item.targetElementCode },
                  { title: '转换', key: 'transform', render: (_, item: MappingDetailView['version']['items'][number]) => transformLabel(item.transform) },
                  { title: '参数', key: 'transformParam', render: (_, item: MappingDetailView['version']['items'][number]) => <small>{item.transformParam || '—'}</small> },
                  { title: '人工结论', key: 'conclusion', render: (_, item: MappingDetailView['version']['items'][number]) => <Tag color={TONE_COLOR[item.conclusion === 'CONFIRMED' ? 'healthy' : 'warning']}>{item.conclusion === 'CONFIRMED' ? '已确认' : '待复核'}</Tag> },
                ]}
                dataSource={version.items}
                pagination={false}
                locale={{ emptyText: '该版本暂无映射项；可用下方导入区补齐（先预检）。' }}
              />

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
                      <Tag color={TONE_COLOR[validation.status === 'PASS' ? 'healthy' : validation.status === 'FAIL' ? 'danger' : 'warning']}>{validation.status}</Tag>
                      <span className={styles.inlineCode}>{validation.checksum.slice(0, 10)}…</span>
                      <small> {formatDateTime(validation.dataTime || validation.createdAt)}</small>
                    </p>
                  ))}
                </div>
              ) : null}

              {activeVersionMeta && activeVersionMeta.status === 'ACTIVE' && detail.versions.some((item) => item.status === 'RETIRED') ? (
                <div className={styles.listTools}>
                  <label>回退到
                    <Select
                      value={rollbackTo}
                      onChange={(value) => setRollbackTo(value)}
                      aria-label="选择回退目标版本"
                      options={[
                        { value: '', label: '选择曾生效的停用版本…' },
                        ...detail.versions.filter((item) => item.status === 'RETIRED').map((item) => ({
                          value: item.id,
                          label: `v${item.versionNo}`,
                        })),
                      ]}
                    />
                  </label>
                  <Button size="small" disabled={!rollbackTo || busy} onClick={() => run('回退', () => rollbackMapping(detail.set.id, rollbackTo))}><History size={14} />回退（管理员）</Button>
                </div>
              ) : null}
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}><h2>审计事件</h2><p>最近 20 条</p></div>
              <ul className={styles.timelineBody}>
                {(showAllEvents ? detail.events : detail.events.slice(0, 6)).map((event) => (
                  <li key={event.id}>
                    <div className={styles.timelineTitle}><strong>{standardEventLabel(event.eventType)}</strong><span>{actorLabel(event.actor)}</span></div>
                    <p>{event.detail}</p>
                    <small>{formatDateTime(event.createdAt)}</small>
                  </li>
                ))}
                {detail.events.length === 0 ? <li className={styles.emptyState}>暂无事件。</li> : null}
              </ul>
              {detail.events.length > 6 ? (
                <div className={styles.tableActions}>
                  <button type="button" className={styles.textButton} onClick={() => setShowAllEvents((current) => !current)}>
                    {showAllEvents ? '收起事件' : `展开全部 ${detail.events.length} 条`}
                  </button>
                </div>
              ) : null}
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
              <Form layout="vertical">
                <Form.Item label="导入内容">
                  <Input.TextArea rows={5} value={importBody} onChange={(event) => { setImportBody(event.target.value); setImportReport(null) }}
                    placeholder={'source_column,target_element_code,transform,transform_param,conclusion\nchannel_code,channel,VALUE_MAP,"{""OPD"":""OPD""}",CONFIRMED'} />
                  <p className={styles.drawerHint}>支持 CSV（列：source_column, target_element_code, transform, transform_param, conclusion；占位即样例）或 JSON（{'{'}"items":[…]{'}'}）。</p>
                </Form.Item>
              </Form>
              <div className={styles.tableActions}>
                <Button size="small" disabled={!importBody.trim() || busy} onClick={() => run('导入预检', async () => setImportReport(await importMappingItems(version.id, importBody, true)))}><UploadCloud size={14} />预检（dry-run）</Button>
                <Button size="small" type="primary" disabled={!importReport || importReport.problems.length > 0 || busy}
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
              <Form layout="vertical">
                <Form.Item label="元素整体替换">
                  <Input.TextArea rows={4} value={itemsDraft} onChange={(event) => setItemsDraft(event.target.value)}
                    placeholder='[{"sourceColumn":"channel_code","targetElementCode":"channel","transform":"VALUE_MAP","transformParam":"{\"OPD\":\"OPD\"}","conclusion":"CONFIRMED"}]' />
                  <p className={styles.drawerHint}>JSON 数组，整体替换该草稿的映射项并重算 checksum；留空不修改。</p>
                </Form.Item>
              </Form>
              <Button size="small" type="primary" disabled={!itemsDraft.trim() || busy} onClick={() => run('草稿替换', async () => {
                await updateMappingVersion(version.id, { items: JSON.parse(itemsDraft) })
              })}>整体替换并重算 checksum</Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )

}

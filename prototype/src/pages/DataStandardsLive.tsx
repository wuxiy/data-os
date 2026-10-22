import { ArrowRightLeft, Download, FileSearch, GitCompareArrows, RefreshCw, Search, Send, Archive, ShieldCheck, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Form, Input, Select, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
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
import { actorLabel, formatDateTime, sensitivityLabel, standardEventLabel } from '../data/domain'
import { useApiResource } from '../hooks/useApiResource'
import { useAction } from '../hooks/useAction'
import { usePaged } from '../hooks/usePaged'
import type { RouteKey, Tone } from '../types'
import styles from './Pages.module.css'
import local from './DataStandardsPage.module.css'

/**
 * 数据标准中心（G22 真实链路）：标准集合 → 不可变版本 → 评审/发布/停用生命周期，
 * 导入 dry-run 先行，版本对比/影响范围/FHIR 导出；OM 术语投影状态如实展示
 * （SYNC_PENDING 可人工重试）。API 不可用时显示真实不可用态，不回静态样例。
 */

const STATUS_OPTIONS = ['', 'DRAFT', 'IN_REVIEW', 'PUBLISHED', 'DEPRECATED']
const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿', IN_REVIEW: '评审中', PUBLISHED: '已发布', DEPRECATED: '已停用',
}

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR: Record<Tone, string> = {
  healthy: 'success',
  warning: 'warning',
  danger: 'error',
  neutral: 'default',
}

function statusTone(status: string): Tone {
  if (status === 'PUBLISHED' || status === 'ACTIVE') return 'healthy'
  if (status === 'DEPRECATED' || status === 'RETIRED') return 'neutral'
  if (status === 'IN_REVIEW') return 'warning'
  return 'neutral'
}

function severityTone(severity: string): Tone {
  if (severity === 'CRITICAL' || severity === 'SENSITIVE') return 'danger'
  if (severity === 'HIGH') return 'warning'
  return 'neutral'
}

/** 事件 detail 为后端原文透传；OM（OpenMetadata 缩写）属引擎名禁令，渲染时最小改写（同 businessMessage 消毒器先例），后端原文不动。 */
function standardEventDetail(detail: string) {
  return detail.replace(/OM 术语投影/g, '术语投影')
}

export function DataStandardsLive({ onNotice, onNavigate, onUnavailable }: { onNotice: (message: string) => void; onNavigate: (route: RouteKey) => void; onUnavailable: (label: string) => void }) {
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
  const { pendingKey, error: operationError, run: runOperation } = useAction(onNotice)
  const busy = pendingKey !== null
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
  const version = detail?.standard.id === selectedId && (!detailVersionId || detail.version.id === detailVersionId) ? detail.version : undefined
  const selectedVersionMeta = useMemo(
    () => detail?.versions.find((item) => item.id === version?.id) ?? null,
    [detail, version])

  async function run(label: string, action: () => Promise<unknown>) {
    await runOperation(label, `${label}失败，请稍后重试`, async () => {
      await action()
      setReloadKey((key) => key + 1)
      onNotice(`${label}成功`)
    })
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

  // 标准清单列定义：行可点击选中（键盘可达经 onRow 承载）。
  const listColumns: ColumnsType<StandardListItem> = [
    { title: '代码', key: 'code', render: (_, item) => <span className={styles.inlineCode}>{item.code}</span> },
    { title: '名称', key: 'name', render: (_, item) => item.name },
    { title: '负责人', key: 'owner', render: (_, item) => item.owner || '—' },
    { title: '最新版本', key: 'version', render: (_, item) => `v${item.latestVersion.versionNo} / 共 ${item.versionCount} 版` },
    {
      title: '状态',
      key: 'status',
      render: (_, item) => <Tag color={TONE_COLOR[statusTone(item.latestVersion.status)]}>{STATUS_LABEL[item.latestVersion.status] ?? item.latestVersion.status}</Tag>,
    },
    {
      title: '术语投影',
      key: 'sync',
      render: (_, item) => item.latestVersion.status === 'PUBLISHED'
        ? <Tag color={TONE_COLOR[item.latestVersion.syncStatus === 'SYNCED' ? 'healthy' : 'warning']}>{item.latestVersion.syncStatus === 'SYNCED' ? '已同步' : '待同步'}</Tag>
        : '—',
    },
  ]

  if (listState === 'unavailable') {
    return (
      <div className={styles.page}>
        <PageHeader title="数据标准中心" eyebrow="数据标准" subtitle="标准集合、版本评审与发布" />
        <GovernanceTabs route="standards" onNavigate={onNavigate} onUnavailable={onUnavailable} />
        <div className={styles.content}>
          <section className={`${styles.panel} ${local.unavailablePanel}`} role="alert">
            <div className={styles.panelHeader}><h2>控制面暂不可用</h2></div>
            <p>暂时无法读取标准清单。恢复连接后，可继续查看版本、评审记录与影响范围。</p>
            <Button size="small" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={14} />重试</Button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="数据标准中心" subtitle="维护院级业务定义与值域，通过评审发布可追溯的标准版本" asOf={detail ? formatDateTime(detail.standard.updatedAt) : undefined} />
      <GovernanceTabs route="standards" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <div className={styles.content}>
        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}>
            <div><h2>标准清单</h2><p>{items.length} 项 · 选择标准后查看版本与数据元</p></div>
            <span className={local.processHint}>草稿 → 评审 → 发布</span>
          </div>
        <div className={`${styles.listTools} ${local.toolbar}`}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); paged.setPage(0) }} placeholder="搜索标准代码或名称" aria-label="搜索数据标准" />
          </label>
          <div className={local.filterActions}><Select
            className={local.statusSelect}
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); paged.setPage(0) }}
            aria-label="按最新版本状态筛选"
            options={STATUS_OPTIONS.map((option) => ({ value: option, label: option === '' ? '全部状态' : STATUS_LABEL[option] }))}
          /><Button type="text" size="small" disabled={!query && !statusFilter} onClick={() => { setQuery(''); setStatusFilter(''); paged.setPage(0) }}>清除筛选</Button></div>
        </div>
          <Table<StandardListItem>
            rowKey="id"
            columns={listColumns}
            dataSource={paged.paged}
            loading={listState === 'loading'}
            scroll={{ x: 620 }}
            pagination={{
              current: paged.page + 1,
              pageSize: 8,
              total: items.length,
              showSizeChanger: false,
              onChange: (page) => paged.setPage(page - 1),
            }}
            locale={{
              emptyText: listState === 'loading'
                ? '正在加载标准清单…'
                : listState === 'live'
                  ? query || statusFilter ? '没有匹配的标准，请调整关键词或清除筛选。' : '还没有数据标准，可在下方导入内容，预检通过后创建草稿。'
                  : '',
            }}
            onRow={(item) => ({
              className: `${styles.clickableRow} ${item.id === selectedId ? styles.activeRow : ''}`,
              tabIndex: 0,
              'aria-label': `选择标准 ${item.code} ${item.name}`,
              onClick: () => { setSelectedId(item.id); setDetailVersionId('') },
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedId(item.id)
                  setDetailVersionId('')
                }
              },
            })}
          />
        </section>

        {operationError ? <p className={local.operationError} role="alert">{operationError}</p> : null}
        {selectedId && (!detail || !version) ? <section className={`${styles.panel} ${local.detailState}`} role={detailState === 'unavailable' ? 'alert' : 'status'}>
          {detailState === 'unavailable' ? <><strong>标准详情读取失败</strong><p>标准清单仍可使用。请重试读取所选标准的版本与数据元。</p><Button size="small" onClick={() => setReloadKey((key) => key + 1)} icon={<RefreshCw size={14} />}>重试详情</Button></> : <><strong>正在读取标准详情</strong><Skeleton active paragraph={{ rows: 3 }} /></>}
        </section> : null}

        {detail && version ? (
          <div className={local.detailGrid}>
            <section className={styles.tablePanel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{detail.standard.name}</h2>
                  <p>{detail.standard.code} · {detail.standard.owner || '未指定负责人'}</p>
                </div>
                <div className={styles.panelHeaderActions}>
                  <Button size="small" disabled={busy} onClick={() => run('创建新版本', async () => { await createStandardVersion(detail.standard.id) })}><GitCompareArrows size={14} />基于当前发布版新建草稿</Button>
                </div>
              </div>
              <div className={local.versionContext}><strong>当前查看 v{version.versionNo}</strong><Tag color={TONE_COLOR[statusTone(version.status)]}>{STATUS_LABEL[version.status]}</Tag><span>{version.elements.length} 个数据元 · {version.status === 'DRAFT' ? '修改后提交评审，发布后供资产与映射引用' : version.status === 'IN_REVIEW' ? '评审通过后由管理员发布' : version.status === 'PUBLISHED' ? '已发布版本只读，变更请新建草稿' : '该版本已停用，保留历史追溯'}</span></div>
              <div className={styles.versionChips}>
                {detail.versions.map((item) => (
                  <button
                    key={item.id}
                    className={styles.versionChip}
                    onClick={() => setDetailVersionId(item.id)}
                    aria-pressed={item.id === version.id}
                  >
                    <strong>v{item.versionNo}</strong>
                    <Tag color={TONE_COLOR[statusTone(item.status)]}>{STATUS_LABEL[item.status]}</Tag>
                    <span>{item.syncStatus === 'SYNCED' ? '术语已投影' : item.status === 'PUBLISHED' ? '投影待同步' : ''}</span>
                  </button>
                ))}
              </div>

              <div className={styles.tableActions}>
                {version.status === 'DRAFT' ? (
                  <>
                    <Button size="small" disabled={busy} onClick={() => run('提交评审', () => submitStandardVersion(version.id))}><Send size={14} />提交评审</Button>
                  </>
                ) : null}
                {version.status === 'IN_REVIEW' ? (
                  <Button size="small" disabled={busy} onClick={() => run('发布', () => publishStandardVersion(version.id))}><ShieldCheck size={14} />发布（管理员）</Button>
                ) : null}
                {version.status === 'PUBLISHED' ? (
                  <>
                    <Button size="small" disabled={busy} onClick={() => run('停用', () => deprecateStandardVersion(version.id))}><Archive size={14} />停用</Button>
                    {version.syncStatus !== 'SYNCED' ? (
                      <Button size="small" disabled={busy} onClick={() => run('术语投影重试', () => retryStandardSync(version.id))}><RefreshCw size={14} />重试术语投影</Button>
                    ) : null}
                  </>
                ) : null}
                <Button size="small" disabled={busy} onClick={() => run('影响范围读取', async () => setImpact(await fetchVersionImpact(undefined, version.id)))}><FileSearch size={14} />影响范围</Button>
                <Button size="small" onClick={downloadFhir}><Download size={14} />FHIR 导出</Button>
              </div>

              {version.status === 'DRAFT' ? (
                <div className={styles.drawerForm}>
                  <h3 className={styles.sectionTitle}>草稿修改（仅 DRAFT 可改）</h3>
                  <Form layout="vertical">
                    <div className={styles.drawerFormGrid}>
                      <Form.Item label="标准名称">
                        <Input value={metaDraft.standardName} onChange={(event) => setMetaDraft({ ...metaDraft, standardName: event.target.value })} placeholder={detail.standard.name} />
                      </Form.Item>
                      <Form.Item label="负责人">
                        <Input value={metaDraft.owner} onChange={(event) => setMetaDraft({ ...metaDraft, owner: event.target.value })} placeholder={detail.standard.owner || '未指定'} />
                      </Form.Item>
                    </div>
                    <Form.Item label="描述">
                      <Input value={metaDraft.description} onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })} placeholder={detail.standard.description || '补充标准描述'} />
                    </Form.Item>
                    <Form.Item label="元素集整体替换">
                      <Input.TextArea rows={5} value={elementsDraft} onChange={(event) => setElementsDraft(event.target.value)}
                        placeholder='[{"code":"channel","name":"挂号渠道","dataType":"CODE","required":true,"definition":"渠道枚举","sensitivity":"NORMAL","assetRef":"","values":[{"code":"OPD","displayName":"门诊"}]}]' />
                      <p className={styles.drawerHint}>JSON 数组，与创建接口的元素结构同构；留空则不修改元素集。</p>
                    </Form.Item>
                  </Form>
                  <Button size="small" disabled={busy} onClick={() => run('草稿修改', async () => {
                    const payload: Record<string, unknown> = {}
                    if (metaDraft.standardName.trim()) payload.standardName = metaDraft.standardName.trim()
                    if (metaDraft.description.trim()) payload.description = metaDraft.description.trim()
                    if (metaDraft.owner.trim()) payload.owner = metaDraft.owner.trim()
                    if (elementsDraft.trim()) payload.elements = JSON.parse(elementsDraft)
                    await updateStandardVersion(version.id, payload)
                  })}>保存草稿修改</Button>
                </div>
              ) : null}

              <Table
                rowKey="id"
                columns={[
                  { title: '数据元', key: 'element', render: (_, element: StandardDetailView['version']['elements'][number]) => <><span className={styles.inlineCode}>{element.code}</span><br /><small>{element.name}</small></> },
                  { title: '类型', key: 'dataType', render: (_, element: StandardDetailView['version']['elements'][number]) => element.dataType },
                  { title: '必填', key: 'required', width: 64, render: (_, element: StandardDetailView['version']['elements'][number]) => element.required ? '必填' : '可选' },
                  { title: '敏感级别', key: 'sensitivity', width: 96, render: (_, element: StandardDetailView['version']['elements'][number]) => <Tag color={TONE_COLOR[severityTone(element.sensitivity)]}>{sensitivityLabel(element.sensitivity)}</Tag> },
                  { title: '定义', key: 'definition', render: (_, element: StandardDetailView['version']['elements'][number]) => <small>{element.definition || '—'}</small> },
                  {
                    title: '值域',
                    key: 'values',
                    render: (_, element: StandardDetailView['version']['elements'][number]) => element.dataType === 'CODE'
                      ? element.values.map((value) => <span key={value.code} className={styles.configPill}>{value.code} {value.displayName}</span>)
                      : '—',
                  },
                ]}
                dataSource={version.elements}
                pagination={false}
                locale={{ emptyText: '该版本暂无数据元。' }}
              />

              {impact ? (
                <div className={styles.evidenceBox}>
                  <h3>影响范围（v{impact.versionNo}）</h3>
                  <p>数据元 {impact.elementCount} 个；引用资产 {impact.referencedAssets.length} 项{impact.referencedAssets.length > 0 ? `：${impact.referencedAssets.join('、')}` : ''}。{impact.notes.join('；')}</p>
                </div>
              ) : null}

              <div className={styles.listTools}>
                <label>版本对比：与
                  {/* 目标标准只有一个版本时无可比对象：禁用控件而非留只剩占位项的死下拉（2026-10-07 复评 P1-a）。 */}
                  <Select
                    value={compareWith}
                    onChange={(value) => setCompareWith(value)}
                    aria-label="选择对比版本"
                    disabled={detail.versions.filter((item) => item.id !== version.id).length === 0}
                    options={[
                      { value: '', label: '选择另一版本…' },
                      ...detail.versions.filter((item) => item.id !== version.id).map((item) => ({
                        value: item.id,
                        label: `v${item.versionNo}（${STATUS_LABEL[item.status]}）`,
                      })),
                    ]}
                  />
                </label>
                <Button size="small" disabled={!compareWith || busy} onClick={() => run('版本对比', async () => setCompareResult(await compareStandardVersions(version.id, compareWith)))}><ArrowRightLeft size={14} />对比</Button>
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

            <aside className={`${styles.panel} ${local.auditRail}`}>
              <div className={styles.panelHeader}><div><h2>审计事件</h2><p>当前标准 · 最近 20 条</p></div></div>
              <ul className={styles.timelineBody}>
                {detail.events.map((event) => (
                  <li key={event.id}>
                    <div className={styles.timelineTitle}><strong>{standardEventLabel(event.eventType)}</strong><span>{actorLabel(event.actor)}</span></div>
                    <p>{standardEventDetail(event.detail)}</p>
                    <small>{formatDateTime(event.createdAt)}</small>
                  </li>
                ))}
                {detail.events.length === 0 ? <li className={styles.emptyState}>暂无事件。</li> : null}
              </ul>
              {detailState === 'loading' ? <p className={styles.emptyState}>正在加载详情…</p> : null}
              {selectedVersionMeta ? <p className={styles.emptyState}>当前查看 v{selectedVersionMeta.versionNo} · {STATUS_LABEL[selectedVersionMeta.status]}</p> : null}
            </aside>
          </div>
        ) : null}

        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}>
            <div><h2>导入标准</h2><p>粘贴 CSV 或 JSON → 预检内容 → 确认创建草稿</p></div>
          </div>
          <div className={styles.drawerForm}>
            <Form layout="vertical">
              <Form.Item label="导入内容">
                <Input.TextArea rows={5} value={importBody} onChange={(event) => { setImportBody(event.target.value); setImportReport(null) }}
                  placeholder={'standard_code,standard_name,element_code,element_name,data_type,required,definition,sensitivity,value_code,value_display\nreg-channel,挂号渠道,channel,挂号渠道,CODE,true,渠道枚举,NORMAL,OPD,门诊'} />
                <p className={styles.drawerHint}>支持平台 CSV 模板（列：standard_code, standard_name, element_code, element_name, data_type, required, definition, sensitivity, value_code, value_display；占位即样例）或与创建接口同构的 JSON。</p>
              </Form.Item>
            </Form>
            <div className={styles.tableActions}>
              <Button size="small" disabled={!importBody.trim() || busy} onClick={() => run('导入预检', async () => setImportReport(await importStandards(importBody, true)))}><UploadCloud size={14} />预检（dry-run）</Button>
              <Button size="small" type="primary" disabled={!importReport || importReport.dryRun === false || importReport.problems.length > 0 || busy}
                onClick={() => run('导入落库', async () => setImportReport(await importStandards(importBody, false)))}>确认导入</Button>
            </div>
            {importReport ? (
              <div className={styles.evidenceBox}>
                <h3>{importReport.created ? '导入结果' : '预检报告'} · {importReport.standardCode || '（空代码）'}</h3>
                <p>数据元 {importReport.elementCount} 个 · 值域 {importReport.valueCount} 条 · 问题 {importReport.problems.length} 项</p>
                {importReport.problems.length > 0 ? (
                  <ul className={styles.checkList}>{importReport.problems.map((problem) => <li key={problem} className={styles.textWarning}>{problem}</li>)}</ul>
                ) : <p className={styles.textHealthy}>{importReport.created ? '导入已完成，可在标准清单中继续维护草稿。' : '校验通过，可确认导入。'}</p>}
                {importReport.created ? <p>已创建：{importReport.created.standard.code}（草稿 v{importReport.created.version.versionNo}）</p> : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

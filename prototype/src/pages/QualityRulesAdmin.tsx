import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ConfirmDrawer } from '../components/ui/ConfirmDrawer'
import { Drawer } from '../components/ui/Drawer'
import { StatusTag } from '../components/ui/Primitives'
import {
  deleteQualityRule,
  fetchQualityRuleTypes,
  fetchQualityRules,
  saveQualityRule,
  setQualityRuleEnabled,
  type QualityEvidenceColumn,
  type QualityRuleDefinitionApiItem,
  type QualityRuleType,
  type QualityRuleTypeView,
} from '../data/controlPlane'
import { formatDateTime } from '../data/domain'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import { fetchLineageAsset, fetchLineageCatalog, fetchLineageSummary } from '../data/lineageApi'
import { fetchStandardDetail, fetchStandards } from '../data/standardsApi'
import styles from './Pages.module.css'
import local from './QualityRulesAdmin.module.css'

interface Props {
  onNotice: (message: string) => void
}

const PARAM_LABELS: Record<QualityRuleType, string> = {
  NOT_NULL: '非空校验', UNIQUE: '唯一性校验', FK_REF: '外键参照校验',
  VAL_SET: '值域校验', VAL_MINMAX: '数值范围校验', VAL_LEN: '长度范围校验',
  STR_REGEX: '正则校验', SQL: '自定义 SQL 校验',
  CROSS_VAL_COMPARE: '跨表数据值比较', STAT_VAL_COMPARE: '统计数据值比较',
  SQL_STAT_VAL: 'SQL 统计值比较', DETAIL_STAT: '明细汇总校验',
  FIELD_LOGIC: '字段间关系', UPDATE_TIME: '更新时效校验', TIME_CONTINUITY: '时间连续性校验',
}

/** 失败列由执行器编译派生的类型：表单隐藏证据白名单编辑。 */
const COMPUTED_EVIDENCE_TYPES: Set<QualityRuleType> = new Set([
  'STAT_VAL_COMPARE', 'SQL_STAT_VAL', 'DETAIL_STAT', 'TIME_CONTINUITY',
])

const STAT_OPS = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'] as const
const TIME_UNITS = ['SECOND', 'MINUTE', 'HOUR', 'DAY'] as const

/** 编辑态的参数承载：值集/关联键以逗号分隔文本编辑，保存时解析。 */
interface RuleFormState {
  ruleId: string
  ruleType: QualityRuleType
  datasetId: string
  targetColumn: string
  checkBlank: boolean
  valuesText: string
  standardElementId: string
  minVal: string
  maxVal: string
  minLen: string
  maxLen: string
  regex: string
  refDataset: string
  refColumn: string
  targetJoinCols: string
  refJoinCols: string
  statOp: string
  refStatOp: string
  checkSql: string
  refSql: string
  customSql: string
  logic: string
  ingestColumn: string
  threshold: string
  timeUnit: string
  evidenceColumns: QualityEvidenceColumn[]
}

function newForm(): RuleFormState {
  return {
    ruleId: '', ruleType: 'NOT_NULL', datasetId: '', targetColumn: '',
    checkBlank: false, valuesText: '', standardElementId: '', minVal: '', maxVal: '',
    minLen: '', maxLen: '', regex: '', refDataset: '', refColumn: '',
    targetJoinCols: '', refJoinCols: '', statOp: 'COUNT', refStatOp: 'COUNT',
    checkSql: '', refSql: '', customSql: '', logic: '', ingestColumn: '',
    threshold: '', timeUnit: 'HOUR',
    evidenceColumns: [{ name: '', classification: 'REDACTED' }],
  }
}

function formFromRule(rule: QualityRuleDefinitionApiItem): RuleFormState {
  const params = rule.params ?? {}
  const values = Array.isArray(params.values) ? params.values.map(String).join(',') : ''
  const joinText = (value: unknown) => Array.isArray(value) ? value.join(',') : ''
  return {
    ruleId: rule.ruleId,
    ruleType: rule.ruleType,
    datasetId: rule.datasetId,
    targetColumn: rule.targetColumn,
    checkBlank: params.checkBlank === true,
    valuesText: values,
    standardElementId: typeof params.standardElementId === 'string' ? params.standardElementId : '',
    minVal: params.minVal == null ? '' : String(params.minVal),
    maxVal: params.maxVal == null ? '' : String(params.maxVal),
    minLen: params.minLen == null ? '' : String(params.minLen),
    maxLen: params.maxLen == null ? '' : String(params.maxLen),
    regex: typeof params.regex === 'string' ? params.regex : '',
    refDataset: typeof params.refDataset === 'string' ? params.refDataset : '',
    refColumn: typeof params.refColumn === 'string' ? params.refColumn : '',
    targetJoinCols: joinText(params.targetJoinCols),
    refJoinCols: joinText(params.refJoinCols),
    statOp: typeof params.op === 'string' ? params.op : 'COUNT',
    refStatOp: typeof params.refOp === 'string' ? params.refOp : 'COUNT',
    checkSql: typeof params.checkSql === 'string' ? params.checkSql : '',
    refSql: typeof params.refSql === 'string' ? params.refSql : '',
    customSql: typeof params.sql === 'string' ? params.sql : '',
    logic: typeof params.logic === 'string' ? params.logic : '',
    ingestColumn: typeof params.ingestColumn === 'string' ? params.ingestColumn : '',
    threshold: params.threshold == null ? '' : String(params.threshold),
    timeUnit: typeof params.timeUnit === 'string' ? params.timeUnit : 'HOUR',
    evidenceColumns: rule.evidenceColumns.length > 0 ? rule.evidenceColumns : [{ name: '', classification: 'REDACTED' }],
  }
}

/**
 * 动态质量规则管理面（G2G 批次 2 首刀）：规则定义台账 + 推送质量执行器编译。
 * 保存即推送——执行器对目标表列做实校验，失败原因如实回显。
 */
export function QualityRulesAdmin({ onNotice }: Props) {
  const [rules, setRules] = useState<QualityRuleDefinitionApiItem[]>([])
  const [types, setTypes] = useState<QualityRuleTypeView[]>([])
  const [editing, setEditing] = useState<QualityRuleDefinitionApiItem | null>(null)
  const [form, setForm] = useState<RuleFormState>(newForm())
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // 删除确认（2026-10-05 复评 P1）：删除不可逆且会同步摘除执行器里的规则，
  // 必须显式确认；不再从表格行直接调 API。
  const [pendingDelete, setPendingDelete] = useState<QualityRuleDefinitionApiItem | null>(null)
  const { pendingKey, run } = useAction(onNotice)
  const saving = pendingKey === 'save-rule'

  const apiState = useApiResource({
    load: (signal) => fetchQualityRules(signal),
    onData: (response) => setRules(response.items),
    onUnavailable: () => setRules([]),
  })
  useApiResource({
    load: (signal) => fetchQualityRuleTypes(signal),
    onData: (response) => setTypes(response),
    onUnavailable: () => setTypes([]),
  })

  const dimensionOf = (type: QualityRuleType) =>
    types.find((item) => item.type === type)?.dimension ?? ''

  // 资产选择器（2026-10-05 复评）：目标/参照「库.表」从 OM 资产目录出选项，
  // 命中资产时带出列建议；值域校验的标准数据元从已发布标准出选项。
  // 目录/标准不可达时静默降级为手输——不阻断建规则。
  interface DatasetOption { value: string; fqn: string; label: string }
  const [datasetOptions, setDatasetOptions] = useState<DatasetOption[]>([])
  const [elementOptions, setElementOptions] = useState<{ id: string; label: string }[]>([])
  const [columnOptions, setColumnOptions] = useState<string[]>([])
  const columnCacheRef = useRef(new Map<string, string[]>())

  useEffect(() => {
    if (!formOpen || datasetOptions.length > 0) return
    const controller = new AbortController()
    fetchLineageSummary(controller.signal).then(async (summary) => {
      const catalogs = await Promise.allSettled(summary.schemas.slice(0, 6).map((schema) => fetchLineageCatalog(schema, controller.signal)))
      const options: DatasetOption[] = []
      for (const result of catalogs) {
        if (result.status !== 'fulfilled') continue
        for (const asset of result.value.assets) {
          const value = `${result.value.schema}.${asset.name}`
          if (!options.some((option) => option.value === value)) options.push({ value, fqn: asset.fullyQualifiedName, label: asset.displayName })
        }
      }
      setDatasetOptions(options)
    }).catch(() => { /* 目录不可达：保留手输 */ })
    fetchStandards(controller.signal, '', 'PUBLISHED').then(async (standards) => {
      const elements: { id: string; label: string }[] = []
      for (const standard of standards.slice(0, 8)) {
        try {
          const detail = await fetchStandardDetail(controller.signal, standard.id)
          for (const element of detail.version.elements) {
            if (element.dataType === 'CODE') elements.push({ id: element.id, label: `${standard.code} · ${element.code} ${element.name}` })
          }
        } catch { /* 单个标准失败不阻断 */ }
      }
      setElementOptions(elements)
    }).catch(() => { /* 标准不可达：保留手输 */ })
    return () => controller.abort()
  }, [formOpen, datasetOptions.length])

  function updateDataset(value: string) {
    update({ datasetId: value })
    const option = datasetOptions.find((item) => item.value === value.trim())
    if (!option) {
      setColumnOptions([])
      return
    }
    const cached = columnCacheRef.current.get(option.fqn)
    if (cached) {
      setColumnOptions(cached)
      return
    }
    fetchLineageAsset(option.fqn).then((detail) => {
      const names = detail.columns.map((column) => column.name)
      columnCacheRef.current.set(option.fqn, names)
      setColumnOptions(names)
    }).catch(() => setColumnOptions([]))
  }

  function openCreate() {
    setEditing(null)
    setForm(newForm())
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(rule: QualityRuleDefinitionApiItem) {
    setEditing(rule)
    setForm(formFromRule(rule))
    setFormError(null)
    setFormOpen(true)
  }

  function buildParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    const joinCols = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean)
    if (form.ruleType === 'NOT_NULL' && form.checkBlank) params.checkBlank = true
    if (form.ruleType === 'VAL_SET') {
      if (form.standardElementId.trim()) {
        params.standardElementId = form.standardElementId.trim()
      } else {
        params.values = form.valuesText.split(',').map((item) => item.trim())
          .filter(Boolean).map((item) => (/^-?\d+(\.\d+)?$/.test(item) ? Number(item) : item))
      }
    }
    if (form.ruleType === 'VAL_MINMAX') {
      if (form.minVal.trim()) params.minVal = Number(form.minVal)
      if (form.maxVal.trim()) params.maxVal = Number(form.maxVal)
    }
    if (form.ruleType === 'VAL_LEN') {
      if (form.minLen.trim()) params.minLen = Number(form.minLen)
      if (form.maxLen.trim()) params.maxLen = Number(form.maxLen)
    }
    if (form.ruleType === 'STR_REGEX') params.regex = form.regex
    if (form.ruleType === 'FK_REF') {
      params.refDataset = form.refDataset
      params.refColumn = form.refColumn
    }
    if (form.ruleType === 'SQL') params.sql = form.customSql
    if (form.ruleType === 'CROSS_VAL_COMPARE') {
      params.refDataset = form.refDataset
      params.refColumn = form.refColumn
      params.targetJoinCols = joinCols(form.targetJoinCols)
      params.refJoinCols = joinCols(form.refJoinCols)
    }
    if (form.ruleType === 'STAT_VAL_COMPARE') {
      params.op = form.statOp
      params.refOp = form.refStatOp
      params.refDataset = form.refDataset
      if (form.refColumn.trim()) params.refColumn = form.refColumn.trim()
    }
    if (form.ruleType === 'SQL_STAT_VAL') {
      params.checkSql = form.checkSql
      params.refSql = form.refSql
    }
    if (form.ruleType === 'DETAIL_STAT') {
      params.refOp = form.refStatOp
      params.refDataset = form.refDataset
      params.refColumn = form.refColumn
      params.targetJoinCols = joinCols(form.targetJoinCols)
      params.refJoinCols = joinCols(form.refJoinCols)
    }
    if (form.ruleType === 'FIELD_LOGIC') params.logic = form.logic
    if (form.ruleType === 'UPDATE_TIME') {
      params.ingestColumn = form.ingestColumn
      params.threshold = Number(form.threshold)
      params.timeUnit = form.timeUnit
    }
    return params
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const ruleId = form.ruleId.trim()
    if (!ruleId) {
      setFormError('请填写规则编号（小写字母数字与 ._-）')
      return
    }
    const computed = COMPUTED_EVIDENCE_TYPES.has(form.ruleType)
    const evidenceColumns = computed ? [] : form.evidenceColumns
      .map((column) => ({ name: column.name.trim(), classification: column.classification }))
      .filter((column) => column.name)
    if (!computed && evidenceColumns.length === 0) {
      setFormError('至少配置一个证据列（失败样本展示白名单）')
      return
    }
    void run('save-rule', '质量规则保存失败，请稍后重试', async () => {
      const saved = await saveQualityRule(ruleId, {
        ruleType: form.ruleType,
        datasetId: form.datasetId.trim(),
        targetColumn: form.ruleType === 'SQL' || form.ruleType === 'SQL_STAT_VAL' ? '' : form.targetColumn.trim(),
        params: buildParams(),
        evidenceColumns,
      })
      setRules((current) => {
        const next = current.filter((item) => item.ruleId !== saved.ruleId)
        return [saved, ...next]
      })
      setFormOpen(false)
      onNotice(`质量规则已保存并推送执行器：${saved.ruleId}`)
    }, (message) => setFormError(message))
  }

  function toggleEnabled(rule: QualityRuleDefinitionApiItem) {
    void run(`toggle-${rule.ruleId}`, '规则状态更新失败，请稍后重试', async () => {
      const updated = await setQualityRuleEnabled(rule.ruleId, !rule.enabled)
      setRules((current) => current.map((item) => item.ruleId === updated.ruleId ? updated : item))
      onNotice(updated.enabled ? `规则已启用：${updated.ruleId}` : `规则已停用：${updated.ruleId}`)
    })
  }

  function removeRule(rule: QualityRuleDefinitionApiItem) {
    void run(`delete-${rule.ruleId}`, '规则删除失败，请稍后重试', async () => {
      await deleteQualityRule(rule.ruleId)
      setRules((current) => current.filter((item) => item.ruleId !== rule.ruleId))
      setPendingDelete(null)
      onNotice(`质量规则已删除：${rule.ruleId}`)
    })
  }

  const update = (patch: Partial<RuleFormState>) => setForm((current) => ({ ...current, ...patch }))
  const needsColumn = form.ruleType !== 'SQL' && form.ruleType !== 'SQL_STAT_VAL'
  const computedEvidence = COMPUTED_EVIDENCE_TYPES.has(form.ruleType)

  return (
    <section className={styles.tablePanel}>
      <div className={styles.panelHeader}>
        <div><h2>质量规则（动态）</h2><p>面向业务库表配置规则；保存即由质量执行器编译生效，复检链自动可用</p></div>
        <div className={styles.panelHeaderActions}>
          <span className={styles.dashboardScope}>{rules.length} 条规则</span>
          {apiState === 'live' ? <button className={styles.primaryButton} onClick={openCreate}><Plus size={14} />新建规则</button> : null}
        </div>
      </div>
      <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th>规则编号</th><th>类型</th><th>维度</th><th>目标</th><th>状态</th><th className={styles.num}>更新时间</th><th>操作</th></tr></thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.ruleId}>
              <td><strong>{rule.ruleId}</strong></td>
              <td>{PARAM_LABELS[rule.ruleType] ?? rule.ruleType}</td>
              <td>{dimensionOf(rule.ruleType)}</td>
              <td><code className={styles.inlineCode}>{rule.datasetId}</code>{rule.targetColumn ? ` · ${rule.targetColumn}` : ''}</td>
              <td><StatusTag tone={rule.enabled ? 'healthy' : 'neutral'}>{rule.enabled ? '启用中' : '已停用'}</StatusTag></td>
              <td className={styles.num}>{formatDateTime(rule.updatedAt)}</td>
              <td><div className={styles.tableActions}>
                <button className={styles.tableButton} onClick={() => openEdit(rule)}>编辑</button>
                <button className={styles.tableButton} disabled={pendingKey !== null} onClick={() => toggleEnabled(rule)}>{rule.enabled ? '停用' : '启用'}</button>
                <button className={`${styles.tableButton} ${local.dangerAction}`} disabled={pendingKey !== null} onClick={() => setPendingDelete(rule)}><Trash2 size={13} />删除</button>
              </div></td>
            </tr>
          ))}
          {apiState === 'live' && rules.length === 0 ? <tr><td colSpan={7} className={styles.emptyState}>暂无动态规则；新建后经质量执行器编译即可参与复检。</td></tr> : null}
          {apiState === 'unavailable' ? <tr><td colSpan={7} className={styles.emptyState}>质量规则控制面暂不可用。</td></tr> : null}
        </tbody>
      </table></div>

      {formOpen ? <Drawer
        titleId="quality-rule-form-title"
        eyebrow={editing ? '质量规则编辑' : '质量规则新建'}
        title={editing ? editing.ruleId : '新建动态规则'}
        closeLabel="关闭质量规则表单"
        onClose={() => setFormOpen(false)}
        footer={<><button className={styles.secondaryButton} type="button" onClick={() => setFormOpen(false)}>取消</button><button className={styles.primaryButton} type="submit" form="quality-rule-form" disabled={saving}><Save size={14} />{saving ? '保存中…' : '保存并推送'}</button></>}
      >
        <form id="quality-rule-form" className={styles.drawerForm} onSubmit={(event) => submit(event)}>
          <div className={styles.drawerNotice}><ShieldCheck size={16} /><span>规则语义由质量规则执行器编译校验：标识符与 SQL 只读约束在保存时实校验，失败原因会如实返回。证据列是失败样本的展示白名单与脱敏策略。</span></div>
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="rule-id">规则编号</label><input id="rule-id" value={form.ruleId} disabled={editing !== null} onChange={(event) => update({ ruleId: event.target.value })} placeholder="例如：quality.ep.order.paystatus-range" /></div>
            <div className={styles.formField}><label htmlFor="rule-type">规则类型</label><select id="rule-type" value={form.ruleType} onChange={(event) => update({ ruleType: event.target.value as QualityRuleType })}>{(types.length > 0 ? types : Object.entries(PARAM_LABELS).map(([type, label]) => ({ type, label, dimension: '' }))).map((item) => <option key={item.type} value={item.type}>{item.label}（{item.type}）</option>)}</select></div>
          </div>
          <datalist id="rule-dataset-options">{datasetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>
          <datalist id="rule-column-options">{columnOptions.map((name) => <option key={name} value={name} />)}</datalist>
          <datalist id="rule-standard-options">{elementOptions.map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}</datalist>
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="rule-dataset">目标「库.表」（可从资产目录选择）</label><input id="rule-dataset" list="rule-dataset-options" value={form.datasetId} onChange={(event) => updateDataset(event.target.value)} placeholder="例如：ods_ep.ep_order" /></div>
            <div className={styles.formField}><label htmlFor="rule-column">目标列{needsColumn ? (form.ruleType === 'UPDATE_TIME' ? '（业务时间列）' : '') : '（本类型无需）'}</label><input id="rule-column" list={columnOptions.length > 0 ? 'rule-column-options' : undefined} value={form.targetColumn} disabled={!needsColumn} onChange={(event) => update({ targetColumn: event.target.value })} placeholder="例如：PAY_STATUS" /></div>
          </div>
          {form.ruleType === 'NOT_NULL' ? (
            <div className={styles.formField}><label className={styles.structuredColumnOption}><input type="checkbox" checked={form.checkBlank} onChange={(event) => update({ checkBlank: event.target.checked })} /><span>空字符串也算失败（checkBlank）</span></label></div>
          ) : null}
          {form.ruleType === 'VAL_SET' ? (
            <>
              <div className={styles.formField}><label htmlFor="rule-values">值域集合（逗号分隔，数字自动识别）</label><input id="rule-values" value={form.valuesText} onChange={(event) => update({ valuesText: event.target.value })} placeholder="例如：0,1,PAID" /></div>
              <div className={styles.formField}><label htmlFor="rule-standard">或引用标准中心值域（从已发布标准数据元中选择，保存时解析快照）</label><input id="rule-standard" list={elementOptions.length > 0 ? 'rule-standard-options' : undefined} value={form.standardElementId} onChange={(event) => update({ standardElementId: event.target.value })} placeholder="标准中心数据元 id；填写后忽略上方手写值集" /></div>
            </>
          ) : null}
          {form.ruleType === 'VAL_MINMAX' ? (
            <div className={styles.drawerFormGrid}>
              <div className={styles.formField}><label htmlFor="rule-min-val">最小值（可空）</label><input id="rule-min-val" value={form.minVal} onChange={(event) => update({ minVal: event.target.value })} placeholder="0" /></div>
              <div className={styles.formField}><label htmlFor="rule-max-val">最大值（可空）</label><input id="rule-max-val" value={form.maxVal} onChange={(event) => update({ maxVal: event.target.value })} placeholder="9" /></div>
            </div>
          ) : null}
          {form.ruleType === 'VAL_LEN' ? (
            <div className={styles.drawerFormGrid}>
              <div className={styles.formField}><label htmlFor="rule-min-len">最小长度（可空）</label><input id="rule-min-len" value={form.minLen} onChange={(event) => update({ minLen: event.target.value })} placeholder="1" /></div>
              <div className={styles.formField}><label htmlFor="rule-max-len">最大长度（可空）</label><input id="rule-max-len" value={form.maxLen} onChange={(event) => update({ maxLen: event.target.value })} placeholder="64" /></div>
            </div>
          ) : null}
          {form.ruleType === 'STR_REGEX' ? (
            <div className={styles.formField}><label htmlFor="rule-regex">正则表达式（NULL 不算失败）</label><input id="rule-regex" value={form.regex} onChange={(event) => update({ regex: event.target.value })} placeholder="例如：^[0-9]+$" /></div>
          ) : null}
          {form.ruleType === 'FK_REF' ? (
            <div className={styles.drawerFormGrid}>
              <div className={styles.formField}><label htmlFor="rule-ref-dataset">参照「库.表」</label><input id="rule-ref-dataset" list="rule-dataset-options" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.ep_dict" /></div>
              <div className={styles.formField}><label htmlFor="rule-ref-column">参照列</label><input id="rule-ref-column" list="rule-column-options" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder="例如：CODE" /></div>
            </div>
          ) : null}
          {form.ruleType === 'SQL' ? (
            <div className={styles.formField}><label htmlFor="rule-sql">校验 SQL（单条只读 SELECT，返回失败行）</label><textarea id="rule-sql" className={`${styles.codeInput} ${styles.codeInputLarge}`} value={form.customSql} onChange={(event) => update({ customSql: event.target.value })} spellCheck={false} placeholder="SELECT ID FROM ods_ep.ep_order WHERE PAY_STATUS IS NULL" /></div>
          ) : null}
          {form.ruleType === 'CROSS_VAL_COMPARE' || form.ruleType === 'DETAIL_STAT' ? (
            <>
              <div className={styles.drawerFormGrid}>
                <div className={styles.formField}><label htmlFor="rule-ref-dataset">参照「库.表」</label><input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.patient" /></div>
                <div className={styles.formField}><label htmlFor="rule-ref-column">参照值列</label><input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder={form.ruleType === 'CROSS_VAL_COMPARE' ? '例如：NAME' : '明细值列，例如 PAY'} /></div>
              </div>
              <div className={styles.drawerFormGrid}>
                <div className={styles.formField}><label htmlFor="rule-target-joins">目标表关联键（逗号分隔）</label><input id="rule-target-joins" value={form.targetJoinCols} onChange={(event) => update({ targetJoinCols: event.target.value })} placeholder="例如：PATIENT_ID" /></div>
                <div className={styles.formField}><label htmlFor="rule-ref-joins">参照表关联键（逗号分隔，与左侧一一对应）</label><input id="rule-ref-joins" value={form.refJoinCols} onChange={(event) => update({ refJoinCols: event.target.value })} placeholder="例如：PID" /></div>
              </div>
            </>
          ) : null}
          {form.ruleType === 'STAT_VAL_COMPARE' ? (
            <>
              <div className={styles.drawerFormGrid}>
                <div className={styles.formField}><label htmlFor="rule-stat-op">检查表统计函数</label><select id="rule-stat-op" value={form.statOp} onChange={(event) => update({ statOp: event.target.value })}>{STAT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}</select></div>
                <div className={styles.formField}><label htmlFor="rule-ref-stat-op">参照表统计函数</label><select id="rule-ref-stat-op" value={form.refStatOp} onChange={(event) => update({ refStatOp: event.target.value })}>{STAT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}</select></div>
              </div>
              <div className={styles.drawerFormGrid}>
                <div className={styles.formField}><label htmlFor="rule-ref-dataset">参照「库.表」</label><input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.ep_order_history" /></div>
                <div className={styles.formField}><label htmlFor="rule-ref-column">参照值列（COUNT 可空）</label><input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder="例如：AMOUNT" /></div>
              </div>
            </>
          ) : null}
          {form.ruleType === 'SQL_STAT_VAL' ? (
            <>
              <div className={styles.formField}><label htmlFor="rule-check-sql">检查值 SQL（单条只读，返回单个统计值）</label><textarea id="rule-check-sql" className={styles.codeInput} value={form.checkSql} onChange={(event) => update({ checkSql: event.target.value })} spellCheck={false} placeholder="SELECT COUNT(*) FROM ods_ep.ep_order" /></div>
              <div className={styles.formField}><label htmlFor="rule-ref-sql">参照值 SQL（单条只读，返回单个统计值）</label><textarea id="rule-ref-sql" className={styles.codeInput} value={form.refSql} onChange={(event) => update({ refSql: event.target.value })} spellCheck={false} placeholder="SELECT COUNT(*) FROM ods_ep.ep_order_history" /></div>
            </>
          ) : null}
          {form.ruleType === 'DETAIL_STAT' ? (
            <div className={styles.formField}><label htmlFor="rule-detail-op">明细表统计函数</label><select id="rule-detail-op" value={form.refStatOp} onChange={(event) => update({ refStatOp: event.target.value })}>{STAT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}</select></div>
          ) : null}
          {form.ruleType === 'FIELD_LOGIC' ? (
            <div className={styles.formField}><label htmlFor="rule-logic">字段间逻辑表达式（列名与比较符，例：AMOUNT &gt; 0 AND PAY_STATUS = 'PAID'）</label><input id="rule-logic" value={form.logic} onChange={(event) => update({ logic: event.target.value })} placeholder="AMOUNT > 0 AND PAY_STATUS = 'PAID'" /></div>
          ) : null}
          {form.ruleType === 'UPDATE_TIME' ? (
            <>
              <div className={styles.drawerFormGrid}>
                <div className={styles.formField}><label htmlFor="rule-ingest">入库时间列</label><input id="rule-ingest" value={form.ingestColumn} onChange={(event) => update({ ingestColumn: event.target.value })} placeholder="例如：ETL_TIME" /></div>
                <div className={styles.formField}><label htmlFor="rule-threshold">时效阈值（业务时间 → 入库时间）</label><input id="rule-threshold" type="number" min={0} value={form.threshold} onChange={(event) => update({ threshold: event.target.value })} placeholder="2" /></div>
              </div>
              <div className={styles.formField}><label htmlFor="rule-time-unit">阈值单位</label><select id="rule-time-unit" value={form.timeUnit} onChange={(event) => update({ timeUnit: event.target.value })}>{TIME_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div>
            </>
          ) : null}
          {form.ruleType === 'TIME_CONTINUITY' ? (
            <p className={styles.drawerHint}>时间连续性检查目标列的全历史断档（相邻两期间隔 &gt; 1 天即失败行），失败列为（上一期, 本期）。目标列须为 DATE/DATETIME。</p>
          ) : null}
          {!computedEvidence ? (
          <div className={styles.formField}>
            <label>证据列白名单（失败样本展示 + 脱敏分类）</label>
            {form.evidenceColumns.map((column, index) => (
              <div key={index} className={styles.drawerFormGrid}>
                <input value={column.name} aria-label={`证据列 ${index + 1} 名称`} onChange={(event) => {
                  const next = [...form.evidenceColumns]
                  next[index] = { ...column, name: event.target.value }
                  update({ evidenceColumns: next })
                }} placeholder="列名，例如 ID" />
                <select value={column.classification} aria-label={`证据列 ${index + 1} 脱敏分类`} onChange={(event) => {
                  const next = [...form.evidenceColumns]
                  next[index] = { ...column, classification: event.target.value as QualityEvidenceColumn['classification'] }
                  update({ evidenceColumns: next })
                }}>
                  <option value="IDENTIFIER">IDENTIFIER（哈希脱敏）</option>
                  <option value="CATEGORY">CATEGORY（类别值直显）</option>
                  <option value="SAFE">SAFE（安全直显）</option>
                  <option value="REDACTED">REDACTED（完全遮蔽）</option>
                </select>
              </div>
            ))}
            <button type="button" className={styles.textButton} onClick={() => update({ evidenceColumns: [...form.evidenceColumns, { name: '', classification: 'REDACTED' }] })}><Plus size={13} />添加证据列</button>
          </div>
          ) : (
            <p className={styles.drawerHint}>本类型的失败列由执行器编译派生（如 check_value/ref_value、prev_period/cur_period），无需配置证据白名单。</p>
          )}
          {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
        </form>
      </Drawer> : null}

      {pendingDelete ? <ConfirmDrawer
        titleId="rule-delete-confirm-title"
        eyebrow="质量规则 · 删除确认"
        title={`删除 ${pendingDelete.ruleId}`}
        danger
        confirmLabel={pendingKey === `delete-${pendingDelete.ruleId}` ? '删除中…' : '确认删除'}
        busy={pendingKey !== null}
        onConfirm={() => removeRule(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        body={<><p>规则 <strong>{pendingDelete.ruleId}</strong>（{PARAM_LABELS[pendingDelete.ruleType] ?? pendingDelete.ruleType} · {pendingDelete.datasetId}{pendingDelete.targetColumn ? ` · ${pendingDelete.targetColumn}` : ''}）将被删除，并从质量执行器同步摘除，已产生的治理问题与运行记录保留。</p><p>此操作不可撤销；如需暂停执行请使用「停用」。</p></>}
      /> : null}
    </section>
  )
}

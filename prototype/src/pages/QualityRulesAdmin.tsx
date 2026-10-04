import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
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
import styles from './Pages.module.css'

interface Props {
  onNotice: (message: string) => void
}

const PARAM_LABELS: Record<QualityRuleType, string> = {
  NOT_NULL: '非空校验', UNIQUE: '唯一性校验', FK_REF: '外键参照校验',
  VAL_SET: '值域校验', VAL_MINMAX: '数值范围校验', VAL_LEN: '长度范围校验',
  STR_REGEX: '正则校验', SQL: '自定义 SQL 校验',
}

/** 编辑态的参数承载：值集/枚举以逗号分隔文本编辑，保存时解析。 */
interface RuleFormState {
  ruleId: string
  ruleType: QualityRuleType
  datasetId: string
  targetColumn: string
  checkBlank: boolean
  valuesText: string
  minVal: string
  maxVal: string
  minLen: string
  maxLen: string
  regex: string
  refDataset: string
  refColumn: string
  customSql: string
  evidenceColumns: QualityEvidenceColumn[]
}

function newForm(): RuleFormState {
  return {
    ruleId: '', ruleType: 'NOT_NULL', datasetId: '', targetColumn: '',
    checkBlank: false, valuesText: '', minVal: '', maxVal: '', minLen: '', maxLen: '',
    regex: '', refDataset: '', refColumn: '', customSql: '',
    evidenceColumns: [{ name: '', classification: 'REDACTED' }],
  }
}

function formFromRule(rule: QualityRuleDefinitionApiItem): RuleFormState {
  const params = rule.params ?? {}
  const values = Array.isArray(params.values) ? params.values.map(String).join(',') : ''
  return {
    ruleId: rule.ruleId,
    ruleType: rule.ruleType,
    datasetId: rule.datasetId,
    targetColumn: rule.targetColumn,
    checkBlank: params.checkBlank === true,
    valuesText: values,
    minVal: params.minVal == null ? '' : String(params.minVal),
    maxVal: params.maxVal == null ? '' : String(params.maxVal),
    minLen: params.minLen == null ? '' : String(params.minLen),
    maxLen: params.maxLen == null ? '' : String(params.maxLen),
    regex: typeof params.regex === 'string' ? params.regex : '',
    refDataset: typeof params.refDataset === 'string' ? params.refDataset : '',
    refColumn: typeof params.refColumn === 'string' ? params.refColumn : '',
    customSql: typeof params.sql === 'string' ? params.sql : '',
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
    if (form.ruleType === 'NOT_NULL' && form.checkBlank) params.checkBlank = true
    if (form.ruleType === 'VAL_SET') {
      params.values = form.valuesText.split(',').map((item) => item.trim())
        .filter(Boolean).map((item) => (/^-?\d+(\.\d+)?$/.test(item) ? Number(item) : item))
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
    return params
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const ruleId = form.ruleId.trim()
    if (!ruleId) {
      setFormError('请填写规则编号（小写字母数字与 ._-）')
      return
    }
    const evidenceColumns = form.evidenceColumns
      .map((column) => ({ name: column.name.trim(), classification: column.classification }))
      .filter((column) => column.name)
    if (evidenceColumns.length === 0) {
      setFormError('至少配置一个证据列（失败样本展示白名单）')
      return
    }
    void run('save-rule', '质量规则保存失败，请稍后重试', async () => {
      const saved = await saveQualityRule(ruleId, {
        ruleType: form.ruleType,
        datasetId: form.datasetId.trim(),
        targetColumn: form.ruleType === 'SQL' ? '' : form.targetColumn.trim(),
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
      onNotice(`质量规则已删除：${rule.ruleId}`)
    })
  }

  const update = (patch: Partial<RuleFormState>) => setForm((current) => ({ ...current, ...patch }))
  const needsColumn = form.ruleType !== 'SQL'

  return (
    <section className={styles.tablePanel}>
      <div className={styles.panelHeader}>
        <div><h2>质量规则（动态）</h2><p>面向 Doris 业务库表配置规则；保存即由质量执行器编译生效，复检链自动可用</p></div>
        <div className={styles.panelHeaderActions}>
          <span className={styles.dashboardScope}>{rules.length} 条规则</span>
          {apiState === 'live' ? <button className={styles.primaryButton} onClick={openCreate}><Plus size={14} />新建规则</button> : null}
        </div>
      </div>
      <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th>规则编号</th><th>类型</th><th>维度</th><th>目标</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.ruleId}>
              <td><strong>{rule.ruleId}</strong></td>
              <td>{PARAM_LABELS[rule.ruleType] ?? rule.ruleType}</td>
              <td>{dimensionOf(rule.ruleType)}</td>
              <td><code className={styles.inlineCode}>{rule.datasetId}</code>{rule.targetColumn ? ` · ${rule.targetColumn}` : ''}</td>
              <td><StatusTag tone={rule.enabled ? 'healthy' : 'neutral'}>{rule.enabled ? '启用中' : '已停用'}</StatusTag></td>
              <td>{formatDateTime(rule.updatedAt)}</td>
              <td><div className={styles.tableActions}>
                <button className={styles.tableButton} onClick={() => openEdit(rule)}>编辑</button>
                <button className={styles.tableButton} disabled={pendingKey !== null} onClick={() => toggleEnabled(rule)}>{rule.enabled ? '停用' : '启用'}</button>
                <button className={styles.tableButton} disabled={pendingKey !== null} onClick={() => removeRule(rule)}><Trash2 size={13} />删除</button>
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
          <div className={styles.drawerNotice}><ShieldCheck size={16} /><span>规则语义由质量执行器编译（dbt 测试）：标识符与 SQL 只读约束在保存时实校验，失败原因会如实返回。证据列是失败样本的展示白名单与脱敏策略。</span></div>
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="rule-id">规则编号</label><input id="rule-id" value={form.ruleId} disabled={editing !== null} onChange={(event) => update({ ruleId: event.target.value })} placeholder="例如：quality.ep.order.paystatus-range" /></div>
            <div className={styles.formField}><label htmlFor="rule-type">规则类型</label><select id="rule-type" value={form.ruleType} onChange={(event) => update({ ruleType: event.target.value as QualityRuleType })}>{(types.length > 0 ? types : Object.entries(PARAM_LABELS).map(([type, label]) => ({ type, label, dimension: '' }))).map((item) => <option key={item.type} value={item.type}>{item.label}（{item.type}）</option>)}</select></div>
          </div>
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}><label htmlFor="rule-dataset">目标「库.表」</label><input id="rule-dataset" value={form.datasetId} onChange={(event) => update({ datasetId: event.target.value })} placeholder="例如：ods_ep.ep_order" /></div>
            <div className={styles.formField}><label htmlFor="rule-column">目标列{needsColumn ? '' : '（SQL 类型无需）'}</label><input id="rule-column" value={form.targetColumn} disabled={!needsColumn} onChange={(event) => update({ targetColumn: event.target.value })} placeholder="例如：PAY_STATUS" /></div>
          </div>
          {form.ruleType === 'NOT_NULL' ? (
            <div className={styles.formField}><label className={styles.structuredColumnOption}><input type="checkbox" checked={form.checkBlank} onChange={(event) => update({ checkBlank: event.target.checked })} /><span>空字符串也算失败（checkBlank）</span></label></div>
          ) : null}
          {form.ruleType === 'VAL_SET' ? (
            <div className={styles.formField}><label htmlFor="rule-values">值域集合（逗号分隔，数字自动识别）</label><input id="rule-values" value={form.valuesText} onChange={(event) => update({ valuesText: event.target.value })} placeholder="例如：0,1,PAID" /></div>
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
              <div className={styles.formField}><label htmlFor="rule-ref-dataset">参照「库.表」</label><input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.ep_dict" /></div>
              <div className={styles.formField}><label htmlFor="rule-ref-column">参照列</label><input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder="例如：CODE" /></div>
            </div>
          ) : null}
          {form.ruleType === 'SQL' ? (
            <div className={styles.formField}><label htmlFor="rule-sql">校验 SQL（单条只读 SELECT，返回失败行）</label><textarea id="rule-sql" className={`${styles.codeInput} ${styles.codeInputLarge}`} value={form.customSql} onChange={(event) => update({ customSql: event.target.value })} spellCheck={false} placeholder="SELECT ID FROM ods_ep.ep_order WHERE PAY_STATUS IS NULL" /></div>
          ) : null}
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
          {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
        </form>
      </Drawer> : null}
    </section>
  )
}

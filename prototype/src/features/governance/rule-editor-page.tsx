import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { FormField, FormGrid, FormNotice } from '../../components/ui/form'
import { CodeTextarea, Input, NativeSelect } from '../../components/ui/input'
import { Dialog, DialogFooter } from '../../components/ui/overlay'
import { Breadcrumb, PageHeading } from '../../components/ui/page-heading'
import { Panel } from '../../components/ui/panel'
import { EmptyState, LoadingBlock } from '../../components/ui/states'
import { useNotice } from '../../components/ui/toast'
import {
  saveQualityRule,
  QUALITY_RULE_TYPE_LABELS,
  type QualityEvidenceColumn,
  type QualityRuleDefinitionApiItem,
  type QualityRuleType,
} from '../../data/controlPlane'
import { usePortalNavigate } from '../../app/navigate'
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  COMPUTED_EVIDENCE_TYPES,
  NEEDS_COLUMN,
  STAT_OPS,
  TIME_UNITS,
  emptyForm,
  formFromRule,
  paramsFromForm,
  validateRuleForm,
  type RuleForm,
} from './rule-form'
import { governanceKeys, qualityRuleTypesQuery, qualityRulesQuery } from './queries'

/**
 * 质量规则编辑（独立工作页）：规则语义由执行器编译校验，门户只收集参数。
 * 证据列是失败样本的展示白名单与脱敏策略；派生失败列的类型不显示该编辑。
 */
export function RuleEditorPage({ ruleId }: { ruleId?: string }) {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const rulesRequest = useQuery(qualityRulesQuery())
  const typesRequest = useQuery(qualityRuleTypesQuery())

  const existing = ruleId ? rulesRequest.data?.items.find((rule) => rule.ruleId === ruleId) : undefined
  const [form, setForm] = useState<RuleForm>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [initialized, setInitialized] = useState(!ruleId)

  useEffect(() => {
    if (!ruleId || !existing || initialized) return
    setForm(formFromRule(existing))
    setInitialized(true)
  }, [existing, initialized, ruleId])

  const mutation = useMutation({
    mutationFn: () => saveQualityRule(form.ruleId.trim(), {
      ruleType: form.ruleType,
      datasetId: form.datasetId.trim(),
      targetColumn: form.targetColumn.trim(),
      params: paramsFromForm(form),
      evidenceColumns: COMPUTED_EVIDENCE_TYPES.has(form.ruleType)
        ? []
        : form.evidenceColumns.filter((column) => column.name.trim()).map((column) => ({ ...column, name: column.name.trim() })),
    }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: governanceKeys.rules() })
      void queryClient.invalidateQueries({ queryKey: governanceKeys.score() })
      notify(`质量规则已保存并推送执行器：${saved.ruleId}`)
      navigate('/governance/quality')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '质量规则保存失败，请检查参数与执行器日志'),
  })

  function submit() {
    const message = validateRuleForm(form)
    if (message) { setError(message); return }
    setError(null)
    mutation.mutate()
  }

  const dirty = initialized && (ruleId
    ? JSON.stringify(form) !== JSON.stringify(existing ? formFromRule(existing) : emptyForm())
    : form.ruleId.trim() !== '' || form.datasetId.trim() !== '')

  if (ruleId && rulesRequest.isPending) return <LoadingBlock>正在读取规则…</LoadingBlock>
  if (ruleId && rulesRequest.isSuccess && !existing) {
    return (
      <Panel>
        <EmptyState
          icon={<Shield />}
          title="质量规则不存在"
          description="该规则可能已被删除，或当前账号没有访问权限。"
          action={<Button onClick={() => navigate('/governance/quality')}>返回质量工作台</Button>}
        />
      </Panel>
    )
  }

  const typeOptions = typesRequest.data?.length
    ? typesRequest.data
    : Object.entries(QUALITY_RULE_TYPE_LABELS).map(([type, label]) => ({ type: type as QualityRuleType, label, dimension: '', computedEvidence: COMPUTED_EVIDENCE_TYPES.has(type as QualityRuleType) }))
  const computedEvidence = COMPUTED_EVIDENCE_TYPES.has(form.ruleType)

  const update = (patch: Partial<RuleForm>) => setForm((current) => ({ ...current, ...patch }))

  return (
    <div>
      <Breadcrumb items={[{ label: '数据治理' }, { label: '数据质量' }, { label: ruleId ? '编辑质量规则' : '新建质量规则' }]} trailing={ruleId ? <span className="font-mono">{ruleId}</span> : null} />
      <PageHeading
        title={ruleId ? '编辑质量规则' : '新建质量规则'}
        description="规则语义由质量规则执行器编译校验：标识符与 SQL 只读约束在保存时实校验，失败原因会如实返回。"
        actions={<Button onClick={() => (dirty ? setDiscardOpen(true) : navigate('/governance/quality'))}>返回</Button>}
      />

      <Panel className="max-w-[880px]">
        <div className="px-6 py-5">
          <FormNotice icon={<Shield />}>
            保存即推送执行器编译；证据列是失败样本的展示白名单与脱敏策略，不决定规则语义。
          </FormNotice>

          <FormGrid>
            <FormField label="规则编号" required htmlFor="rule-id" hint="字母、数字、点、下划线与连字符；编辑时不可修改">
              <Input id="rule-id" value={form.ruleId} disabled={Boolean(ruleId)} onChange={(event) => update({ ruleId: event.target.value })} placeholder="例如：quality.ep.order.paystatus-range" />
            </FormField>
            <FormField label="规则类型" htmlFor="rule-type">
              <NativeSelect id="rule-type" className="min-h-[35px]" value={form.ruleType} onChange={(event) => update({ ruleType: event.target.value as QualityRuleType })}>
                {typeOptions.map((item) => <option key={item.type} value={item.type}>{item.label}（{item.type}）</option>)}
              </NativeSelect>
            </FormField>
          </FormGrid>

          <FormGrid>
            <FormField label="目标「库.表」" required htmlFor="rule-dataset">
              <Input id="rule-dataset" value={form.datasetId} onChange={(event) => update({ datasetId: event.target.value })} placeholder="例如：ods_ep.ep_order" />
            </FormField>
            <FormField
              label={NEEDS_COLUMN.has(form.ruleType) ? (form.ruleType === 'UPDATE_TIME' ? '目标列（业务时间列）' : '目标列') : '目标列（本类型无需）'}
              htmlFor="rule-column"
            >
              <Input id="rule-column" value={form.targetColumn} disabled={!NEEDS_COLUMN.has(form.ruleType)} onChange={(event) => update({ targetColumn: event.target.value })} placeholder="例如：PAY_STATUS" />
            </FormField>
          </FormGrid>

          {form.ruleType === 'NOT_NULL' ? (
            <label className="mb-4 flex items-center gap-2 text-body-sm text-[#566173]">
              <input type="checkbox" className="size-[13px] accent-blue" checked={form.checkBlank} onChange={(event) => update({ checkBlank: event.target.checked })} />
              空字符串也算失败（checkBlank）
            </label>
          ) : null}

          {form.ruleType === 'VAL_SET' ? (
            <>
              <FormField label="值域集合（逗号分隔，数字自动识别）" htmlFor="rule-values">
                <Input id="rule-values" value={form.valuesText} onChange={(event) => update({ valuesText: event.target.value })} placeholder="例如：0,1,PAID" />
              </FormField>
              <FormField label="或引用标准中心值域" htmlFor="rule-standard" hint="标准中心数据元 id；填写后忽略上方手写值集，保存时解析快照。">
                <Input id="rule-standard" value={form.standardElementId} onChange={(event) => update({ standardElementId: event.target.value })} placeholder="已发布标准的数据元 id" />
              </FormField>
            </>
          ) : null}

          {form.ruleType === 'VAL_MINMAX' ? (
            <FormGrid>
              <FormField label="最小值（可空）" htmlFor="rule-min-val"><Input id="rule-min-val" value={form.minVal} onChange={(event) => update({ minVal: event.target.value })} placeholder="0" /></FormField>
              <FormField label="最大值（可空）" htmlFor="rule-max-val"><Input id="rule-max-val" value={form.maxVal} onChange={(event) => update({ maxVal: event.target.value })} placeholder="9" /></FormField>
            </FormGrid>
          ) : null}

          {form.ruleType === 'VAL_LEN' ? (
            <FormGrid>
              <FormField label="最小长度（可空）" htmlFor="rule-min-len"><Input id="rule-min-len" value={form.minLen} onChange={(event) => update({ minLen: event.target.value })} placeholder="1" /></FormField>
              <FormField label="最大长度（可空）" htmlFor="rule-max-len"><Input id="rule-max-len" value={form.maxLen} onChange={(event) => update({ maxLen: event.target.value })} placeholder="64" /></FormField>
            </FormGrid>
          ) : null}

          {form.ruleType === 'STR_REGEX' ? (
            <FormField label="正则表达式（NULL 不算失败）" htmlFor="rule-regex">
              <Input id="rule-regex" value={form.regex} onChange={(event) => update({ regex: event.target.value })} placeholder="例如：^[0-9]+$" />
            </FormField>
          ) : null}

          {form.ruleType === 'FK_REF' ? (
            <FormGrid>
              <FormField label="参照「库.表」" htmlFor="rule-ref-dataset"><Input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.ep_dict" /></FormField>
              <FormField label="参照列" htmlFor="rule-ref-column"><Input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder="例如：CODE" /></FormField>
            </FormGrid>
          ) : null}

          {form.ruleType === 'SQL' ? (
            <FormField label="校验 SQL（单条只读 SELECT，返回失败行）" htmlFor="rule-sql">
              <CodeTextarea id="rule-sql" value={form.customSql} onChange={(event) => update({ customSql: event.target.value })} placeholder="SELECT ID FROM ods_ep.ep_order WHERE PAY_STATUS IS NULL" />
            </FormField>
          ) : null}

          {form.ruleType === 'CROSS_VAL_COMPARE' || form.ruleType === 'DETAIL_STAT' ? (
            <>
              <FormGrid>
                <FormField label="参照「库.表」" htmlFor="rule-ref-dataset"><Input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.patient" /></FormField>
                <FormField label="参照值列" htmlFor="rule-ref-column"><Input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder={form.ruleType === 'CROSS_VAL_COMPARE' ? '例如：NAME' : '明细值列，例如 PAY'} /></FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="目标表关联键（逗号分隔）" htmlFor="rule-target-joins"><Input id="rule-target-joins" value={form.targetJoinCols} onChange={(event) => update({ targetJoinCols: event.target.value })} placeholder="例如：PATIENT_ID" /></FormField>
                <FormField label="参照表关联键（与左侧一一对应）" htmlFor="rule-ref-joins"><Input id="rule-ref-joins" value={form.refJoinCols} onChange={(event) => update({ refJoinCols: event.target.value })} placeholder="例如：PID" /></FormField>
              </FormGrid>
              {form.ruleType === 'DETAIL_STAT' ? (
                <FormField label="明细表统计函数" htmlFor="rule-detail-op">
                  <NativeSelect id="rule-detail-op" className="min-h-[35px]" value={form.refStatOp} onChange={(event) => update({ refStatOp: event.target.value })}>
                    {STAT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </NativeSelect>
                </FormField>
              ) : null}
            </>
          ) : null}

          {form.ruleType === 'STAT_VAL_COMPARE' ? (
            <>
              <FormGrid>
                <FormField label="检查表统计函数" htmlFor="rule-stat-op">
                  <NativeSelect id="rule-stat-op" className="min-h-[35px]" value={form.statOp} onChange={(event) => update({ statOp: event.target.value })}>
                    {STAT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </NativeSelect>
                </FormField>
                <FormField label="参照表统计函数" htmlFor="rule-ref-stat-op">
                  <NativeSelect id="rule-ref-stat-op" className="min-h-[35px]" value={form.refStatOp} onChange={(event) => update({ refStatOp: event.target.value })}>
                    {STAT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </NativeSelect>
                </FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="参照「库.表」" htmlFor="rule-ref-dataset"><Input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.ep_order_history" /></FormField>
                <FormField label="参照值列（COUNT 可空）" htmlFor="rule-ref-column"><Input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder="例如：AMOUNT" /></FormField>
              </FormGrid>
            </>
          ) : null}

          {form.ruleType === 'SQL_STAT_VAL' ? (
            <>
              <FormField label="检查值 SQL（单条只读，返回单个统计值）" htmlFor="rule-check-sql">
                <CodeTextarea id="rule-check-sql" className="min-h-[110px]" value={form.checkSql} onChange={(event) => update({ checkSql: event.target.value })} placeholder="SELECT COUNT(*) FROM ods_ep.ep_order" />
              </FormField>
              <FormField label="参照值 SQL（单条只读，返回单个统计值）" htmlFor="rule-ref-sql">
                <CodeTextarea id="rule-ref-sql" className="min-h-[110px]" value={form.refSql} onChange={(event) => update({ refSql: event.target.value })} placeholder="SELECT COUNT(*) FROM ods_ep.ep_order_history" />
              </FormField>
            </>
          ) : null}

          {form.ruleType === 'FIELD_LOGIC' ? (
            <FormField label="字段间逻辑表达式" htmlFor="rule-logic" hint="列名与比较符，例：AMOUNT > 0 AND PAY_STATUS = 'PAID'">
              <Input id="rule-logic" value={form.logic} onChange={(event) => update({ logic: event.target.value })} placeholder="AMOUNT > 0 AND PAY_STATUS = 'PAID'" />
            </FormField>
          ) : null}

          {form.ruleType === 'UPDATE_TIME' ? (
            <>
              <FormGrid>
                <FormField label="入库时间列" htmlFor="rule-ingest"><Input id="rule-ingest" value={form.ingestColumn} onChange={(event) => update({ ingestColumn: event.target.value })} placeholder="例如：ETL_TIME" /></FormField>
                <FormField label="时效阈值（业务时间 → 入库时间）" htmlFor="rule-threshold"><Input id="rule-threshold" type="number" min={0} value={form.threshold} onChange={(event) => update({ threshold: event.target.value })} placeholder="2" /></FormField>
              </FormGrid>
              <FormField label="阈值单位" htmlFor="rule-time-unit">
                <NativeSelect id="rule-time-unit" className="min-h-[35px]" value={form.timeUnit} onChange={(event) => update({ timeUnit: event.target.value })}>
                  {TIME_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </NativeSelect>
              </FormField>
            </>
          ) : null}

          {form.ruleType === 'TIME_CONTINUITY' ? (
            <FormNotice icon={<Shield />}>
              时间连续性检查目标列的全历史断档（相邻两期间隔 &gt; 1 天即失败行），失败列为（上一期, 本期）。目标列须为 DATE/DATETIME。
            </FormNotice>
          ) : null}

          {computedEvidence ? (
            <p className="mb-4 text-label text-muted">本类型的失败列由执行器编译派生（如 check_value/ref_value、prev_period/cur_period），无需配置证据白名单。</p>
          ) : (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-body-sm text-[#566173]">证据列白名单（失败样本展示 + 脱敏分类）</span>
                <Button size="sm" variant="text" onClick={() => update({ evidenceColumns: [...form.evidenceColumns, { name: '', classification: 'REDACTED' }] })}>
                  <Plus size={13} />添加证据列
                </Button>
              </div>
              {form.evidenceColumns.map((column, index) => (
                <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_220px_auto] items-center gap-2">
                  <Input
                    aria-label={`证据列 ${index + 1} 名称`}
                    value={column.name}
                    onChange={(event) => update({ evidenceColumns: form.evidenceColumns.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })}
                    placeholder="列名，例如 ID"
                  />
                  <NativeSelect
                    aria-label={`证据列 ${index + 1} 脱敏分类`}
                    className="min-h-[35px]"
                    value={column.classification}
                    onChange={(event) => update({ evidenceColumns: form.evidenceColumns.map((item, i) => i === index ? { ...item, classification: event.target.value as QualityEvidenceColumn['classification'] } : item) })}
                  >
                    {CLASSIFICATIONS.map((classification) => <option key={classification} value={classification}>{CLASSIFICATION_LABELS[classification]}</option>)}
                  </NativeSelect>
                  <Button size="sm" variant="text" disabled={form.evidenceColumns.length <= 1} onClick={() => update({ evidenceColumns: form.evidenceColumns.filter((_, i) => i !== index) })}>移除</Button>
                </div>
              ))}
            </div>
          )}

          {error ? <p role="alert" className="mb-3 text-body-sm leading-relaxed text-[#b04747]">{error}</p> : null}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-meta text-[#788495]"><Badge tone="blue">保存即推送</Badge> 执行器对目标表列做实校验</span>
            <div className="flex items-center gap-2">
              <Button onClick={() => (dirty ? setDiscardOpen(true) : navigate('/governance/quality'))}>取消</Button>
              <Button variant="primary" disabled={mutation.isPending} onClick={submit}>
                <Save size={14} />{mutation.isPending ? '保存中…' : '保存并推送'}
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      <Dialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="放弃未保存的修改？"
        description="离开后本页未保存的规则内容会丢失；已保存的规则与运行记录不受影响。"
        width={460}
        footer={
          <DialogFooter>
            <Button onClick={() => setDiscardOpen(false)}>继续编辑</Button>
            <Button variant="danger" onClick={() => { setDiscardOpen(false); navigate('/governance/quality') }}>放弃修改</Button>
          </DialogFooter>
        }
      />
    </div>
  )
}

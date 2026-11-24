import { LoadingBlock } from '@/components/app/loading'
import { Input } from '@/components/ui/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CodeTextarea } from '@/components/app/code-textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Plus, Save, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FormGrid } from '@/components/app/form-grid'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel } from '../../components/kit/panel'
import { EmptyState } from '../../components/kit/states'
import { useNotice } from '../../components/kit/toast'
import {
  saveQualityRule,
  QUALITY_RULE_TYPE_LABELS,
  type QualityEvidenceColumn,
  type QualityRuleDefinitionApiItem,
  type QualityRuleType,
} from '../../data/controlPlane'
import { usePortalNavigate } from '../../app/navigate'
import { useDirtyLeaveGuard } from '../../app/dirty-leave-guard'
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

/** 证据列脱敏分类的选项表：值与展示名同源。 */
const EVIDENCE_CLASSIFICATION_ITEMS = CLASSIFICATIONS.map((classification) => ({ value: classification, label: CLASSIFICATION_LABELS[classification] }))

const TIME_UNIT_ITEMS = TIME_UNITS.map((unit) => ({ value: unit, label: unit }))

const STAT_OP_ITEMS = STAT_OPS.map((op) => ({ value: op, label: op }))

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
  const [initialized, setInitialized] = useState(!ruleId)

  useEffect(() => {
    if (!ruleId || !existing || initialized) return
    setForm(formFromRule(existing))
    setInitialized(true)
  }, [existing, initialized, ruleId])

  const dirty = initialized && (ruleId
    ? JSON.stringify(form) !== JSON.stringify(existing ? formFromRule(existing) : emptyForm())
    : form.ruleId.trim() !== '' || form.datasetId.trim() !== '')

  // 拦一切路由离开（含侧栏/页签）；返回/取消只需正常 navigate，守卫会先询问。
  const { allowNextLeave, guard } = useDirtyLeaveGuard(dirty)

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
      allowNextLeave()
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

  if (ruleId && rulesRequest.isPending) return <LoadingBlock>正在读取规则…</LoadingBlock>
  if (ruleId && rulesRequest.isSuccess && !existing) {
    return (
      <Panel>
        <EmptyState
          icon={<Shield />}
          title="质量规则不存在"
          description="该规则可能已被删除，或当前账号没有访问权限。"
          action={<Button variant="outline" onClick={() => navigate('/governance/quality')}>返回质量工作台</Button>}
        />
      </Panel>
    )
  }

  const typeOptions = typesRequest.data?.length
    ? typesRequest.data
    : Object.entries(QUALITY_RULE_TYPE_LABELS).map(([type, label]) => ({ type: type as QualityRuleType, label, dimension: '', computedEvidence: COMPUTED_EVIDENCE_TYPES.has(type as QualityRuleType) }))
  const computedEvidence = COMPUTED_EVIDENCE_TYPES.has(form.ruleType)

  const update = (patch: Partial<RuleForm>) => setForm((current) => ({ ...current, ...patch }))

  const ruleTypeItems = [
    ...typeOptions.map((item) => ({ value: item.type, label: <>{item.label}（{item.type}）</> })),
  ]
  return (
    <div>
      <Breadcrumb items={[{ label: '数据治理' }, { label: '数据质量' }, { label: ruleId ? '编辑质量规则' : '新建质量规则' }]} trailing={ruleId ? <span className="font-mono">{ruleId}</span> : null} />
      <PageHeading
        title={ruleId ? '编辑质量规则' : '新建质量规则'}
        description="规则语义由质量规则执行器编译校验：标识符与 SQL 只读约束在保存时实校验，失败原因会如实返回。"
        actions={<Button variant="outline" onClick={() => navigate('/governance/quality')}>返回</Button>}
      />

      <Panel className="max-w-[880px]">
        <div className="px-6 py-5">
          <Alert variant="info" role="note" className="mb-4">
            <Shield />
            <AlertDescription>
              保存即推送执行器编译；证据列是失败样本的展示白名单与脱敏策略，不决定规则语义。
            </AlertDescription>
          </Alert>

          <FormGrid>
            <Field>
              <FieldLabel>
                规则编号 <span className="text-destructive-foreground">*</span>
              </FieldLabel>
              <Input id="rule-id" value={form.ruleId} disabled={Boolean(ruleId)} onChange={(event) => update({ ruleId: event.target.value })} placeholder="例如：quality.ep.order.paystatus-range" />
              <FieldDescription>字母、数字、点、下划线与连字符；编辑时不可修改</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="rule-type">规则类型</FieldLabel>
              <Select
                items={ruleTypeItems}
                value={form.ruleType}
                onValueChange={(next) => update({ ruleType: (next ?? '') as QualityRuleType })}
              >
                <SelectTrigger id="rule-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {ruleTypeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
          </FormGrid>

          <FormGrid>
            <Field>
              <FieldLabel>
                目标「库.表」 <span className="text-destructive-foreground">*</span>
              </FieldLabel>
              <Input id="rule-dataset" value={form.datasetId} onChange={(event) => update({ datasetId: event.target.value })} placeholder="例如：ods_ep.ep_order" />
            </Field>
            <Field>
              <FieldLabel>{NEEDS_COLUMN.has(form.ruleType) ? (form.ruleType === 'UPDATE_TIME' ? '目标列（业务时间列）' : '目标列') : '目标列（本类型无需）'}</FieldLabel>
              <Input id="rule-column" value={form.targetColumn} disabled={!NEEDS_COLUMN.has(form.ruleType)} onChange={(event) => update({ targetColumn: event.target.value })} placeholder="例如：PAY_STATUS" />
            </Field>
          </FormGrid>

          {form.ruleType === 'NOT_NULL' ? (
            <Field className="mb-4">
              <FieldLabel>
                <Checkbox checked={form.checkBlank} onCheckedChange={(checked) => update({ checkBlank: checked })} />
                空字符串也算失败（checkBlank）
              </FieldLabel>
            </Field>
          ) : null}

          {form.ruleType === 'VAL_SET' ? (
            <>
              <Field className="mb-4">
                <FieldLabel>值域集合（逗号分隔，数字自动识别）</FieldLabel>
                <Input id="rule-values" value={form.valuesText} onChange={(event) => update({ valuesText: event.target.value })} placeholder="例如：0,1,PAID" />
              </Field>
              <Field className="mb-4">
                <FieldLabel>或引用标准中心值域</FieldLabel>
                <Input id="rule-standard" value={form.standardElementId} onChange={(event) => update({ standardElementId: event.target.value })} placeholder="已发布标准的数据元 id" />
                <FieldDescription>标准中心数据元 id；填写后忽略上方手写值集，保存时解析快照。</FieldDescription>
              </Field>
            </>
          ) : null}

          {form.ruleType === 'VAL_MINMAX' ? (
            <FormGrid>
              <Field>
                <FieldLabel>最小值（可空）</FieldLabel>
                <Input id="rule-min-val" value={form.minVal} onChange={(event) => update({ minVal: event.target.value })} placeholder="0" />
              </Field>
              <Field>
                <FieldLabel>最大值（可空）</FieldLabel>
                <Input id="rule-max-val" value={form.maxVal} onChange={(event) => update({ maxVal: event.target.value })} placeholder="9" />
              </Field>
            </FormGrid>
          ) : null}

          {form.ruleType === 'VAL_LEN' ? (
            <FormGrid>
              <Field>
                <FieldLabel>最小长度（可空）</FieldLabel>
                <Input id="rule-min-len" value={form.minLen} onChange={(event) => update({ minLen: event.target.value })} placeholder="1" />
              </Field>
              <Field>
                <FieldLabel>最大长度（可空）</FieldLabel>
                <Input id="rule-max-len" value={form.maxLen} onChange={(event) => update({ maxLen: event.target.value })} placeholder="64" />
              </Field>
            </FormGrid>
          ) : null}

          {form.ruleType === 'STR_REGEX' ? (
            <Field className="mb-4">
              <FieldLabel>正则表达式（NULL 不算失败）</FieldLabel>
              <Input id="rule-regex" value={form.regex} onChange={(event) => update({ regex: event.target.value })} placeholder="例如：^[0-9]+$" />
            </Field>
          ) : null}

          {form.ruleType === 'FK_REF' ? (
            <FormGrid>
              <Field>
                <FieldLabel>参照「库.表」</FieldLabel>
                <Input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.ep_dict" />
              </Field>
              <Field>
                <FieldLabel>参照列</FieldLabel>
                <Input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder="例如：CODE" />
              </Field>
            </FormGrid>
          ) : null}

          {form.ruleType === 'SQL' ? (
            <Field className="mb-4">
              <FieldLabel>校验 SQL（单条只读 SELECT，返回失败行）</FieldLabel>
              <CodeTextarea id="rule-sql" value={form.customSql} onChange={(event) => update({ customSql: event.target.value })} placeholder="SELECT ID FROM ods_ep.ep_order WHERE PAY_STATUS IS NULL" />
            </Field>
          ) : null}

          {form.ruleType === 'CROSS_VAL_COMPARE' || form.ruleType === 'DETAIL_STAT' ? (
            <>
              <FormGrid>
                <Field>
                  <FieldLabel>参照「库.表」</FieldLabel>
                  <Input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.patient" />
                </Field>
                <Field>
                  <FieldLabel>参照值列</FieldLabel>
                  <Input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder={form.ruleType === 'CROSS_VAL_COMPARE' ? '例如：NAME' : '明细值列，例如 PAY'} />
                </Field>
              </FormGrid>
              <FormGrid>
                <Field>
                  <FieldLabel>目标表关联键（逗号分隔）</FieldLabel>
                  <Input id="rule-target-joins" value={form.targetJoinCols} onChange={(event) => update({ targetJoinCols: event.target.value })} placeholder="例如：PATIENT_ID" />
                </Field>
                <Field>
                  <FieldLabel>参照表关联键（与左侧一一对应）</FieldLabel>
                  <Input id="rule-ref-joins" value={form.refJoinCols} onChange={(event) => update({ refJoinCols: event.target.value })} placeholder="例如：PID" />
                </Field>
              </FormGrid>
              {form.ruleType === 'DETAIL_STAT' ? (
                <Field className="mb-4">
                  <FieldLabel htmlFor="rule-detail-op">明细表统计函数</FieldLabel>
                  <Select
                    items={STAT_OP_ITEMS}
                    value={form.refStatOp}
                    onValueChange={(next) => update({ refStatOp: next ?? '' })}
                  >
                    <SelectTrigger id="rule-detail-op">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {STAT_OP_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
              ) : null}
            </>
          ) : null}

          {form.ruleType === 'STAT_VAL_COMPARE' ? (
            <>
              <FormGrid>
                <Field>
                  <FieldLabel htmlFor="rule-stat-op">检查表统计函数</FieldLabel>
                  <Select
                    items={STAT_OP_ITEMS}
                    value={form.statOp}
                    onValueChange={(next) => update({ statOp: next ?? '' })}
                  >
                    <SelectTrigger id="rule-stat-op">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {STAT_OP_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="rule-ref-stat-op">参照表统计函数</FieldLabel>
                  <Select
                    items={STAT_OP_ITEMS}
                    value={form.refStatOp}
                    onValueChange={(next) => update({ refStatOp: next ?? '' })}
                  >
                    <SelectTrigger id="rule-ref-stat-op">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {STAT_OP_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
              </FormGrid>
              <FormGrid>
                <Field>
                  <FieldLabel>参照「库.表」</FieldLabel>
                  <Input id="rule-ref-dataset" value={form.refDataset} onChange={(event) => update({ refDataset: event.target.value })} placeholder="例如：ods_ep.ep_order_history" />
                </Field>
                <Field>
                  <FieldLabel>参照值列（COUNT 可空）</FieldLabel>
                  <Input id="rule-ref-column" value={form.refColumn} onChange={(event) => update({ refColumn: event.target.value })} placeholder="例如：AMOUNT" />
                </Field>
              </FormGrid>
            </>
          ) : null}

          {form.ruleType === 'SQL_STAT_VAL' ? (
            <>
              <Field className="mb-4">
                <FieldLabel>检查值 SQL（单条只读，返回单个统计值）</FieldLabel>
                <CodeTextarea id="rule-check-sql" className="min-h-[110px]" value={form.checkSql} onChange={(event) => update({ checkSql: event.target.value })} placeholder="SELECT COUNT(*) FROM ods_ep.ep_order" />
              </Field>
              <Field className="mb-4">
                <FieldLabel>参照值 SQL（单条只读，返回单个统计值）</FieldLabel>
                <CodeTextarea id="rule-ref-sql" className="min-h-[110px]" value={form.refSql} onChange={(event) => update({ refSql: event.target.value })} placeholder="SELECT COUNT(*) FROM ods_ep.ep_order_history" />
              </Field>
            </>
          ) : null}

          {form.ruleType === 'FIELD_LOGIC' ? (
            <Field className="mb-4">
              <FieldLabel>字段间逻辑表达式</FieldLabel>
              <Input id="rule-logic" value={form.logic} onChange={(event) => update({ logic: event.target.value })} placeholder="AMOUNT > 0 AND PAY_STATUS = 'PAID'" />
              <FieldDescription>{"列名与比较符，例：AMOUNT > 0 AND PAY_STATUS = 'PAID'"}</FieldDescription>
            </Field>
          ) : null}

          {form.ruleType === 'UPDATE_TIME' ? (
            <>
              <FormGrid>
                <Field>
                  <FieldLabel>入库时间列</FieldLabel>
                  <Input id="rule-ingest" value={form.ingestColumn} onChange={(event) => update({ ingestColumn: event.target.value })} placeholder="例如：ETL_TIME" />
                </Field>
                <Field>
                  <FieldLabel>时效阈值（业务时间 → 入库时间）</FieldLabel>
                  <Input id="rule-threshold" type="number" min={0} value={form.threshold} onChange={(event) => update({ threshold: event.target.value })} placeholder="2" />
                </Field>
              </FormGrid>
              <Field className="mb-4">
                <FieldLabel htmlFor="rule-time-unit">阈值单位</FieldLabel>
                <Select
                  items={TIME_UNIT_ITEMS}
                  value={form.timeUnit}
                  onValueChange={(next) => update({ timeUnit: next ?? '' })}
                >
                  <SelectTrigger id="rule-time-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {TIME_UNIT_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
            </>
          ) : null}

          {form.ruleType === 'TIME_CONTINUITY' ? (
            <Alert variant="info" role="note" className="mb-4">
              <Shield />
              <AlertDescription>
                时间连续性检查目标列的全历史断档（相邻两期间隔 &gt; 1 天即失败行），失败列为（上一期, 本期）。目标列须为 DATE/DATETIME。
              </AlertDescription>
            </Alert>
          ) : null}

          {computedEvidence ? (
            <p className="mb-4 text-label text-muted-foreground">本类型的失败列由执行器编译派生（如 check_value/ref_value、prev_period/cur_period），无需配置证据白名单。</p>
          ) : (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-body-sm text-ink-soft">证据列白名单（失败样本展示 + 脱敏分类）</span>
                <Button size="sm" variant="link" onClick={() => update({ evidenceColumns: [...form.evidenceColumns, { name: '', classification: 'REDACTED' }] })}>
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
                  <Select
                    items={EVIDENCE_CLASSIFICATION_ITEMS}
                    value={column.classification}
                    onValueChange={(next) => update({ evidenceColumns: form.evidenceColumns.map((item, i) => i === index ? { ...item, classification: (next ?? '') as QualityEvidenceColumn['classification'] } : item) })}
                  >
                    <SelectTrigger aria-label={`证据列 ${index + 1} 脱敏分类`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {EVIDENCE_CLASSIFICATION_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Button size="sm" variant="link" disabled={form.evidenceColumns.length <= 1} onClick={() => update({ evidenceColumns: form.evidenceColumns.filter((_, i) => i !== index) })}>移除</Button>
                </div>
              ))}
            </div>
          )}

          {error ? (
            <Alert variant="error" className="mb-3">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-meta text-muted-foreground"><Badge variant="info">保存即推送</Badge> 执行器对目标表列做实校验</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => navigate('/governance/quality')}>取消</Button>
              <Button disabled={mutation.isPending} onClick={submit}>
                <Save size={14} />{mutation.isPending ? '保存中…' : '保存并推送'}
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      {guard}
    </div>
  )
}

import type {
  QualityEvidenceColumn,
  QualityRuleDefinitionApiItem,
  QualityRuleType,
} from '../../data/controlPlane'

/**
 * 质量规则表单的纯逻辑：参数映射与提交前校验。
 * 语义校验的权威在执行器（编译时实校验）；这里只拦截明显不完整或不合法的输入，
 * 失败原因仍以服务端返回为准——门户不假装比执行器更懂规则。
 */

export const STAT_OPS = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'] as const
export const TIME_UNITS = ['SECOND', 'MINUTE', 'HOUR', 'DAY'] as const
export const CLASSIFICATIONS: QualityEvidenceColumn['classification'][] = ['IDENTIFIER', 'CATEGORY', 'SAFE', 'REDACTED']
export const CLASSIFICATION_LABELS: Record<QualityEvidenceColumn['classification'], string> = {
  IDENTIFIER: 'IDENTIFIER（哈希脱敏）',
  CATEGORY: 'CATEGORY（类别值直显）',
  SAFE: 'SAFE（安全直显）',
  REDACTED: 'REDACTED（完全遮蔽）',
}

/** 失败列由执行器编译派生：隐藏证据白名单编辑。 */
export const COMPUTED_EVIDENCE_TYPES = new Set<QualityRuleType>(['STAT_VAL_COMPARE', 'SQL_STAT_VAL', 'DETAIL_STAT', 'TIME_CONTINUITY'])
export const NEEDS_COLUMN = new Set<QualityRuleType>(['NOT_NULL', 'UNIQUE', 'VAL_SET', 'VAL_MINMAX', 'VAL_LEN', 'STR_REGEX', 'FK_REF', 'CROSS_VAL_COMPARE', 'UPDATE_TIME', 'TIME_CONTINUITY'])

export interface RuleForm {
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

export function emptyForm(): RuleForm {
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

export function formFromRule(rule: QualityRuleDefinitionApiItem): RuleForm {
  const params = rule.params ?? {}
  const joinText = (value: unknown) => Array.isArray(value) ? value.join(',') : ''
  return {
    ruleId: rule.ruleId,
    ruleType: rule.ruleType,
    datasetId: rule.datasetId,
    targetColumn: rule.targetColumn,
    checkBlank: params.checkBlank === true,
    valuesText: Array.isArray(params.values) ? params.values.map(String).join(',') : '',
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

export function paramsFromForm(form: RuleForm): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const trim = (value: string) => value.trim()
  const splitJoin = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)
  switch (form.ruleType) {
    case 'NOT_NULL': params.checkBlank = form.checkBlank; break
    case 'VAL_SET':
      if (form.standardElementId.trim()) params.standardElementId = form.standardElementId.trim()
      else params.values = splitJoin(form.valuesText).map((value) => (/^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value))
      break
    case 'VAL_MINMAX':
      if (trim(form.minVal)) params.minVal = Number(form.minVal)
      if (trim(form.maxVal)) params.maxVal = Number(form.maxVal)
      break
    case 'VAL_LEN':
      if (trim(form.minLen)) params.minLen = Number(form.minLen)
      if (trim(form.maxLen)) params.maxLen = Number(form.maxLen)
      break
    case 'STR_REGEX': if (trim(form.regex)) params.regex = trim(form.regex); break
    case 'FK_REF': params.refDataset = trim(form.refDataset); params.refColumn = trim(form.refColumn); break
    case 'SQL': params.sql = form.customSql; break
    case 'CROSS_VAL_COMPARE':
    case 'DETAIL_STAT':
      params.refDataset = trim(form.refDataset)
      params.refColumn = trim(form.refColumn)
      params.targetJoinCols = splitJoin(form.targetJoinCols)
      params.refJoinCols = splitJoin(form.refJoinCols)
      if (form.ruleType === 'DETAIL_STAT') params.refOp = form.refStatOp
      break
    case 'STAT_VAL_COMPARE':
      params.op = form.statOp
      params.refOp = form.refStatOp
      params.refDataset = trim(form.refDataset)
      if (trim(form.refColumn)) params.refColumn = trim(form.refColumn)
      break
    case 'SQL_STAT_VAL': params.checkSql = form.checkSql; params.refSql = form.refSql; break
    case 'FIELD_LOGIC': params.logic = trim(form.logic); break
    case 'UPDATE_TIME':
      params.ingestColumn = trim(form.ingestColumn)
      params.threshold = Number(form.threshold || 0)
      params.timeUnit = form.timeUnit
      break
    default: break
  }
  return params
}

export function validateRuleForm(form: RuleForm): string | undefined {
  if (!form.ruleId.trim()) return '请填写规则编号（例如 quality.ep.order.paystatus-range）'
  if (!/^[A-Za-z0-9._-]+$/.test(form.ruleId.trim())) return '规则编号只允许字母、数字、点、下划线和连字符'
  if (!form.datasetId.trim()) return '请填写目标「库.表」'
  if (NEEDS_COLUMN.has(form.ruleType) && !form.targetColumn.trim()) return '该规则类型需要目标列'
  if (form.ruleType === 'VAL_SET' && !form.standardElementId.trim() && !form.valuesText.trim()) return '值域校验需要值域集合或引用的标准数据元'
  if (form.ruleType === 'SQL' && !form.customSql.trim()) return '自定义 SQL 校验需要只读 SELECT'
  if (form.ruleType === 'FK_REF' && (!form.refDataset.trim() || !form.refColumn.trim())) return '外键参照校验需要参照表与参照列'
  if (form.ruleType === 'CROSS_VAL_COMPARE' || form.ruleType === 'DETAIL_STAT') {
    if (!form.refDataset.trim() || !form.refColumn.trim()) return '跨表校验需要参照表与参照值列'
    if (!form.targetJoinCols.trim() || !form.refJoinCols.trim()) return '跨表校验需要目标与参照的关联键（逗号分隔，一一对应）'
  }
  if (form.ruleType === 'SQL_STAT_VAL' && (!form.checkSql.trim() || !form.refSql.trim())) return 'SQL 统计值比较需要两条只读 SQL'
  if (form.ruleType === 'FIELD_LOGIC' && !form.logic.trim()) return '字段间关系需要逻辑表达式'
  if (form.ruleType === 'UPDATE_TIME' && (!form.ingestColumn.trim() || !form.threshold.trim())) return '更新时效校验需要入库时间列与时效阈值'
  return undefined
}


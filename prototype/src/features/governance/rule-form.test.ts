import { describe, expect, it } from 'vitest'
import type { QualityRuleDefinitionApiItem } from '../../data/controlPlane'
import { emptyForm, formFromRule, paramsFromForm, validateRuleForm } from './rule-form'

const baseRule: QualityRuleDefinitionApiItem = {
  ruleId: 'quality.ep.order.paystatus-range',
  ruleType: 'VAL_SET',
  datasetId: 'ods_ep.ep_order',
  targetColumn: 'PAY_STATUS',
  params: { values: [0, 1] },
  evidenceColumns: [{ name: 'ORDER_ID', classification: 'IDENTIFIER' }],
  enabled: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
}

describe('质量规则表单', () => {
  it('值域集合按数字识别解析，引用标准时忽略手写值集', () => {
    expect(paramsFromForm({ ...emptyForm(), ruleType: 'VAL_SET', valuesText: '0,1,PAID' })).toEqual({ values: [0, 1, 'PAID'] })
    expect(paramsFromForm({ ...emptyForm(), ruleType: 'VAL_SET', valuesText: '0,1', standardElementId: 'std-el-01' })).toEqual({ standardElementId: 'std-el-01' })
  })

  it('范围/长度/时效按类型收集参数，空值不提交', () => {
    expect(paramsFromForm({ ...emptyForm(), ruleType: 'VAL_MINMAX', minVal: '0', maxVal: '' })).toEqual({ minVal: 0 })
    expect(paramsFromForm({ ...emptyForm(), ruleType: 'VAL_LEN', minLen: '1', maxLen: '64' })).toEqual({ minLen: 1, maxLen: 64 })
    expect(paramsFromForm({ ...emptyForm(), ruleType: 'UPDATE_TIME', ingestColumn: 'ETL_TIME', threshold: '2', timeUnit: 'HOUR' }))
      .toEqual({ ingestColumn: 'ETL_TIME', threshold: 2, timeUnit: 'HOUR' })
  })

  it('跨表校验把关联键拆成数组并成对提交', () => {
    expect(paramsFromForm({
      ...emptyForm(), ruleType: 'CROSS_VAL_COMPARE', refDataset: 'ods_ep.patient', refColumn: 'NAME',
      targetJoinCols: 'PATIENT_ID, INSTITUTION', refJoinCols: 'PID, INST_CODE',
    })).toEqual({
      refDataset: 'ods_ep.patient', refColumn: 'NAME',
      targetJoinCols: ['PATIENT_ID', 'INSTITUTION'], refJoinCols: ['PID', 'INST_CODE'],
    })
  })

  it('编辑回填与参数解析可往返', () => {
    const form = formFromRule(baseRule)
    expect(form.ruleType).toBe('VAL_SET')
    expect(form.valuesText).toBe('0,1')
    expect(paramsFromForm(form)).toEqual({ values: [0, 1] })
  })

  it('提交前校验拦截缺字段与不合法的规则编号', () => {
    const empty = emptyForm()
    expect(validateRuleForm(empty)).toContain('规则编号')
    expect(validateRuleForm({ ...empty, ruleId: 'bad id', datasetId: 'ods.a' })).toContain('只允许字母')
    expect(validateRuleForm({ ...empty, ruleId: 'quality.ok', datasetId: '' })).toContain('库.表')
    expect(validateRuleForm({ ...empty, ruleId: 'quality.ok', datasetId: 'ods.a', ruleType: 'SQL' })).toContain('只读 SELECT')
    expect(validateRuleForm({
      ...empty, ruleId: 'quality.ok', datasetId: 'ods.a', ruleType: 'CROSS_VAL_COMPARE',
      targetColumn: 'X', refDataset: 'ods.b', refColumn: 'X', targetJoinCols: 'A', refJoinCols: '',
    })).toContain('关联键')
    expect(validateRuleForm({ ...empty, ruleId: 'quality.ok', datasetId: 'ods.a', ruleType: 'NOT_NULL', targetColumn: 'C' })).toBeUndefined()
  })
})

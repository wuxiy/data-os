import { describe, expect, it } from 'vitest'
import { eventTone, executorOutputView, isRecheckRetryEvent, looksLikeExecutorOutput, shortBatchId } from './domain'

describe('执行器输出治理（critique P0-2）', () => {
  it('识别执行器输出指纹（dbt 全文与后端摘要形态）', () => {
    expect(looksLikeExecutorOutput(null)).toBe(false)
    expect(looksLikeExecutorOutput('')).toBe(false)
    expect(looksLikeExecutorOutput('已与业务方确认口径，补录缺失机构')).toBe(false)
    expect(looksLikeExecutorOutput('Running with dbt=1.10.22\nRegistered adapter: doris=1.0.0')).toBe(true)
    expect(looksLikeExecutorOutput('14:53:02  Failure in test ep_mz_cfzb_not_null (models/x.sql)')).toBe(true)
    expect(looksLikeExecutorOutput('执行器输出 7 行（完整内容见质量运行记录）：FAIL 42')).toBe(true)
  })

  it('短输出整体呈现，长输出切分为首行 + 折叠全文', () => {
    expect(executorOutputView('质量规则未通过')).toEqual({ head: '质量规则未通过', folded: null })
    const log = ['Running with dbt=1.10.22', 'Registered adapter: doris=1.0.0', 'Found 35 data tests', '14:53:02 Failure in test x'].join('\n')
    const view = executorOutputView(log)
    expect(view.head).toBe('执行器输出（4 行，完整内容已折叠）')
    expect(view.folded).toBe(log)
  })
})

describe('执行批次号紧凑展示（critique P3 溢出修复）', () => {
  it('短批次号原样保留，长 UUID 截断为前缀加省略号', () => {
    expect(shortBatchId('qr-36bdb756')).toBe('qr-36bdb756')
    expect(shortBatchId('qr-36bdb756-49')).toBe('qr-36bdb756-49')
    expect(shortBatchId('qr-36bdb756-4930-4e41-9977-965729f68cb6')).toBe('qr-36bdb756-4…')
  })
})

describe('质量时间线事件语义色（2026-10-05 复评 P2-4）', () => {
  it('失败/逾期为 danger，退回/提醒为 warning，闭环为 healthy，中间步骤中性', () => {
    expect(eventTone('RECHECK_SUBMIT_FAILED')).toBe('danger')
    expect(eventTone('RECHECK_FAILED')).toBe('danger')
    expect(eventTone('SLA_OVERDUE')).toBe('danger')
    expect(eventTone('AUTO_RETURNED')).toBe('warning')
    expect(eventTone('RESPONSIBLE_REMINDER_REQUESTED')).toBe('warning')
    expect(eventTone('AUTO_CLOSED')).toBe('healthy')
    expect(eventTone('RECHECK_REQUESTED')).toBe('neutral')
    expect(eventTone('WORKFLOW_UPDATED')).toBe('neutral')
    expect(eventTone('UNKNOWN_TYPE')).toBe('neutral')
  })
  it('复检投递/执行中间事件参与连续重试折叠', () => {
    expect(isRecheckRetryEvent('RECHECK_REQUESTED')).toBe(true)
    expect(isRecheckRetryEvent('RECHECK_SUBMIT_FAILED')).toBe(true)
    expect(isRecheckRetryEvent('RECHECK_FAILED')).toBe(true)
    expect(isRecheckRetryEvent('AUTO_CLOSED')).toBe(false)
    expect(isRecheckRetryEvent('SLA_OVERDUE')).toBe(false)
  })
})

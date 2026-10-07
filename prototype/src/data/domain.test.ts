import { describe, expect, it } from 'vitest'
import { eventTone, executorOutputView, formatDateTime, formatInlineDateTimes, isRecheckRetryEvent, looksLikeExecutorOutput, shortBatchId, standardEventLabel } from './domain'

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

describe('时间格式化跨年补年份（2026-10-05 复评）', () => {
  it('当年日期保持 MM-DD HH:mm，非当年补齐年份', () => {
    const now = new Date()
    const sameYear = new Date(now.getFullYear(), 5, 15, 8, 30)
    expect(formatDateTime(sameYear.toISOString())).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatDateTime('2020-08-03T02:00:00Z')).toMatch(/^2020-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatDateTime(null)).toBe('—')
  })
})

describe('标准/映射审计事件枚举中文口径（2026-10-07 复评 P1-b）', () => {
  it('CREATED/DRAFT_UPDATED 不再原样上屏，未知值回退原值', () => {
    expect(standardEventLabel('CREATED')).toBe('创建')
    expect(standardEventLabel('DRAFT_UPDATED')).toBe('更新草稿')
    expect(standardEventLabel('SOME_NEW_EVENT')).toBe('SOME_NEW_EVENT')
  })
})

describe('自由文本内嵌 ISO 时间戳格式化（2026-10-07 复评：SLA 事件说明）', () => {
  it('微秒时间戳替换为统一格式，普通文本不动', () => {
    const formatted = formatInlineDateTimes('SLA 已逾期，截止时间：2020-08-02T18:00:19.419329Z')
    expect(formatted).toMatch(/^SLA 已逾期，截止时间：2020-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatInlineDateTimes('复检未通过，问题已退回')).toBe('复检未通过，问题已退回')
  })
})

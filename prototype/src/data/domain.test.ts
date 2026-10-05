import { describe, expect, it } from 'vitest'
import { executorOutputView, looksLikeExecutorOutput } from './domain'

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

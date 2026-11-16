import { describe, expect, it } from 'vitest'
import { nextLifecycleTarget } from './ai-data-page'

/**
 * 生命周期主链：CERTIFIED 只能经人工审批流转，主链推进不能跨过它；
 * DEPRECATED 是终点（从任何状态弃用），没有下一步。
 */
describe('AI Data 生命周期主链', () => {
  it('按主链逐步推进', () => {
    expect(nextLifecycleTarget('DRAFT')).toBe('CURATED')
    expect(nextLifecycleTarget('CURATED')).toBe('ASSESSED')
    expect(nextLifecycleTarget('ASSESSED')).toBe('CERTIFIED')
    expect(nextLifecycleTarget('CERTIFIED')).toBe('SERVING')
  })

  it('终点与弃用状态没有下一步', () => {
    expect(nextLifecycleTarget('SERVING')).toBeNull()
    expect(nextLifecycleTarget('DEPRECATED')).toBeNull()
  })
})

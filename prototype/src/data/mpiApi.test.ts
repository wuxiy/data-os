import { describe, expect, it } from 'vitest'
import { mpiEvidenceLine } from './mpiApi'

// 2026-11-09 走查 P3：证据行不直出 SAME/DIFF/NO_MATCH 等英文占位与枚举，
// 影子评分的 match 语义是「与生产判定一致」，不是 A/B 相等。
describe('mpiEvidenceLine', () => {
  it('联系方式占位折叠为单值中文', () => {
    expect(mpiEvidenceLine({ field: 'contact', valueA: 'DIFF', valueB: 'DIFF', match: false }))
      .toBe('联系方式：不同')
    expect(mpiEvidenceLine({ field: 'contact', valueA: 'SAME', valueB: 'SAME', match: true }))
      .toBe('联系方式：相同')
  })

  it('影子评分说明与生产判定的一致口径', () => {
    expect(mpiEvidenceLine({ field: 'v2Score', valueA: '-7.22', valueB: 'NO_MATCH', match: true }))
      .toBe('V2 影子评分：-7.22 · 影子判定 不匹配（否决）（与生产判定一致）')
    expect(mpiEvidenceLine({ field: 'v2Score', valueA: '3.1', valueB: 'AUTO_MATCH', match: false }))
      .toBe('V2 影子评分：3.1 · 影子判定 自动匹配（与生产判定不一致）')
  })

  it('普通字段保持 A / B 一致口径', () => {
    expect(mpiEvidenceLine({ field: 'name', valueA: '张三', valueB: '张三', match: true }))
      .toBe('姓名：张三 / 张三 一致')
    expect(mpiEvidenceLine({ field: 'cardNo', valueA: '120112****6978', valueB: '120112****6979', match: false }))
      .toBe('卡号：120112****6978 / 120112****6979 不一致')
  })

  it('未知字段与空值有兜底', () => {
    expect(mpiEvidenceLine({ field: 'futureField', valueA: '', valueB: '', match: false }))
      .toBe('futureField：— / — 不一致')
  })
})

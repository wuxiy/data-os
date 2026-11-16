import { describe, expect, it } from 'vitest'
import { buildCron, parseCron, shiftMinutes, toDsTime, toLocalInput } from './cron'

/**
 * 调度 CRON 编译/识别：只认本面板能精确表达的形态，
 * 其余必须回落到高级模式，避免把用户已有调度改坏。
 */
describe('调度 CRON', () => {
  it('每天 HH:mm 编译为六位 CRON 并可回读', () => {
    const cron = buildCron({ preset: 'daily', dailyTime: '02:30', rangeStart: '08:00', rangeEnd: '18:00', interval: '2', onceAt: '' })
    expect(cron).toBe('0 30 02 * * ?')
    expect(parseCron(cron)).toEqual({ kind: 'simple', preset: 'daily', dailyTime: '02:30' })
  })

  it('时段内每小时 / 每 N 小时 / 每 N 分钟', () => {
    expect(buildCron({ preset: 'hourly', dailyTime: '02:30', rangeStart: '08:00', rangeEnd: '18:00', interval: '2', onceAt: '' })).toBe('0 30 08-18 * * ?')
    expect(parseCron('0 30 08-18 * * ?')).toMatchObject({ preset: 'hourly' })
    expect(buildCron({ preset: 'everyNHours', dailyTime: '00:00', rangeStart: '08:00', rangeEnd: '20:00', interval: '3', onceAt: '' })).toBe('0 00 08-20/3 * * ?')
    expect(parseCron('0 00 08-20/3 * * ?')).toMatchObject({ preset: 'everyNHours', interval: '3' })
    expect(buildCron({ preset: 'everyNMinutes', dailyTime: '00:00', rangeStart: '08:00', rangeEnd: '18:00', interval: '15', onceAt: '' })).toBe('0 0/15 08-18 * * ?')
    expect(parseCron('0 0/15 08-18 * * ?')).toMatchObject({ preset: 'everyNMinutes', interval: '15' })
  })

  it('间隔越界被钳制在平台调度允许范围', () => {
    expect(buildCron({ preset: 'everyNHours', dailyTime: '00:00', rangeStart: '00:00', rangeEnd: '23:00', interval: '99', onceAt: '' })).toBe('0 00 00-23/11 * * ?')
    expect(buildCron({ preset: 'everyNMinutes', dailyTime: '00:00', rangeStart: '00:00', rangeEnd: '23:00', interval: '99', onceAt: '' })).toBe('0 0/59 00-23 * * ?')
  })

  it('延迟一次编译为指定日期时刻', () => {
    expect(buildCron({ preset: 'once', dailyTime: '00:00', rangeStart: '00:00', rangeEnd: '00:00', interval: '1', onceAt: '2026-12-01T09:15' })).toBe('0 15 09 01 12 ?')
  })

  it('无法精确表达的表达式回落高级模式', () => {
    expect(parseCron('0 0 1,13 * * ?')).toEqual({ kind: 'advanced' })
    expect(parseCron('0 30 2 ? * MON')).toEqual({ kind: 'advanced' })
  })

  it('时间串与本地输入互转、延迟窗口按分钟平移', () => {
    expect(toDsTime('2026-12-01T09:15')).toBe('2026-12-01 09:15:00')
    expect(toDsTime('2026-12-01 09:15:00')).toBe('2026-12-01 09:15:00')
    expect(toLocalInput('2026-12-01 09:15:00')).toBe('2026-12-01T09:15')
    expect(toLocalInput(null)).toBe('')
    expect(shiftMinutes('2026-12-01T23:30', 60)).toBe('2026-12-02T00:30')
  })
})

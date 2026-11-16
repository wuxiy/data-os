/**
 * 调度 CRON 的简易形态编译与识别（DS 六位：秒 分 时 日 月 周）。
 * 只认本面板能精确表达的四种周期与「延迟一次」；其余形态走高级模式，
 * 不做模糊猜测（错误猜测会把用户的既有调度改坏）。
 */
export type SchedulePreset = 'daily' | 'hourly' | 'everyNHours' | 'everyNMinutes' | 'once'

export interface CronInput {
  preset: string
  dailyTime: string
  rangeStart: string
  rangeEnd: string
  interval: string
  onceAt: string
}

export function buildCron(input: CronInput): string {
  const [sh, sm] = splitTime(input.dailyTime, '02:30')
  const [hs] = splitTime(input.rangeStart, '08:00')
  const [he] = splitTime(input.rangeEnd, '18:00')
  const n = Math.max(1, Math.floor(Number(input.interval) || 1))
  switch (input.preset) {
    case 'daily': return `0 ${sm} ${sh} * * ?`
    case 'hourly': return `0 ${sm} ${hs}-${he} * * ?`
    case 'everyNHours': return `0 ${sm} ${hs}-${he}/${Math.min(n, 11)} * * ?`
    case 'everyNMinutes': return `0 0/${Math.min(n, 59)} ${hs}-${he} * * ?`
    case 'once': {
      if (!input.onceAt) return ''
      const [date, time] = input.onceAt.split('T')
      const [hh, mm] = (time ?? '00:00').split(':')
      const [y, mo, d] = date.split('-')
      return `0 ${mm} ${hh} ${d} ${mo} ?`
    }
    default: return ''
  }
}

export type ParsedCron =
  | { kind: 'advanced' }
  | { kind: 'simple'; preset: 'daily'; dailyTime: string }
  | { kind: 'simple'; preset: 'hourly' | 'everyNHours'; rangeStart: string; rangeEnd: string; interval: string }
  | { kind: 'simple'; preset: 'everyNMinutes'; rangeStart: string; rangeEnd: string; interval: string }
  | { kind: 'simple'; preset: 'once' }

export function parseCron(crontab: string): ParsedCron {
  const daily = /^0 (\d{1,2}) (\d{1,2}) \* \* \?$/.exec(crontab)
  if (daily) return { kind: 'simple', preset: 'daily', dailyTime: `${pad(daily[2])}:${pad(daily[1])}` }
  const hours = /^0 (\d{1,2}) (\d{1,2})-(\d{1,2}) \* \* \?$/.exec(crontab)
  if (hours) return { kind: 'simple', preset: 'hourly', rangeStart: `${pad(hours[2])}:${pad(hours[1])}`, rangeEnd: `${pad(hours[3])}:00`, interval: '2' }
  const stepHours = /^0 (\d{1,2}) (\d{1,2})-(\d{1,2})\/(\d{1,2}) \* \* \?$/.exec(crontab)
  if (stepHours) return { kind: 'simple', preset: 'everyNHours', rangeStart: `${pad(stepHours[2])}:${pad(stepHours[1])}`, rangeEnd: `${pad(stepHours[3])}:00`, interval: stepHours[4] }
  const stepMinutes = /^0 0\/(\d{1,2}) (\d{1,2})-(\d{1,2}) \* \* \?$/.exec(crontab)
  if (stepMinutes) return { kind: 'simple', preset: 'everyNMinutes', rangeStart: `${pad(stepMinutes[2])}:00`, rangeEnd: `${pad(stepMinutes[3])}:00`, interval: stepMinutes[1] }
  const once = /^0 (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) \?$/.exec(crontab)
  if (once) return { kind: 'simple', preset: 'once' }
  return { kind: 'advanced' }
}

export function splitTime(value: string, fallback: string): [string, string] {
  const parts = (value || fallback).split(':')
  return [pad(parts[0] ?? '0'), pad(parts[1] ?? '0')]
}

function pad(value: string): string {
  return value.padStart(2, '0')
}

/** datetime-local 值 → 平台调度本地时间串（yyyy-MM-dd HH:mm:ss）。 */
export function toDsTime(value: string): string {
  if (!value) return ''
  return value.length === 16 ? `${value.replace('T', ' ')}:00` : value.replace('T', ' ')
}

/** 平台调度本地时间串 → datetime-local 值（截掉秒）。 */
export function toLocalInput(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 16).replace(' ', 'T')
}

/** 延迟一次的生效窗口终点：+n 分钟。 */
export function shiftMinutes(value: string, minutes: number): string {
  if (!value) return ''
  const date = new Date(`${value.replace('T', ' ')}`)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() + minutes)
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

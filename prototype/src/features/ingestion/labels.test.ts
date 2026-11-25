import { describe, expect, it } from 'vitest'
import type { SourceApiItem } from '../../data/controlPlane'
import {
  DEFAULT_TEMPLATE_KEY,
  LIVE_TEMPLATE_KEY,
  businessMessage,
  configForTemplate,
  isDolphinExecutor,
  parseConfig,
  preferredSourceId,
  sourceDisplayName,
  sourceStatusView,
} from './labels'

function source(overrides: Partial<SourceApiItem>): SourceApiItem {
  return {
    id: 'src-001', tenantId: 't', institutionId: 'i', name: '来源', systemType: 'LIS', protocol: 'JDBC',
    status: 'UNCHECKED', createdAt: '2026-11-01T00:00:00Z', lastCheckedAt: null, lastCheckMessage: null, connection: null,
    ...overrides,
  }
}

describe('接入域词汇与默认值', () => {
  it('状态未知值原样回退，不伪造成功', () => {
    expect(sourceStatusView('HEALTHY')).toEqual({ label: '健康', tone: 'success' })
    expect(sourceStatusView('UNHEALTHY')).toEqual({ label: '连接失败', tone: 'error' })
    expect(sourceStatusView('SOMETHING_NEW')).toEqual({ label: '待检查', tone: 'warning' })
  })

  it('无名数据源不直出裸 UUID', () => {
    expect(sourceDisplayName(source({ name: '  ' }))).toBe('未命名数据源（src-001）')
    expect(sourceDisplayName(source({ name: '检验 LIS' }))).toBe('检验 LIS')
  })

  it('新建任务默认选已登记连接的源', () => {
    const unconnected = source({ id: 'a' })
    const connected = source({ id: 'b', connection: { jdbcUrl: 'jdbc:x' } })
    expect(preferredSourceId([unconnected, connected])).toBe('b')
    expect(preferredSourceId([unconnected])).toBe('a')
    expect(preferredSourceId([])).toBe('')
  })

  it('模板配置随模式切换 job.mode，且自定义模板返回空对象', () => {
    const fake = configForTemplate(DEFAULT_TEMPLATE_KEY, 'CDC') as { env: Record<string, unknown> }
    expect(fake.env['job.mode']).toBe('CDC')
    expect(configForTemplate(LIVE_TEMPLATE_KEY, 'BATCH')).toEqual({})
    const fromCatalog = configForTemplate('JDBC_TO_DORIS', 'CDC', [{
      key: 'JDBC_TO_DORIS', sampleConfig: { env: { 'job.mode': 'BATCH' }, sink: [{ plugin_name: 'Doris' }] },
    }]) as { env: Record<string, unknown> }
    expect(fromCatalog.env['job.mode']).toBe('CDC')
  })

  it('配置 JSON 必须是对象，空文本与非对象都被拒绝', () => {
    expect(parseConfig('{"a":1}')).toEqual({ a: 1 })
    expect(() => parseConfig('')).toThrow('配置 JSON 不能为空')
    expect(() => parseConfig('[]')).toThrow('配置必须是 JSON 对象')
    expect(() => parseConfig('{')).toThrow()
  })

  it('执行器品牌不直出：消息里的引擎名换业务称谓', () => {
    expect(businessMessage('SeaTunnel job submitted')).toBe('中心采集 job submitted')
    expect(isDolphinExecutor('DOLPHINSCHEDULER')).toBe(true)
    expect(isDolphinExecutor('SEATUNNEL')).toBe(false)
  })
})

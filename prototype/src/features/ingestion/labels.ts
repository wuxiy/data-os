import type { BadgeProps } from '@/components/ui/badge'

import type { JobConfig, SourceApiItem } from '../../data/controlPlane'
import { defaultTemplateKey, offersDemoTemplate } from '../../data/runtimeMode'

/** 状态标签外观：直接取 coss Badge 的 variant 值（success / warning / error / outline）。 */
type BadgeTone = NonNullable<BadgeProps['variant']>

/** 接入域词汇与默认值：接口状态值是开放字符串，未知值原样回退。 */

export const DEFAULT_TEMPLATE_KEY = 'FAKE_TO_CONSOLE'
export const LIVE_TEMPLATE_KEY = 'CUSTOM_JSON'
export const DEFAULT_TEMPLATE_VERSION = 1
export const JOBS_PAGE_SIZE = 8
export const SOURCES_PAGE_SIZE = 6
export const RUNS_PAGE_SIZE = 8

const DEFAULT_FAKE_CONFIG: JobConfig = {
  env: { 'job.mode': 'BATCH', parallelism: 1 },
  source: [{
    plugin_name: 'FakeSource',
    plugin_output: 'fake',
    'row.num': 16,
    schema: { fields: { name: 'string', age: 'int' } },
  }],
  transform: [],
  sink: [{ plugin_name: 'Console', plugin_input: ['fake'] }],
}

function cloneConfig(config: JobConfig): JobConfig {
  return JSON.parse(JSON.stringify(config)) as JobConfig
}

export function configForTemplate(templateKey: string, mode: string, templates: { key: string; sampleConfig: JobConfig }[] = []): JobConfig {
  if (templateKey === DEFAULT_TEMPLATE_KEY) {
    const config = cloneConfig(DEFAULT_FAKE_CONFIG)
    const env = config.env as Record<string, unknown>
    env['job.mode'] = mode
    return config
  }
  const template = templates.find((item) => item.key === templateKey)
  if (template) {
    const config = cloneConfig(template.sampleConfig)
    const env = config.env as Record<string, unknown> | undefined
    if (env) env['job.mode'] = mode
    return config
  }
  return {}
}

export function defaultJobTemplateKey(): string {
  return defaultTemplateKey(DEFAULT_TEMPLATE_KEY, LIVE_TEMPLATE_KEY)
}

/** 展示名兜底：无名数据源不直出裸 UUID。 */
export function sourceDisplayName(source: SourceApiItem): string {
  const name = source.name?.trim()
  return name ? name : `未命名数据源（${source.id.slice(0, 8)}）`
}

/** 新建任务默认源：优先选已登记连接的源，避免表单一打开就是死路。 */
export function preferredSourceId(list: SourceApiItem[]): string {
  const connected = list.find((source) => source.connection)
  return (connected ?? list[0])?.id ?? ''
}

export function offerDemoTemplate(): boolean {
  return offersDemoTemplate()
}

export function sourceStatusView(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'HEALTHY': return { label: '健康', tone: 'success' }
    case 'UNHEALTHY': return { label: '连接失败', tone: 'error' }
    case 'BLOCKED_CONFIGURATION': return { label: '待配置', tone: 'warning' }
    default: return { label: '待检查', tone: 'warning' }
  }
}

export function sourceCheckDefaults(protocol: string): JobConfig {
  if (protocol.toUpperCase() === 'JDBC') return { jdbcUrl: 'jdbc:postgresql://主机:5432/数据库', username: '只读账号' }
  if (protocol.toUpperCase() === 'HTTP' || protocol.toUpperCase() === 'FHIR') return { url: 'http://前置机地址/health' }
  return {}
}

export function jobLifecycleView(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'ACTIVE': return { label: '已启用', tone: 'success' }
    case 'PAUSED': return { label: '已暂停', tone: 'warning' }
    case 'ARCHIVED': return { label: '已归档', tone: 'outline' }
    default: return { label: '草稿', tone: 'outline' }
  }
}

export function executorLabel(executor: string): string {
  return executor.toUpperCase() === 'SEATUNNEL' ? '中心采集执行器' : '平台调度'
}

export function isDolphinExecutor(executor: string): boolean {
  return executor.toUpperCase().includes('DOLPHIN')
}

/** 执行器品牌不直出业务视图（DESIGN.md 红线）：消息里的引擎名换业务称谓。 */
export function businessMessage(message: string): string {
  return message.replace(/SeaTunnel/gi, '中心采集')
}

export function parseConfig(text: string): JobConfig {
  if (!text.trim()) throw new Error('配置 JSON 不能为空')
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置必须是 JSON 对象')
  return parsed as JobConfig
}

export function createRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404)
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

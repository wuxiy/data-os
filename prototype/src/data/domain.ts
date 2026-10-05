/**
 * 领域词汇单一来源（CONTEXT.md「外部运行」）：运行与治理问题状态的
 * 中文标签、色调、终态/可重试判定和时间格式化集中在此。页面不再各自
 * 维护映射——后端新增状态时只改这里；未知值原样回退展示。
 *
 * 状态值来自控制面 API，本质是开放字符串，因此不做穷举联合类型：
 * 词汇的权威在映射表与回退行为，而不是类型断言。
 */
export type Tone = 'healthy' | 'warning' | 'danger' | 'neutral'

// ---- 外部运行状态 ----

const RUN_VIEWS: Record<string, { label: string; tone: Tone }> = {
  SUBMITTING: { label: '提交中', tone: 'warning' },
  SUBMITTED: { label: '已提交', tone: 'warning' },
  RUNNING: { label: '运行中', tone: 'healthy' },
  SUCCEEDED: { label: '已完成', tone: 'healthy' },
  FAILED: { label: '失败', tone: 'danger' },
  SUBMIT_FAILED: { label: '投递失败', tone: 'danger' },
  CANCELED: { label: '已取消', tone: 'neutral' },
  BLOCKED_CONFIGURATION: { label: '待处理', tone: 'warning' },
  BLOCKED_DEPENDENCY: { label: '待处理', tone: 'warning' },
  UNSUPPORTED_EXECUTOR: { label: '待处理', tone: 'warning' },
  UNKNOWN: { label: '状态待确认', tone: 'warning' },
}

export function runStatusLabel(status: string): string {
  return RUN_VIEWS[status]?.label ?? status
}

export function runStatusTone(status: string): Tone {
  return RUN_VIEWS[status]?.tone ?? 'neutral'
}

export function runStatusView(status: string): { label: string; tone: Tone } {
  return RUN_VIEWS[status] ?? { label: status, tone: 'neutral' }
}

/** 活跃（非终态）运行：提交中/已提交/运行中/待确认。 */
export const ACTIVE_RUN_STATUSES: readonly string[] = ['SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN']

export function isTerminalRun(status: string): boolean {
  return ['SUCCEEDED', 'FAILED', 'CANCELED', 'SUBMIT_FAILED'].includes(status)
}

/** 允许人工再次发起的既往终态（与控制面 RunStatus.RETRYABLE_TERMINAL 对齐）。 */
export function retryableRunStatus(status: string): boolean {
  return ['FAILED', 'CANCELED', 'BLOCKED_CONFIGURATION', 'BLOCKED_DEPENDENCY', 'SUBMIT_FAILED', 'UNSUPPORTED_EXECUTOR', 'UNKNOWN'].includes(status)
}

// ---- 治理问题状态 ----

const ISSUE_LABELS: Record<string, string> = {
  OVERDUE: '逾期',
  IN_PROGRESS: '处理中',
  PENDING: '待处理',
  PENDING_RECHECK: '待复检',
  RECHECKING: '复检中',
  RETURNED: '已退回',
  CLOSED: '已关闭',
}

export function issueStatusLabel(status: string): string {
  return ISSUE_LABELS[status] ?? status
}

export function issueStatusTone(status: string): Tone {
  if (status === 'OVERDUE' || status === 'RETURNED') return 'danger'
  if (status === 'RECHECKING' || status === 'IN_PROGRESS' || status === 'PENDING_RECHECK' || status === 'PENDING') return 'warning'
  if (status === 'CLOSED') return 'healthy'
  return 'neutral'
}

export function severityLabel(value: string): string {
  return ({ HIGH: '高', MEDIUM: '中', LOW: '低' } as Record<string, string>)[value] ?? value
}

export function severityTone(value: string): Tone {
  if (value === 'HIGH') return 'danger'
  if (value === 'MEDIUM') return 'warning'
  return 'neutral'
}

// ---- 质量事件与通知 ----

export function eventTitle(value: string): string {
  return ({ WORKFLOW_UPDATED: '责任人提交处理说明', RECHECK_REQUESTED: '已发起质量规则复检', AUTO_CLOSED: '复检通过，问题已自动关闭', AUTO_RETURNED: '复检未通过，问题已退回', RECHECK_FAILED: '复检执行失败', RECHECK_SUBMIT_FAILED: '复检投递失败', SLA_OVERDUE: 'SLA 已逾期', RESPONSIBLE_REMINDER_REQUESTED: '已提醒责任人' } as Record<string, string>)[value] ?? '治理问题状态更新'
}

// ---- 标准中心/标准映射的枚举中文口径（2026-10-05 critique P2）----

/** 审计事件类型（后端 literal：VERSION_CREATED/SUBMITTED/PUBLISHED/…）。 */
export function standardEventLabel(value: string): string {
  return ({ VERSION_CREATED: '创建版本', SUBMITTED: '提交评审', PUBLISHED: '发布', DEPRECATED: '停用', IMPORTED: '导入', VALIDATED: '聚合验证', ACTIVATED: '生效', RETIRED: '停用映射', ROLLED_BACK: '回退', SYNC_PENDING: '术语投影待同步', SYNC_SUCCEEDED: '术语投影完成' } as Record<string, string>)[value] ?? value
}

/** 敏感级别（标准元素）。 */
export function sensitivityLabel(value: string): string {
  return ({ NORMAL: '常规', SENSITIVE: '敏感' } as Record<string, string>)[value] ?? value
}

/** 受控转换类型（映射项）。 */
export function transformLabel(value: string): string {
  return ({ COPY: '直接复制', TRIM: '去首尾空白', UPPER: '转大写', DATE_FORMAT: '日期格式化', VALUE_MAP: '值映射' } as Record<string, string>)[value] ?? value
}

/** 审计事件操作者。 */
export function actorLabel(value: string | null | undefined): string {
  if (!value) return '系统'
  return value === 'system' ? '系统' : value
}

/** 质量执行器通道。 */
export function executorLabel(value: string | null | undefined): string {
  return ({ HTTP: '质量执行器（在线）', DEMO: '演示执行器' } as Record<string, string>)[value ?? ''] ?? (value || '—')
}

// ---- 执行器输出治理（2026-10-05 critique P0-2）----

/** 执行器输出指纹：历史数据里 processingNote 曾被 dbt 全文污染，不得预填进人工输入框。 */
export function looksLikeExecutorOutput(text: string | null | undefined): boolean {
  if (!text) return false
  const value = text.trim()
  return /^执行器输出 \d+ 行/.test(value) || /dbt=|Registered adapter|Failure in test|Compilation Error/.test(value)
}

/** 长执行器输出的呈现切分：可见头是通用标签（不透出引擎横幅行），全文折叠；短文本整体呈现。 */
export function executorOutputView(text: string): { head: string; folded: string | null } {
  const lines = text.split('\n')
  if (lines.length <= 3 && text.length <= 200) return { head: text, folded: null }
  return { head: `执行器输出（${lines.length} 行，完整内容已折叠）`, folded: text }
}

export function notificationStatusLabel(value: string): string {
  return ({ PENDING: '待投递', SENT: '已送达', SKIPPED: '已跳过', FAILED: '待重试' } as Record<string, string>)[value] ?? value
}

export function notificationStatusTone(value: string): Tone {
  if (value === 'FAILED') return 'danger'
  if (value === 'PENDING') return 'warning'
  if (value === 'SENT') return 'healthy'
  return 'neutral'
}

// ---- 时间格式化 ----

/** 统一的短时间格式：MM-DD HH:mm；空值为「—」，无法解析时原样展示。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace('/', '-').replace('/', ' ')
}

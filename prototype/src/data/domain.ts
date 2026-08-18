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

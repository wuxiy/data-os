import { useQuery } from '@tanstack/react-query'
import { ChevronDown, CircleAlert, CircleCheck, CloudCog, RefreshCw } from 'lucide-react'

import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'

import { fetchRuntimeStatus, type RuntimeStatusApiResponse } from '../../data/controlPlane'
import { frontendDemoMode, isDemoRuntime } from '../../data/runtimeMode'

const SCOPE_SUMMARY = '首期真实范围：数据接入、采集运行、治理问题、质量复检、通知、MPI、资产、分析、数据服务、AI Ready 评估、数据标准中心与管理驾驶舱/运营中心；标准映射、交付中心与受控智能问数已接入（仅已验证问题口径）。'

/**
 * 运行状态横幅（coss Alert + Collapsible）：运行模式与真实范围口径的单一展示点。
 * 读取走会话级 Query（2.5 秒自超时；已有数据时刷新保留展示，不闪加载态）。
 */
export function RuntimeStatusBanner() {
  const query = useQuery({
    queryKey: ['runtime-status'],
    queryFn: ({ signal }) => {
      // Query 没有内建超时：沿用旧三态机的 2.5 秒自超时语义（超时按不可用处理）。
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 2500)
      const forwardAbort = () => controller.abort()
      signal?.addEventListener('abort', forwardAbort)
      return fetchRuntimeStatus(controller.signal)
        .finally(() => {
          window.clearTimeout(timer)
          signal?.removeEventListener('abort', forwardAbort)
        })
    },
    staleTime: 30_000,
    retry: false,
  })

  const status: RuntimeStatusApiResponse | undefined = query.data
  const demo = isDemoRuntime(status?.mode)
  const warning = status?.warnings?.[0]
  const operationalState = status?.operational?.state ?? 'UNKNOWN'
  const coverage = status?.operational ? `${status.operational.ready}/${status.operational.total} 组件就绪` : ''
  const operationalLabel = operationalState === 'READY'
    ? `核心链路就绪${coverage ? `（${coverage}）` : ''}`
    : operationalState === 'DEGRADED' ? `核心链路降级${coverage ? `（${coverage}）` : ''}` : '核心链路未知'

  // 四种呈现归到 coss Alert 的三种语义：读取中（default）、真实且就绪（success）、演示/降级/未知（warning）。
  if (query.isPending) {
    return (
      <Alert role="status" className="mb-3 py-1.5">
        <CloudCog />
        <AlertDescription>正在读取运行模式…</AlertDescription>
      </Alert>
    )
  }
  if (query.isError) {
    return (
      <Alert variant="warning" role="status" className="mb-3 py-1.5">
        <CircleAlert />
        <AlertDescription>
          <span className="flex flex-wrap items-center gap-2.5">
            {frontendDemoMode ? <><strong className="font-medium text-foreground">演示运行模式</strong><span>前端已显式启用脱敏演示数据</span></> : <span>控制面状态未知 · 请查看各工作区连接状态</span>}
            <ScopeFold />
          </span>
        </AlertDescription>
        <AlertAction>
          <Button variant="ghost" size="icon-xs" aria-label="重新读取运行状态" onClick={() => void query.refetch()}><RefreshCw /></Button>
        </AlertAction>
      </Alert>
    )
  }

  const healthy = !demo && operationalState === 'READY'
  return (
    <Alert variant={healthy ? 'success' : 'warning'} role="status" className="mb-3 py-1.5">
      {demo ? <CloudCog /> : <CircleCheck />}
      <AlertDescription>
        <span className="flex flex-wrap items-center gap-2.5">
          <strong className="font-medium text-foreground">{demo ? '演示运行模式' : '真实运行模式'}</strong>
          <span>{frontendDemoMode ? '前端已显式启用脱敏演示数据' : `质量执行器 ${status?.qualityExecutor ?? '未知'}`}</span>
          <Badge variant={status?.qualityExecutorConfigured ? 'success' : 'warning'}>{status?.qualityExecutorConfigured ? '执行器已配置' : '执行器待配置'}</Badge>
          <Badge variant={operationalState === 'READY' ? 'success' : 'warning'}>{operationalLabel}</Badge>
          {warning ? <span>{warning}</span> : null}
          <ScopeFold />
        </span>
      </AlertDescription>
    </Alert>
  )
}

/** 范围说明：默认收起，点开后在横幅内展开全文。 */
function ScopeFold() {
  return (
    <Collapsible className="ml-auto max-w-[62%] text-xs">
      <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
        范围说明
        <ChevronDown className="size-3.5 transition-transform data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <p className="mt-1 leading-relaxed text-muted-foreground">{SCOPE_SUMMARY}</p>
      </CollapsiblePanel>
    </Collapsible>
  )
}

import { CircleAlert, CloudCog, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { fetchRuntimeStatus, type RuntimeStatusApiResponse } from '../../data/controlPlane'
import { useApiResource } from '../../hooks/useApiResource'
import { frontendDemoMode, isDemoRuntime } from '../../data/runtimeMode'
import { Badge } from './badge'

const SCOPE_SUMMARY = '首期真实范围：数据接入、采集运行、治理问题、质量复检、通知、MPI、资产、分析、数据服务、AI Ready 评估、数据标准中心与管理驾驶舱/运营中心；标准映射、交付中心与受控智能问数已接入（已验证问题口径）。'

/**
 * 运行状态横幅：运行模式与真实范围口径的单一展示点。
 * 迁移期由新主题承载；数据读取仍走既有 useApiResource 三态机。
 */
export function RuntimeStatusBanner() {
  const [status, setStatus] = useState<RuntimeStatusApiResponse | null>(null)
  const state = useApiResource({
    timeoutMs: 2500,
    load: (signal) => fetchRuntimeStatus(signal),
    onData: setStatus,
  })

  const shell = 'mb-3 flex min-h-[30px] flex-wrap items-center gap-2.5 rounded-control border px-3 py-1.5 text-label'

  if (state === 'loading') {
    return <div role="status" className={`${shell} border-line bg-wash text-muted`}><CloudCog size={14} /><span>正在读取运行模式…</span></div>
  }

  if (state === 'unavailable') {
    const scope = <ScopeFold />
    if (frontendDemoMode) {
      return (
        <div role="status" className={`${shell} border-amber-line bg-amber-soft text-[#8b6938]`}>
          <CloudCog size={14} /><strong>演示运行模式</strong><span>前端已显式启用脱敏演示数据</span>{scope}
        </div>
      )
    }
    return (
      <div role="status" className={`${shell} border-[#eee2c5] bg-[#fdf9ef] text-[#8e7040]`}>
        <CircleAlert size={14} /><span>控制面状态未知 · 请查看各工作区连接状态</span>{scope}
        <button type="button" onClick={() => window.location.reload()} aria-label="重新读取运行状态" className="ml-auto inline-flex size-6 items-center justify-center rounded-chip hover:bg-[#f3ead7]"><RefreshCw size={13} /></button>
      </div>
    )
  }

  const demo = isDemoRuntime(status?.mode)
  const warning = status?.warnings?.[0]
  const operationalState = status?.operational?.state ?? 'UNKNOWN'
  const coverage = status?.operational ? `${status.operational.ready}/${status.operational.total} 组件就绪` : ''
  const operationalLabel = operationalState === 'READY'
    ? `核心链路就绪${coverage ? `（${coverage}）` : ''}`
    : operationalState === 'DEGRADED' ? `核心链路降级${coverage ? `（${coverage}）` : ''}` : '核心链路未知'

  return (
    <div className={`${shell} ${demo ? 'border-amber-line bg-amber-soft text-[#8b6938]' : operationalState === 'READY' ? 'border-green-line bg-green-soft text-[#3f6f59]' : 'border-[#eee2c5] bg-[#fdf9ef] text-[#8e7040]'}`}>
      {demo ? <CloudCog size={14} /> : <i aria-hidden="true" className="size-1.5 rounded-full bg-[#4d8c6e]" />}
      <strong>{demo ? '演示运行模式' : '真实运行模式'}</strong>
      <span>{frontendDemoMode ? '前端已显式启用脱敏演示数据' : `质量执行器 ${status?.qualityExecutor ?? '未知'}`}</span>
      <Badge tone={status?.qualityExecutorConfigured ? 'success' : 'warn'}>{status?.qualityExecutorConfigured ? '执行器已配置' : '执行器待配置'}</Badge>
      <Badge tone={operationalState === 'READY' ? 'success' : 'warn'}>{operationalLabel}</Badge>
      {warning ? <span className="text-[#9a6d2e]">{warning}</span> : null}
      <ScopeFold />
    </div>
  )
}

function ScopeFold() {
  return (
    <details className="ml-auto max-w-[62%] text-meta">
      <summary className="cursor-pointer text-[#8b94a1]">范围说明</summary>
      <span className="mt-1 block leading-relaxed text-[#7c8795]">{SCOPE_SUMMARY}</span>
    </details>
  )
}

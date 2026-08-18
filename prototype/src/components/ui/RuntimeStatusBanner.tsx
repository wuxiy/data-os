import { CircleAlert, CloudCog, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchRuntimeStatus, type RuntimeStatusApiResponse } from '../../data/controlPlane'
import { frontendDemoMode, isDemoRuntime } from '../../data/runtimeMode'
import { StatusTag } from './Primitives'
import styles from './RuntimeStatusBanner.module.css'

const SCOPE_SUMMARY = '首期真实范围：数据接入、采集运行、治理问题、质量复检和通知；其余模块为规划/待接入。'

export function RuntimeStatusBanner() {
  const [state, setState] = useState<'loading' | 'live' | 'unavailable'>('loading')
  const [status, setStatus] = useState<RuntimeStatusApiResponse | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 2500)
    fetchRuntimeStatus(controller.signal)
      .then((next) => {
        setStatus(next)
        setState('live')
      })
      .catch(() => setState('unavailable'))
      .finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  if (state === 'loading') return <div className={`${styles.banner} ${styles.loading}`} role="status"><CloudCog size={14} /><span>正在读取运行模式…</span><span className={styles.scope}>{SCOPE_SUMMARY}</span></div>
  if (state === 'unavailable') {
    if (frontendDemoMode) {
      return <div className={`${styles.banner} ${styles.demo}`} role="status"><CloudCog size={14} /><strong>演示运行模式</strong><span>前端已显式启用脱敏演示数据</span><span className={styles.scope}>{SCOPE_SUMMARY}</span></div>
    }
    return <div className={`${styles.banner} ${styles.warning}`} role="status"><CircleAlert size={14} /><span>控制面状态未知 · 页面仅展示已明确标注的本地演示内容</span><span className={styles.scope}>{SCOPE_SUMMARY}</span><button onClick={() => window.location.reload()} aria-label="重新读取运行状态"><RefreshCw size={13} /></button></div>
  }

  const demo = isDemoRuntime(status?.mode)
  const warning = status?.warnings[0]
  const operationalState = status?.operational.state ?? 'UNKNOWN'
  const operationalLabel = operationalState === 'READY'
    ? '核心链路就绪'
    : operationalState === 'DEGRADED' ? '核心链路降级' : '核心链路未知'
  return (
    <div className={`${styles.banner} ${demo ? styles.demo : operationalState === 'READY' ? styles.live : styles.warning}`} role="status">
      {demo ? <CloudCog size={14} /> : <span className={styles.liveDot} />}
      <strong>{demo ? '演示运行模式' : '真实运行模式'}</strong>
      <span>{frontendDemoMode ? '前端已显式启用脱敏演示数据' : `质量执行器 ${status?.qualityExecutor ?? '未知'}`}</span>
      {status?.qualityExecutorConfigured ? <StatusTag tone="healthy">执行器已配置</StatusTag> : <StatusTag tone="warning">执行器待配置</StatusTag>}
      <StatusTag tone={operationalState === 'READY' ? 'healthy' : 'warning'}>{operationalLabel}</StatusTag>
      {warning ? <span className={styles.warningText}>{warning}</span> : null}
      <span className={styles.scope}>{SCOPE_SUMMARY}</span>
    </div>
  )
}

import { CircleAlert, CloudCog, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchRuntimeStatus, type RuntimeStatusApiResponse } from '../../data/controlPlane'
import { frontendDemoMode } from '../../data/runtime'
import { StatusTag } from './Primitives'
import styles from './RuntimeStatusBanner.module.css'

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

  if (state === 'loading') return <div className={`${styles.banner} ${styles.loading}`} role="status"><CloudCog size={14} />正在读取运行模式…</div>
  if (state === 'unavailable') {
    return <div className={`${styles.banner} ${styles.warning}`} role="status"><CircleAlert size={14} /><span>控制面状态未知 · 页面仅展示已明确标注的本地演示内容</span><button onClick={() => window.location.reload()} aria-label="重新读取运行状态"><RefreshCw size={13} /></button></div>
  }

  const demo = frontendDemoMode || status?.mode === 'DEMO'
  const warning = status?.warnings[0]
  return (
    <div className={`${styles.banner} ${demo ? styles.demo : styles.live}`} role="status">
      {demo ? <CloudCog size={14} /> : <span className={styles.liveDot} />}
      <strong>{demo ? '演示运行模式' : '真实运行模式'}</strong>
      <span>{frontendDemoMode ? '前端已显式启用脱敏演示数据' : `质量执行器 ${status?.qualityExecutor ?? '未知'}`}</span>
      {status?.qualityExecutorConfigured ? <StatusTag tone="healthy">执行器已配置</StatusTag> : <StatusTag tone="warning">执行器待配置</StatusTag>}
      {warning ? <span className={styles.warningText}>{warning}</span> : null}
    </div>
  )
}

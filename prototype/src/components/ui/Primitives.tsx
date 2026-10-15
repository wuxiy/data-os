import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, CircleAlert, Info, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Metric, Tone } from '../../types'
import styles from './Primitives.module.css'

export function StatusTag({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`${styles.tag} ${styles[tone]}`}>{children}</span>
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  size?: 'md' | 'sm'
}

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`${styles.button} ${styles[variant]} ${size === 'sm' ? styles.sm : ''} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function MetricStrip({ metrics, onSelect }: { metrics: Metric[]; onSelect?: (metric: Metric) => void }) {
  return (
    <section className={styles.metrics} aria-label="关键指标">
      {metrics.map((metric) => (
        <button
          className={`${styles.metric} ${onSelect ? styles.metricInteractive : ''}`}
          key={metric.label}
          onClick={() => onSelect?.(metric)}
          disabled={!onSelect}
        >
          <span className={styles.metricLabel}>{metric.label}</span>
          <strong className={metric.tone ? styles[`${metric.tone}Text`] : ''}>
            {metric.value}<small>{metric.unit}</small>
          </strong>
          <span className={styles.metricDetail}>{metric.detail}</span>
          {onSelect ? <ChevronRight className={styles.metricArrow} size={15} /> : null}
        </button>
      ))}
    </section>
  )
}

type ToastTone = 'success' | 'info' | 'warning' | 'danger'

const TOAST_AUTO_CLOSE_MS = 3200
const TOAST_LEAVE_MS = 180

export function Toast({ message, onClose, tone = 'info' }: { message: string; onClose: () => void; tone?: ToastTone }) {
  const [leaving, setLeaving] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)

  // 自动关闭与点关闭都先播退出动画，动画结束才卸载（App 侧不再直接清 notice）
  useEffect(() => {
    const autoTimer = window.setTimeout(() => setLeaving(true), TOAST_AUTO_CLOSE_MS)
    return () => {
      window.clearTimeout(autoTimer)
      window.clearTimeout(closeTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!leaving) return
    closeTimer.current = window.setTimeout(onClose, TOAST_LEAVE_MS)
    return () => window.clearTimeout(closeTimer.current)
  }, [leaving, onClose])

  const Icon = tone === 'success' ? Check : tone === 'info' ? Info : CircleAlert
  return (
    <div className={`${styles.toast} ${styles[`toast${tone[0].toUpperCase()}${tone.slice(1)}`]} ${leaving ? styles.toastLeaving : ''}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className={styles.toastIcon}><Icon size={16} /></span>
      <span>{message}</span>
      <button onClick={() => setLeaving(true)} aria-label="关闭提示"><X size={16} /></button>
    </div>
  )
}

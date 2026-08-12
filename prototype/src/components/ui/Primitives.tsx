import { Check, ChevronRight, CircleAlert, Info, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Metric, Tone } from '../../types'
import styles from './Primitives.module.css'

export function StatusTag({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`${styles.tag} ${styles[tone]}`}>{children}</span>
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
}

export function Button({ variant = 'secondary', className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`${styles.button} ${styles[variant]} ${className}`} {...props}>
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

export function Toast({ message, onClose, tone = 'info' }: { message: string; onClose: () => void; tone?: ToastTone }) {
  const Icon = tone === 'success' ? Check : tone === 'info' ? Info : CircleAlert
  return (
    <div className={`${styles.toast} ${styles[`toast${tone[0].toUpperCase()}${tone.slice(1)}`]}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className={styles.toastIcon}><Icon size={16} /></span>
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭提示"><X size={16} /></button>
    </div>
  )
}

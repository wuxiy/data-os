import { Check, ChevronRight, X } from 'lucide-react'
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

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className={styles.toast} role="status">
      <span className={styles.toastIcon}><Check size={16} /></span>
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭提示"><X size={16} /></button>
    </div>
  )
}

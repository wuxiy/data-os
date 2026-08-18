import styles from './PageHeader.module.css'
import { frontendDemoMode, timestampPlaceholder } from '../../data/runtimeMode'

interface PageHeaderProps {
  title: string
  eyebrow?: string
  subtitle?: string
  compact?: boolean
  asOf?: string | null
}

export function PageHeader({ title, eyebrow, subtitle, compact = false, asOf = null }: PageHeaderProps) {
  return (
    <header className={`${styles.header} ${compact ? styles.compact : ''}`}>
      <div>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className={styles.actions}>
        <div className={styles.scopeSummary} aria-label="当前数据范围">
          <span>机构 · 市第一人民医院</span>
          <span>主题域 · 全部</span>
          <span>时间 · 近 30 天</span>
        </div>
        <span className={styles.timestamp}>{timestampPlaceholder(asOf)}</span>
        <div className={styles.avatar} title="数据治理负责人 陈序">陈</div>
      </div>
    </header>
  )
}

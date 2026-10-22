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
      <div className={styles.identity}>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className={styles.actions}>
        <div className={styles.scopeSummary} aria-label="数据范围说明">
          <span>{frontendDemoMode ? '脱敏演示 · 示例机构' : '数据范围以当前工作区为准'}</span>
          <span className={styles.timestamp}>{timestampPlaceholder(asOf)}</span>
        </div>
      </div>
    </header>
  )
}

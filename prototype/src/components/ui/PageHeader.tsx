import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  eyebrow?: string
  subtitle?: string
  compact?: boolean
}

export function PageHeader({ title, eyebrow, subtitle, compact = false }: PageHeaderProps) {
  return (
    <header className={`${styles.header} ${compact ? styles.compact : ''}`}>
      <div>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className={styles.actions}>
        <select className={styles.filter} aria-label="机构范围" defaultValue="市第一人民医院">
          <option>市第一人民医院</option><option>全部成员医院</option><option>区域平台</option>
        </select>
        <select className={styles.filter} aria-label="主题域范围" defaultValue="全部主题域">
          <option>全部主题域</option><option>患者主题</option><option>门诊主题</option><option>检验主题</option>
        </select>
        <select className={styles.filter} aria-label="时间范围" defaultValue="近 30 天">
          <option>近 7 天</option><option>近 30 天</option><option>近 90 天</option>
        </select>
        <span className={styles.timestamp}>截至 08-01 14:30</span>
        <div className={styles.avatar} title="数据治理负责人 陈序">陈</div>
      </div>
    </header>
  )
}

import styles from './TrendChart.module.css'

interface TrendChartProps {
  title?: string
  primaryLabel?: string
  secondaryLabel?: string
  compact?: boolean
}

const labels = ['07-03', '07-06', '07-09', '07-12', '07-15', '07-18', '07-21', '07-24', '07-27', '07-30', '08-01']
const primary = '0,52 40,58 80,49 120,45 160,51 200,39 240,42 280,36 320,43 360,40 400,45 440,36 480,39 520,46 560,38 600,41'
const secondary = '0,79 40,87 80,72 120,75 160,98 200,91 240,82 280,75 320,86 360,89 400,99 440,117 480,124 520,93 560,78 600,82'

export function TrendChart({
  title = '质量得分与标准映射率趋势',
  primaryLabel = '质量得分',
  secondaryLabel = '标准映射率',
  compact = false,
}: TrendChartProps) {
  return (
    <section className={`${styles.panel} ${compact ? styles.compact : ''}`} aria-label={title}>
      <div className={styles.header}>
        <h2>{title}</h2>
        <div className={styles.legend}>
          <span><i className={styles.lineSolid} />{primaryLabel}</span>
          <span><i className={styles.lineDash} />{secondaryLabel}</span>
        </div>
      </div>
      <div className={styles.chartWrap}>
        <svg className={styles.chart} viewBox="0 0 640 180" role="img" aria-label={`${primaryLabel}整体稳定，${secondaryLabel}近期回升`}>
          {[30, 70, 110, 150].map((y) => <line key={y} x1="40" x2="640" y1={y} y2={y} className={styles.grid} />)}
          {[{ y: 30, v: '100' }, { y: 70, v: '95' }, { y: 110, v: '90' }, { y: 150, v: '85' }].map((tick) => (
            <text key={tick.y} x="34" y={tick.y + 4} textAnchor="end" className={styles.yTick}>{tick.v}</text>
          ))}
          <text x="34" y="14" textAnchor="end" className={styles.yUnit}>%</text>
          <g transform="translate(40 0)">
            <polyline points={primary} className={styles.primaryLine} />
            <polyline points={secondary} className={styles.secondaryLine} />
            <circle cx="600" cy="41" r="4" className={styles.point} />
          </g>
        </svg>
        <div className={styles.xLabels}>
          {labels.map((label, index) => <span key={label} className={index % 2 === 1 ? styles.hideSmall : ''}>{label}</span>)}
        </div>
      </div>
    </section>
  )
}
